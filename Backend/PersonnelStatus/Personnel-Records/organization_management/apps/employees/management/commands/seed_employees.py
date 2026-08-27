"""Люди на штатные единицы стенда (Plane №204, шаг 6 плана №198).

ЧТО ЗАВОДИТ. По человеку на каждый пустой слот сида №203 — 426 сотрудников с
ФИО, полом, датой рождения, ИИН, табельным номером, датой приёма, званием и
служебными контактами. Слот при этом занимается: человек без штатной единицы
в этой системе не существует как служащий, он виден только в списке людей.

ВСЁ ВЫВОДИТСЯ ИЗ НОМЕРА СЛОТА, СЛУЧАЙНОСТИ НЕТ. `random` здесь был бы ошибкой:
повторный запуск обязан узнать своих, а сравнение стенда «до» и «после» —
показывать правку, а не шум генератора. Поэтому имя, дата рождения и ИИН
считаются из порядкового номера, и второй прогон даёт тех же людей.

ЗВАНИЕ ИДЁТ ЗА ДОЛЖНОСТЬЮ, а не за номером: начальник департамента —
полковник, инспектор — лейтенант. Иначе в реестре рядовой оказался бы старше
своего начальника, и всякая проверка сортировки по старшинству потеряла бы
смысл.

ПОЛ СОГЛАСОВАН С ИМЕНЕМ И ФАМИЛИЕЙ. Женское имя при мужской фамилии — не
«тестовые данные», а строка, о которой заказчик спросит; каждая четвёртая
запись женская, и фамилия с отчеством у неё женские.

ИИН НАСТОЯЩЕЙ ФОРМЫ. Сегодняшний валидатор проверяет только «двенадцать цифр»
(в нём стоит TODO), но ИИН считается по-настоящему: ГГММДД, цифра века и пола,
порядковый номер и контрольный разряд по стандартной схеме весов. Стоит это
двадцати строк, а данные переживут доведение валидатора.

ГРАНИЦА — СЛОТЫ СИДА. Чужие штатные единицы стенда не занимаются: там свои
люди, на которых настроены пробы смоука.

`--wipe` снимает людей сида (табельный с префиксом `SD`) и освобождает их
слоты. Человек, у которого появились статусы, документы или учётная запись,
сносом не удаляется, а называется вслух: удалить его — значит потерять чужую
работу.
"""
from __future__ import annotations

from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

DIVISION_CODE_PREFIX = "SEED-"
PERSONNEL_PREFIX = "SD"

RANK_BY_POSITION = {
    "Начальник департамента": "полковник",
    "Заместитель начальника департамента": "подполковник",
    "Начальник управления": "подполковник",
    "Заместитель начальника управления": "майор",
    "Начальник отдела": "майор",
    "Заместитель начальника отдела": "капитан",
    "Старший инспектор": "старший лейтенант",
    "Инспектор": "лейтенант",
    "Дежурный": "прапорщик",
}

SURNAMES = (
    "Абенов", "Жаксылыков", "Оспанов", "Токтаров", "Сериков", "Байжанов",
    "Кусаинов", "Мукашев", "Ахметов", "Есимов", "Нурланов", "Сагитов",
    "Тулегенов", "Искаков", "Досжанов", "Бекенов", "Аманжолов", "Каримов",
    "Рахимов", "Смагулов", "Утегенов", "Шаяхметов", "Ыбраев", "Едилов",
    "Жумабеков", "Калиев", "Мырзабеков", "Оралбаев", "Сапаров", "Тасмагамбетов",
)
MALE_NAMES = (
    "Санжар", "Даулет", "Нурлан", "Азамат", "Ерасыл", "Алишер", "Бекзат",
    "Арман", "Дархан", "Ержан", "Канат", "Мурат", "Нурбол", "Олжас",
    "Рустем", "Самат", "Тимур", "Улан", "Чингиз", "Эльдар",
)
FEMALE_NAMES = (
    "Айгерим", "Динара", "Салтанат", "Асель", "Гульнара", "Жанна", "Камила",
    "Лаура", "Мадина", "Назым", "Райхан", "Сауле", "Толкын", "Улжан", "Шолпан",
)
FATHER_NAMES = (
    "Ерлан", "Марат", "Болат", "Сакен", "Кайрат", "Талгат", "Аскар", "Женис",
    "Куаныш", "Ораз", "Дархан", "Серик", "Нуржан", "Бахыт", "Аслан",
)


