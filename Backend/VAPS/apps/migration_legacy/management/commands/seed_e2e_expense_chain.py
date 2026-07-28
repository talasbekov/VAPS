"""Story 10.10 — детерминированная фикстура ЦЕПОЧКИ «bulk → сдача → светофор → расход».

ТЕСТОВАЯ ФИКСТУРА для live-e2e (``npm run test:e2e:live``), не прод-код: готовит
БД так, чтобы один ADMIN-актор в настоящем браузере прошёл весь критичный путь
пилота, и печатает выбранный день/подразделение/актора машинно-читаемо
(``E2E_DAY=``/``E2E_DIVISION=``/``E2E_ACTOR=``/``E2E_EMPLOYEES=``).

Почему день выбирает КОМАНДА, а не спека: единственный легальный источник
бизнес-даты — серверные часы (``Clock``, ``Asia/Qyzylorda``). ``clock.override``
это ``ContextVar`` — границу процесса он не пересекает, поэтому живая спека часы
сервера заморозить не может и обязана взять дату отсюда.

Почему команда живёт в ``migration_legacy`` (Решение №2 стори): цепочке нужны
записи ОБОИХ контекстов — ``Division``/``Employee``/``DivisionHistoricalSlot``
(core) и ``UserRole``/``SubmissionControlSettings``/``DailySubmission``
(operations). ``apps.operations`` не имеет права импортировать
``apps.core.models`` (гвард ``apps/operations/tests/test_isolation.py``, он
сканирует только ``apps/operations``), а ``apps.core`` документированно свободен
от импортов ``apps.operations``. ``migration_legacy`` — единственное место, где
кросс-контекстная запись уже узаконена: ``import_donor_slice.py`` импортирует и
``apps.core.models``, и ``apps.operations.statuses.models``.

🔴 ОСОЗНАННОЕ ОТСТУПЛЕНИЕ: ``apps/documents/models.py:162-164`` объявляет
hard-delete ``IssuedDocument`` запрещённым («delete-путей не заводить»,
architecture §Process Patterns). Здесь он делается в ТЕСТОВОЙ ФИКСТУРЕ, а не в
прод-коде, и без него второй прогон подряд получает 409 ``DOCUMENT_ALREADY_ISSUED``
— то есть идемпотентность, которой требует AC-9, недостижима. Прод-путей удаления
эта команда не открывает: сервис ``issue_expense_document`` её не знает.
"""

from datetime import date, time, timedelta
from uuid import UUID

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.clock import Clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    Employee,
    EmployeeDivisionHistory,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.documents.models import Attachment, IssuedDocument
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import (
    DailySubmission,
    SubmissionControlSettings,
)

# ФИКСИРОВАННЫЙ, а не случайный: случайный UUID сделал бы прогоны неповторяемыми
# (каждый прогон плодил бы новое подразделение, а уборка на входе не находила бы
# прошлое). Тот же приём, что в seed_e2e_lagging:32-36 — и намеренно ДРУГОЙ id:
# оба сида живут в одной БД `vaps`, пересечение сделало бы сьюты зависимыми.
E2E_CHAIN_DIVISION_ID = UUID("e2e00000-0000-4000-8000-000000000010")

# Справочные коды — из seed_core, а не выдуманные: `denorm_for` резолвит ранг по
# справочнику (core/selectors.py:194-217), а `Division.type_code` — FK с PROTECT.
DIVISION_TYPE_CODE = "division"
RANK_CODE = "CPT"
POSITION_CODE = "OPER"

DEFAULT_ACTOR = "e2e-chain-operator"
DEFAULT_EMPLOYEES = 3

# Story 10.10a — ДВЕ ДОПОЛНИТЕЛЬНЫЕ реальные роли на ТОМ ЖЕ подразделении,
# рядом с `DEFAULT_ACTOR`/ADMIN (10.10, Решение №3 — единственная роль,
# покрывающая ВЕСЬ путь целиком). `OPERATOR_ACTOR`/DIVISION_OPERATOR держит
# daily_report.mark_update+status.view+document.view (сдача+светофор+
# скачивание); `ISSUER_ACTOR`/ORGD держит daily_report.generate+document.view
# (выпуск+скачивание). Ни одна не покрывает status.manage (bulk) — тот
# по-прежнему только у ADMIN/DEFAULT_ACTOR (см. _ensure_role docstring).
OPERATOR_ACTOR = "e2e-chain-operator-div"
ISSUER_ACTOR = "e2e-chain-issuer-orgd"

