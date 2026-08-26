"""Сид цепочки расхода для стенда: люди → статусы → сдача → выпуск.

ЗАЧЕМ ОТДЕЛЬНАЯ КОМАНДА, когда есть сиды справочников. Те заводят СЛОВАРИ —
типы статусов, роли, права. Здесь заводится СОБЫТИЙНАЯ цепочка: подразделение с
людьми, статусы на день, сданный день и выпущенный по нему документ. Ровно она
нужна, чтобы открыть экран расхода и увидеть на нём хоть что-нибудь, а не пустую
таблицу, — и ровно её собирают руками каждый раз, когда поднимают стенд.

ЦЕПОЧКА СОБИРАЕТСЯ ШТАТНЫМИ СЕРВИСАМИ, а не вставками в базу. Сид, кладущий
строки напрямую, показывает состояние, которого система сама породить не может:
сдачу без снимка, выпуск без номера, статус в обход проверки пересечений. Стенд
после такого лжёт ровно в ту сторону, в какую его смотрят.

ИДЕМПОТЕНТНОСТЬ ЧЕРЕЗ ПОВТОРНЫЙ ЗАПУСК: подразделение ищется по имени, и уже
сданный день не сдаётся заново. Стенд поднимают повторно, и второй запуск не
должен ни падать, ни плодить второе «Управление» рядом с первым.

Прод-путей команда не трогает: она только зовёт то, что и так есть.

⚠️ СДАЧА ДНЯ — ПОБОЧНЫЙ ЭФФЕКТ, О КОТОРОМ НАДО ЗНАТЬ (Plane №72). Пробы
`day-submission` показывают путь «день ещё не сдан → сдаём → сдан», и на
стенде, где день уже сдан этой командой, две из них краснеют: сдавать нечего.
Раньше это лечилось запретом «не звать сид перед смоуком» — то есть человек
должен был помнить. Теперь у команды есть `--no-submit`: люди и статусы
заводятся, день остаётся НЕ СДАННЫМ, и обе пробы проходят свой путь целиком.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.document_release import (
    EXPENSE_DOC_TYPE,
    issue_expense_document,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_document import OpsIssuedDocument
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.selectors import DailySubmissionSelector
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.staff_unit.models import StaffUnit

DIVISION_NAME = "Управление (стенд)"
ACTOR = "stand-seed"

# Кого и с каким статусом заводим. Один человек ОСТАЁТСЯ БЕЗ СТАТУСА намеренно:
# «в строю» — выводимое состояние, и стенд без него показывал бы расход, в
# котором каждая клетка заполнена, — то есть не показывал бы главного.
PEOPLE = [
    ("Абаев", "Абай", "DUTY"),
    ("Дроздов", "Дмитрий", "DUTY"),
    ("Ёлкин", "Егор", "VACATION"),
    ("Яковлев", "Яков", None),
]


class Command(BaseCommand):
    help = (
        "Собрать на стенде цепочку расхода: подразделение с людьми, статусы на "
        "сегодня, сданный день и выпущенный документ. Идемпотентна."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-release",
            action="store_true",
            help="Остановиться на сданном дне, документ не выпускать.",
        )
        parser.add_argument(
            "--no-submit",
            action="store_true",
            help=(
                "Остановиться на статусах: день НЕ сдавать и документ не "
                "выпускать. Ровно этот режим нужен перед смоуком — пробы "
                "day-submission сдают день сами (Plane №72)."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        day = Clock.today_local()
        division = self._division()
        self._people(division)
        self._statuses(division, day)
        # `--no-submit` сильнее `--no-release`: выпускать документ по
        # НЕ СДАННОМУ дню нечем, и молча сдать день ради выпуска значило бы
        # обойти флаг, ради которого его и завели.
        submission = None if options["no_submit"] else self._submission(division, day)
        issued = (
            None
            if options["no_submit"] or options["no_release"]
            else self._release(division, day)
        )

        self.stdout.write(f"STAND_DIVISION={division.id}")
        self.stdout.write(f"STAND_DAY={day.isoformat()}")
        if submission is not None:
            self.stdout.write(f"STAND_SUBMISSION={submission.pk}")
        else:
            self.stdout.write("STAND_SUBMISSION=нет (--no-submit): день не сдан")
        if issued is not None:
            self.stdout.write(f"STAND_DOCUMENT=№{issued.number}/{issued.year}")
        self.stdout.write(
            self.style.SUCCESS(
                "цепочка расхода готова"
                + (" до статусов: день НЕ сдан" if options["no_submit"] else "")
            )
        )

    def _division(self):
        division, _ = Division.objects.get_or_create(name=DIVISION_NAME)
        return division

    def _people(self, division):
        """Люди на штатных слотах. Повторный запуск никого не удваивает.

        Табельный номер и ИИН выводятся из порядкового номера в списке, а не
        оставляются на умолчание модели: оно у всех одинаково, а колонка
        уникальна — второй же человек упёрся бы в ограничение. Номера
        стендовые и узнаваемые (префикс STAND), чтобы их нельзя было спутать с
        настоящими, если сид случайно запустят не там.
        """
        from datetime import date

        for index, (last_name, first_name, _code) in enumerate(PEOPLE, start=1):
            employee, created = Employee.objects.get_or_create(
                last_name=last_name,
                first_name=first_name,
                defaults={
                    "employment_status": Employee.EmploymentStatus.WORKING,
                    "personnel_number": f"STAND{index:03d}",
                    "iin": f"9{index:011d}",
                    "hire_date": date(2020, 1, 1),
                },
            )
            if created or not StaffUnit.objects.filter(employee=employee).exists():
                StaffUnit.objects.create(
                    division=division, employee=employee, index=index
                )

    def _statuses(self, division, day):
        """Статусы на день. Заводятся напрямую и ТОЛЬКО здесь — осознанно.

        Сервис создания статуса требует справочника, актора и проверки
        пересечений; на стенде это лишний повод упасть из-за незаполненного
        словаря. Сдача и выпуск дальше идут уже ШТАТНЫМ путём, а он и есть
        предмет показа.
        """
        known = set(StatusType.objects.values_list("code", flat=True))
        for last_name, first_name, code in PEOPLE:
            if code is None:
                continue
            if code not in known:
                raise CommandError(
                    f"в справочнике нет типа {code!r} — сначала засейте типы "
                    "статусов (seed_status_types)"
                )
            employee = Employee.objects.get(
                last_name=last_name, first_name=first_name
            )
            OpsEmployeeStatus.objects.get_or_create(
                employee_id=employee.id,
                status_type_code=code,
                date_start=day,
                defaults={
                    "date_end": day + timedelta(days=2),
                    "source": OpsEmployeeStatus.Source.USER,
                    "created_by": ACTOR,
                },
            )

    def _submission(self, division, day):
        existing = DailySubmissionSelector.current_for(division.id, day)
        if existing is not None:
            return existing
        return submit_day(division_id=division.id, business_date=day, actor=ACTOR)

    def _release(self, division, day):
        try:
            return issue_expense_document(
                division_id=division.id, business_date=day, actor=ACTOR
            )
        except DomainError as error:
            if error.code != "DOCUMENT_ALREADY_ISSUED":
                raise
            # Повторный запуск: документ этого дня уже выпущен, и выпускать
            # второй нельзя — на стенде это то же правило, что в проде.
            return OpsIssuedDocument.objects.get(
                doc_type=EXPENSE_DOC_TYPE,
                division_id=division.id,
                business_date=day,
                status=OpsIssuedDocument.Status.ISSUED,
            )