class Command(BaseCommand):
    help = "Сажает людей на штатные единицы сида (Plane №198/№204)."

    def add_arguments(self, parser):
        parser.add_argument("--wipe", action="store_true", help="Снять людей сида и освободить слоты.")

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe()
            return

        slots = list(
            StaffUnit.objects.filter(division__code__startswith=DIVISION_CODE_PREFIX)
            .select_related("division", "position")
            .order_by("division__tree_id", "division__lft", "index", "id")
        )
        if not slots:
            raise CommandError(
                "Штатных единиц сида нет: сперва `manage.py seed_staffing`. "
                "Человек без слота в этой системе не служащий, а строка в списке людей."
            )

        ranks = self._ranks()
        created = assigned = kept = 0
        with transaction.atomic():
            for number, slot in enumerate(slots, start=1):
                employee, was_created = self._employee(number, slot, ranks)
                created += int(was_created)
                if slot.employee_id == employee.id:
                    kept += int(not was_created)
                    continue
                if slot.employee_id is not None:
                    kept += 1
                    continue
                slot.employee = employee
                slot.save(update_fields=["employee"])
                assigned += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Люди готовы: заведено {created}, посажено на слоты {assigned}, "
                f"уже было {kept}; всего людей сида "
                f"{Employee.objects.filter(personnel_number__startswith=PERSONNEL_PREFIX).count()}."
            )
        )

    # ── человек ───────────────────────────────────────────────────────────

    def _employee(self, number: int, slot: StaffUnit, ranks: dict[str, Rank]) -> tuple[Employee, bool]:
        personnel_number = f"{PERSONNEL_PREFIX}{number:05d}"
        existing = Employee.objects.filter(personnel_number=personnel_number).first()
        if existing is not None:
            return existing, False

        female = number % 4 == 0
        surname = SURNAMES[number % len(SURNAMES)]
        father = FATHER_NAMES[number % len(FATHER_NAMES)]
        if female:
            surname = self._feminine(surname)
            first_name = FEMALE_NAMES[number % len(FEMALE_NAMES)]
            middle_name = f"{father}овна"
        else:
            first_name = MALE_NAMES[number % len(MALE_NAMES)]
            middle_name = f"{father}ович"

        birth_date = self._birth_date(number)
        position_name = slot.position.name if slot.position else "Инспектор"
        employee = Employee.objects.create(
            personnel_number=personnel_number,
            last_name=surname,
            first_name=first_name,
            middle_name=middle_name,
            birth_date=birth_date,
            gender=Employee.Gender.FEMALE if female else Employee.Gender.MALE,
            iin=self._iin(birth_date, number, female),
            rank=ranks.get(RANK_BY_POSITION.get(position_name, "лейтенант")),
            hire_date=date(2015 + number % 10, 1 + number % 12, 1 + number % 28),
            work_phone=f"+7 (700) {number % 900 + 100:03d}-{number % 90 + 10:02d}-{number % 90 + 10:02d}",
            work_email=f"{PERSONNEL_PREFIX.lower()}{number:05d}@example.kz",
        )
        return employee, True

    @staticmethod
    def _feminine(surname: str) -> str:
        """Женская форма фамилии. Только для окончаний, где правило однозначно."""
        return surname + "а" if surname.endswith(("ов", "ев", "ин")) else surname

    @staticmethod
    def _birth_date(number: int) -> date:
        """Дата рождения выводится из номера — детерминированно и вразнобой.

        Возраст СПЕЦИАЛЬНО не привязан к должности: в жизни он с ней не
        совпадает, а проверять сортировку по возрасту на данных, где он строго
        следует за старшинством, значило бы проверять её на подсказке.
        """
        return date(1970 + number % 30, 1 + number % 12, 1 + number % 28)

    @staticmethod
    def _iin(birth_date: date, number: int, female: bool) -> str:
        """ИИН по стандартной схеме: ГГММДД + век/пол + порядковый + контроль."""
        century_digit = 5 if not female else 6  # 2000-е годы дали бы 5/6, 1900-е — 3/4
        if birth_date.year < 2000:
            century_digit = 3 if not female else 4
        body = (
            f"{birth_date.year % 100:02d}{birth_date.month:02d}{birth_date.day:02d}"
            f"{century_digit}{number % 10000:04d}"
        )
        return body + str(Command._checksum(body))

    @staticmethod
    def _checksum(body: str) -> int:
        digits = [int(d) for d in body]
        control = sum(d * (i + 1) for i, d in enumerate(digits)) % 11
        if control == 10:
            weights = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
            control = sum(d * w for d, w in zip(digits, weights)) % 11
            if control == 10:
                control = 0  # запасной разряд: настоящий ИИН в этом случае просто не выдают
        return control

    def _ranks(self) -> dict[str, Rank]:
        wanted = set(RANK_BY_POSITION.values())
        found = {r.name: r for r in Rank.objects.filter(name__in=wanted)}
        missing = sorted(wanted - set(found))
        if missing:
            raise CommandError(
                "В справочнике званий нет: " + ", ".join(missing) + ". "
                "Сперва `manage.py seed_positions_ranks`."
            )
        return found

    # ── снос ──────────────────────────────────────────────────────────────

    def _wipe(self) -> None:
        people = Employee.objects.filter(personnel_number__startswith=PERSONNEL_PREFIX)
        count = people.count()
        if not count:
            self.stdout.write("Сносить нечего: людей сида нет.")
            return

        busy = [
            employee
            for employee in people
            if employee.statuses.exists() or employee.user_id is not None
        ]
        with transaction.atomic():
            StaffUnit.objects.filter(employee__in=people).update(employee=None)
            people.exclude(pk__in=[e.pk for e in busy]).delete()
        if busy:
            self.stdout.write(
                self.style.WARNING(
                    f"Оставлено людей со статусами или учётной записью: {len(busy)} — "
                    f"их слоты освобождены, но сами записи не удалены: удаление потеряло бы "
                    f"чужую работу."
                )
            )
        self.stdout.write(self.style.SUCCESS(f"Снято со слотов: {count}, удалено {count - len(busy)}."))