# Кириллица (грид матчит type-ahead через toLocaleLowerCase('ru') — латиница
# молча промахивается, урок 9.8/9.9) и РАЗЛИЧИМЫЕ первые буквы: спека вправе
# целиться в конкретную строку.
SURNAMES = [
    ("Абдиров", "Арман", "Ерланович"),
    ("Бекенов", "Бахыт", "Серикович"),
    ("Ватанов", "Вадим", "Петрович"),
    ("Галиев", "Галым", "Маратович"),
    ("Дюсенов", "Данияр", "Кайратович"),
]


class Command(BaseCommand):
    help = (
        "Засеять контур цепочки расхода для live-e2e (10.10): корневое "
        "бездетное подразделение, состав, слоты штата, якорь горизонта "
        "данных и ADMIN-роль актору. Идемпотентна: уборка на ВХОДЕ. "
        "Печатает E2E_DAY/E2E_DIVISION/E2E_ACTOR/E2E_EMPLOYEES."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--actor",
            default=DEFAULT_ACTOR,
            help=(
                "Плоский actor id (обязан быть ASCII — значение уезжает "
                f"идентифицирующим заголовком). По умолчанию {DEFAULT_ACTOR}."
            ),
        )
        parser.add_argument(
            "--employees",
            type=int,
            default=DEFAULT_EMPLOYEES,
            help=f"Размер состава подразделения. По умолчанию {DEFAULT_EMPLOYEES}.",
        )
        parser.add_argument(
            "--day",
            help="Бизнес-дата (YYYY-MM-DD); по умолчанию сегодня по Clock.",
        )

    def handle(self, *args, **options):
        actor = options["actor"]
        if not actor.isascii():
            # Кириллица отклоняется ещё до сети (идентифицирующий заголовок) — находка
            # 11.3. Валимся громко, а не «экран показал пустой список».
            raise CommandError(
                f"--actor {actor!r} не ASCII: значение уезжает "
                "идентифицирующим заголовком, где кириллица отклоняется ещё "
                "до сети (находка 11.3). Кириллица допустима только в телах "
                "данных."
            )

        employees_count = options["employees"]
        if employees_count < 1:
            raise CommandError(
                f"--employees {employees_count}: состав не может быть пустым — "
                "подразделение с пустым составом светофор красит NEUTRAL "
                "(traffic_light.py:266-271), и цепочка ничего не доказывает."
            )
        if employees_count > len(SURNAMES):
            raise CommandError(
                f"--employees {employees_count} > {len(SURNAMES)}: в фикстуре "
                f"заведено {len(SURNAMES)} различимых ФИО."
            )

        if options.get("day"):
            try:
                day = date.fromisoformat(options["day"])
            except ValueError as exc:
                raise CommandError(
                    f"неверный --day {options['day']!r}: ожидается YYYY-MM-DD"
                ) from exc
        else:
            # СЕГОДНЯ, а не «вчера» как в 11.6: окно сдачи — [today, today+1]
            # по серверным часам (day_submission_service.py:57-60), вчерашний
            # день через API сдать нельзя.
            day = Clock.today_local()

        # Справочники — предпосылка, а не дубль. Все три идемпотентны; вызываем
        # их здесь, чтобы спека делала РОВНО один вызов manage.py и порядок был
        # гарантирован (rank_code/position_code/type_code и роль ADMIN обязаны
        # существовать до создания фикстурных строк).
        for command in ("seed_core", "seed_operations", "seed_statuses"):
            call_command(command, verbosity=0)

        with transaction.atomic():
            self._cleanup()
            division = self._ensure_org_and_division()
            employee_ids = self._ensure_employees(division, employees_count, day)
            self._ensure_staffing(division, employees_count, day)
            self._ensure_history(division, employee_ids, day)
            self._ensure_role(actor)
            self._ensure_multi_actor_roles()
            self._reset_control_settings()

        self.stdout.write(f"E2E_DAY={day.isoformat()}")
        self.stdout.write(f"E2E_DIVISION={E2E_CHAIN_DIVISION_ID}")
        self.stdout.write(f"E2E_ACTOR={actor}")
        self.stdout.write(f"E2E_OPERATOR_ACTOR={OPERATOR_ACTOR}")
        self.stdout.write(f"E2E_ISSUER_ACTOR={ISSUER_ACTOR}")
        self.stdout.write(f"E2E_EMPLOYEES={employees_count}")
        self.stdout.write(
            self.style.SUCCESS(
                f"сид готов: подразделение {E2E_CHAIN_DIVISION_ID}, состав "
                f"{employees_count}, день {day.isoformat()}, актор {actor}"
            )
        )

    # ------------------------------------------------------------------ уборка

    def _cleanup(self):
        """Уборка на ВХОДЕ (канон seed_e2e_lagging), не на выходе.

        🔴 Порядок несущий: ``IssuedDocument.attachment`` — PROTECT,
        ``supersedes`` — self-PROTECT (documents/models.py:181-186); обратный
        порядок даёт ``ProtectedError``. Без уборки второй прогон получает
        409 ``DAY_ALREADY_SUBMITTED`` (day_submission_service.py:143-151) и
        409 ``DOCUMENT_ALREADY_ISSUED`` (document_release_service.py:263-276).
        """
        employee_ids = list(
            Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).values_list(
                "id", flat=True
            )
        )

        # 1. Выпуски — от НОВЫХ к старым: новый выпуск ссылается на старый через
        # `supersedes`, значит у самого нового входящих ссылок нет. Пачкой
        # удалять нельзя — коллектор наткнётся на self-PROTECT внутри цепи.
        documents = list(
            IssuedDocument.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).order_by(
                "-created_at"
            )
        )
        attachment_ids = [doc.attachment_id for doc in documents]
        for doc in documents:
            doc.delete()

        # 2. Байты выпусков. Файл под VAPS_PRIVATE_STORAGE_ROOT ОСИРОТЕЕТ — это
        # принято сознательно: осиротевшие файлы штатно допускаются
        # (document_release_service.py:25-29).
        Attachment.objects.filter(id__in=attachment_ids).delete()

        # 3. Сдачи дня — иначе 409 DAY_ALREADY_SUBMITTED на втором прогоне.
        DailySubmission.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).delete()

        # 4. Отклонения. Плоский employee_id (ARCH-003), не FK.
        if employee_ids:
            EmployeeStatus.objects.filter(employee_id__in=employee_ids).delete()

        # 5. ⚠️ У DivisionHistoricalSlot НЕТ ни одного unique-constraint —
        # повторный create копил бы строки. Сносим и создаём заново.
        DivisionHistoricalSlot.objects.filter(
            division_id=E2E_CHAIN_DIVISION_ID
        ).delete()

        # 6. Якорь горизонта данных — тоже без unique, тот же приём.
        EmployeeDivisionHistory.objects.filter(
            division_id=E2E_CHAIN_DIVISION_ID
        ).delete()

    # ----------------------------------------------------------------- создание

    def _ensure_org_and_division(self) -> Division:
        """Организация + КОРНЕВОЙ БЕЗДЕТНЫЙ ``Division`` с фиксированным UUID.

        Корневой и бездетный не по вкусу: светофор катит статус вверх по дереву
        (traffic_light.py:328), и один несдавший потомок с непустым составом
        покрасил бы родителя RED.

        🔴 ``update_or_create``, а не ``create``: ``Organization.code`` unique
        (core/models.py:84), ``Division`` — ``UniqueConstraint(organization,
        code)`` (:165-168). Ни одна из таблиц не входит в уборку, поэтому
        прямой ``create`` на втором прогоне дал бы ``IntegrityError``.
        """
        organization, _ = Organization.objects.update_or_create(
            code="E2E-CHAIN-ORG",
            defaults={"name": "E2E цепочка расхода", "is_active": True},
        )
        division, _ = Division.objects.update_or_create(
            id=E2E_CHAIN_DIVISION_ID,
            defaults={
                "organization": organization,
                "parent": None,
                "type_code_id": DIVISION_TYPE_CODE,
                "name": "Отдел цепочки E2E",
                "code": "E2E-CHAIN-DIV",
                "is_active": True,
            },
        )
        return division

    def _ensure_employees(self, division, count, day) -> list:
        """Состав подразделения — ключ ``iin`` (unique, core/models.py:192).

        ``employment_status=WORKING`` И ``is_active=True`` — оба предиката
        несущие: ``roster_on``/``working_by_division`` фильтруют по обоим
        (core/selectors.py:221-226, :344-348). ``hire_date`` заведомо раньше
        дня. ``iin`` — 12 цифр (валидатор core/validators.py:3-5 — ТОЛЬКО
        regex, без контрольной суммы).
        """
        hire_date = day - timedelta(days=365)
        employee_ids = []
        for index in range(count):
            last, first, middle = SURNAMES[index]
            employee, _ = Employee.objects.update_or_create(
                iin=f"9900000000{index:02d}",
                defaults={
                    "full_name": f"{last} {first} {middle}",
                    "last_name": last,
                    "first_name": first,
                    "middle_name": middle,
                    "rank_code": RANK_CODE,
                    "position_code": POSITION_CODE,
                    "division": division,
                    "is_active": True,
                    "is_attached_force": False,
                    "employment_status": Employee.EmploymentStatus.WORKING,
                    "hire_date": hire_date,
                    "dismissal_date": None,
                    "data_source": "E2E_FIXTURE",
                },
            )
            employee_ids.append(employee.id)

        # Лишний состав от прогона с БОЛЬШИМ --employees. Уборка на входе ходит
        # по ПОДРАЗДЕЛЕНИЮ (статусы/история/слоты), но сами Employee она не
        # трогает — они upsert'ятся по фиксированному `iin`. Без этой строки
        # прогон `--employees 3` после `--employees 5` оставил бы двух лишних в
        # списочном составе, и сверка `list_total == E2E_EMPLOYEES` (AC-8.3)
        # упала бы, показывая на цепочку вместо фикстуры. Ссылки на Employee —
        # только CASCADE (EmployeeDivisionHistory, EmployeeStaffingAssignment,
        # UserEmployeeBinding), PROTECT среди них нет.
        Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).exclude(
            id__in=employee_ids
        ).delete()
        return employee_ids

    def _ensure_staffing(self, division, count, day):
        """🔴 ``DivisionHistoricalSlot`` — звено, без которого цепочка проходит
        ТРИ шага из четырёх и падает на последнем.

        Без строки ``staff_map`` пуст → warning ``no_staffing_record``
        (statuses/services/strength_report.py:174-179) → 422
        ``REPORT_NOT_CONVERGENT``, потому что выпуск отменяют И warnings, И
        violations (document_release_service.py:230-239). Второй producer —
        violation ``staff_lt_list`` при ``allocated_slots < list_total``
        (:187-197), поэтому ЗАПАС, а не равенство.

        BR-002: слот действует при ``valid_from <= T AND (valid_to IS NULL OR
        valid_to > T)`` (core/selectors.py:243-266).
        """
        DivisionHistoricalSlot.objects.create(
            division=division,
            allocated_slots=count + 2,
            valid_from=local_midnight(day - timedelta(days=365)),
            valid_to=None,
        )

    def _ensure_history(self, division, employee_ids, day):
        """🔴 ``EmployeeDivisionHistory`` — ЯКОРЬ ГОРИЗОНТА ДАННЫХ.

        ``assert_report_date_has_data`` (submissions/services/
        expense_read_service.py:31-74) считает горизонт как ``min(earliest
        EmployeeStatus.date_start, earliest EmployeeDivisionHistory.starts_at)``
        и при ``None`` БЕЗУСЛОВНО отдаёт 422 ``REPORT_NO_DATA_FOR_DATE``.
        Вызывается И светофором (submissions/api/views.py:596), И выпуском
        расхода (:306). Уборка стирает ``EmployeeStatus`` → на свежей БД сразу
        после сида горизонт был бы пуст, и светофор 422-ил бы ещё ДО всякой
        сдачи. Плюс это настоящий путь ``roster_on``, а не фолбэк
        BR-CORE-HISTORY-003.
        """
        starts_at = local_midnight(day - timedelta(days=365))
        EmployeeDivisionHistory.objects.bulk_create(
            [
                EmployeeDivisionHistory(
                    employee_id=employee_id,
                    division=division,
                    starts_at=starts_at,
                    ends_at=None,
                    source="E2E_FIXTURE",
                )
                for employee_id in employee_ids
            ]
        )

    def _ensure_role(self, actor):
        """Один ADMIN-актор на всю цепочку (Решение №3).

        Цепочка гейтится семью разными правами, и по
        ``seed_operations.ROLE_PERMISSIONS`` ни одна не-ADMIN роль их не
        покрывает: ``DIVISION_OPERATOR`` не имеет ни ``status.manage``, ни
        ``daily_report.generate``; ``ORGD``/``OMD`` — ни
        ``daily_report.mark_update``, ни ``status.view``.

        ``scope_division_id=NULL`` = глобальный скоуп. Unique-constraint
        ``(user_id, role_code, scope_division_id)`` при NULL на уровне БД не
        срабатывает (NULL != NULL в Postgres), но ``update_or_create`` делает
        ``get`` с ``IS NULL`` — идемпотентность держится ORM'ом.

        🔴 НАХОДКА КРАСНОЙ ПРОБЫ №5. Первая редакция делала только
        ``update_or_create`` — и роли актора НАКАПЛИВАЛИСЬ между прогонами:
        мутация «выдать DIVISION_OPERATOR вместо ADMIN» оставила прогон
        ЗЕЛЁНЫМ, потому что ADMIN-строка от предыдущего прогона никуда не
        делась, и права по-прежнему объединялись в полный набор. Фикстура, чьё
        RBAC-состояние зависит от истории прогонов, не детерминирована по
        определению, а проба, которую она гасит, — вакуумна. Поэтому роли
        актора сносятся ПОЛНОСТЬЮ, и итог — чистая функция от ``--actor``.
        """
        UserRole.objects.filter(user_id=actor).delete()
        UserRole.objects.update_or_create(
            user_id=actor,
            role_code_id="ADMIN",
            scope_division_id=None,
            defaults={"is_active": True},
        )

    def _ensure_multi_actor_roles(self):
        """Story 10.10a — два ДОПОЛНИТЕЛЬНЫХ реальных актора на том же
        подразделении, для многоактёрного прогона (`OPERATOR_ACTOR`/
        `ISSUER_ACTOR`). Тот же приём идемпотентности, что `_ensure_role`
        (красная проба №5, 10.10): роли сносятся ПОЛНОСТЬЮ перед пересозданием
        — иначе накопление между прогонами делает RBAC-состояние
        недетерминированным.

        `scope_division_id=E2E_CHAIN_DIVISION_ID`, НЕ `None`: в отличие от
        ADMIN (глобальный скоуп по построению роли), реалистичный оператор/
        орг.дежурный видит СВОЁ подразделение — тест обязан пройти со scoped-
        грантом, не глобальным, иначе он не проверял бы то, что заявляет.
        """
        for actor in (OPERATOR_ACTOR, ISSUER_ACTOR):
            UserRole.objects.filter(user_id=actor).delete()
        UserRole.objects.update_or_create(
            user_id=OPERATOR_ACTOR,
            role_code_id="DIVISION_OPERATOR",
            scope_division_id=E2E_CHAIN_DIVISION_ID,
            defaults={"is_active": True},
        )
        UserRole.objects.update_or_create(
            user_id=ISSUER_ACTOR,
            role_code_id="ORGD",
            scope_division_id=E2E_CHAIN_DIVISION_ID,
            defaults={"is_active": True},
        )

    def _reset_control_settings(self):
        """Сброс singleton'а — защита от протечки ``seed_e2e_lagging``.

        Тот сид оставляет ``required_division_ids=[<его UUID>]`` и
        ``control_hour=00:00`` в ТОЙ ЖЕ БД ``vaps``. Непустой список
        «необходимых управлений» дал бы ``TOMORROW_BLOCKED`` на чужой несдаче,
        а нулевой контрольный час — вечное ``late=True``.

        ``control_hour = 23:59`` СУЖАЕТ, но НЕ устраняет зависимость от времени
        суток: ``_is_late()`` сравнивает СЕРВЕРНОЕ локальное время строгим
        ``>``, а часы сервера спека заморозить не может. Поэтому ассертить
        бейдж «сдано с опозданием» спека не имеет права ни в одну сторону.

        ``default_notify_recipient`` НЕ трогаем: он принадлежит контуру 11.6, и
        перезапись сделала бы сьюты зависимыми в обратную сторону.
        """
        SubmissionControlSettings.objects.update_or_create(
            singleton_key=1,
            defaults={
                "required_division_ids": [],
                "control_hour": time(23, 59),
            },
        )
