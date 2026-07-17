"""Story 10.10 — детерминированный сид e2e-базы для сквозного Playwright-флоу.

Standalone-скрипт (НЕ management-команда — единственное касание бэкенд-репо,
apps/ не меняется): запускается serve-backend.sh перед runserver. Идемпотентен:
каждый прогон СНОСИТ доменные данные e2e-базы и пересоздаёт их заново —
повторный `npm run test:e2e:flow` зелёный без ручной уборки (AC-6).

Жёсткий гвард имени БД (Ловушка №6): работает ТОЛЬКО с `vaps_e2e` — сид на
`vaps` разработчика или тестовой БД гейта недопустим (проба (е) ревью-гейтов:
запуск с VAPS_DB_NAME=vaps обязан ОТКАЗАТЬСЯ, не «пройти и насорить»).

Состав сида (Д4/Д5 спеки):
- справочники: call_command seed_core / seed_operations / seed_statuses
  (гранты ролей НЕ редактируются — PROVISIONAL, policy Bratan; сид лишь
  НАЗНАЧАЕТ существующую роль ADMIN e2e-пользователю);
- Organization + ОДНА Division (кириллическое имя — type-ahead матчит
  toLocaleLowerCase('ru'), латиница молча мимо — вакуум 9.8);
- 8 сотрудников с кириллическими ФИО (roster_on берёт Employee.division —
  history-строки не нужны, BR-CORE-HISTORY-003 fallback);
- UserRole(user_id="e2e-operator", role=ADMIN, scope=None) — глобальная
  видимость через wildcard `*` (usePermissions фронта понимает `*`);
- ВЧЕРАШНИЙ статус-факт (горизонт данных, Ловушка №2: без него
  assert_report_date_has_data даёт 422 REPORT_NO_DATA_FOR_DATE на любую дату
  и светофор/расход мертвы — ultra-defer 10.4) + prefill 10.1b видит «вчера».

Константы ростера/имён — КОНТРАКТ со спеком frontend/e2e/submission-flow.spec.ts
(ROSTER_SIZE/DIVISION_NAME там же): менять синхронно.
"""

import os
import sys
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from pathlib import Path

EXPECTED_DB_NAME = "vaps_e2e"

# Кириллическое имя подразделения — контракт со спеком (DIVISION_NAME).
DIVISION_NAME = "Отдел дежурной службы"

# 8 кириллических ФИО; порядок грида = sorted(full_name) (селектор 10.1b) —
# спек правит ПЕРВЫЕ ТРИ строки (Абенов/Байжанов/Габитов). Контракт со спеком.
EMPLOYEE_NAMES = [
    "Абенов Арман Серикович",
    "Байжанов Даулет Муратович",
    "Габитов Ержан Талгатович",
    "Досанов Кайрат Женисович",
    "Ералиев Мурат Болатович",
    "Жаксыбеков Нурлан Сабитович",
    "Искаков Тимур Маратович",
    "Молдагулов Асхат Кайратович",
]

E2E_OPERATOR = "e2e-operator"

# Штат подразделения (BR-002): ≥ размера списка, иначе выпуск расхода отказан
# сходимостью (staff_lt_list). 10 слотов на 8 человек = 2 вакансии.
STAFF_SLOTS = 10


def _refuse(reason: str) -> None:
    sys.stderr.write(f"e2e_seed: ОТКАЗ — {reason}\n")
    sys.exit(2)


def _guard_env() -> None:
    """Гвард ДО django.setup(): чужая БД не должна быть даже открыта."""
    if os.environ.get("VAPS_DB") != "postgres":
        _refuse("требуется VAPS_DB=postgres (e2e-сид не работает на SQLite)")
    db_name = os.environ.get("VAPS_DB_NAME")
    if db_name != EXPECTED_DB_NAME:
        _refuse(
            f"VAPS_DB_NAME={db_name!r}, ожидается {EXPECTED_DB_NAME!r} — "
            "сид отказывается трогать не-e2e базу"
        )


def main() -> None:
    _guard_env()

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    import django

    django.setup()

    from django.conf import settings

    # Пояс-и-подтяжки: env мог быть перекрыт настройками — сверяем фактическое.
    actual = settings.DATABASES["default"]["NAME"]
    if actual != EXPECTED_DB_NAME:
        _refuse(f"фактическая БД {actual!r} != {EXPECTED_DB_NAME!r}")

    from django.core.management import call_command
    from django.db import transaction

    from apps.core.clock import Clock
    from apps.core.models import (
        Division,
        DivisionHistoricalSlot,
        Employee,
        Organization,
    )
    from apps.documents.models import Attachment, IssuedDocument
    from apps.operations.rbac.models import UserRole
    from apps.operations.statuses.models import EmployeeStatus
    from apps.operations.submissions.models import (
        DailySubmission,
        DivisionNotifyRecipient,
        SubmissionControlSettings,
        TomorrowBlockOverride,
    )

    today = Clock.today_local()  # +05 бизнес-пояс == машинный пояс прогона
    yesterday = today - timedelta(days=1)

    with transaction.atomic():
        # --- Чистка доменных данных (порядок: PROTECT/FK-зависимости) ---
        IssuedDocument.objects.all().delete()
        Attachment.objects.all().delete()
        DailySubmission.objects.all().delete()
        TomorrowBlockOverride.objects.all().delete()
        DivisionNotifyRecipient.objects.all().delete()
        SubmissionControlSettings.objects.all().delete()
        EmployeeStatus.objects.all().delete()
        Employee.objects.all().delete()  # history каскадится
        Division.objects.all().delete()
        Organization.objects.all().delete()
        UserRole.objects.all().delete()

        # --- Справочники (идемпотентные канонические сиды) ---
        call_command("seed_core")
        call_command("seed_operations")
        call_command("seed_statuses")

        # --- Оргструктура ---
        org = Organization.objects.create(code="E2E_ORG", name="Е2Е Организация")
        division = Division.objects.create(
            organization=org,
            type_code_id="division",
            name=DIVISION_NAME,
            code="E2E_DIV",
        )

        # --- Штат (BR-002): без записи DivisionHistoricalSlot выпуск расхода
        #     падает 422 REPORT_NOT_CONVERGENT (no_staffing_record +
        #     staff_lt_list) — сходимость требует штат ≥ список. 10 слотов на
        #     8 человек списка → 2 вакансии.
        DivisionHistoricalSlot.objects.create(
            division=division,
            allocated_slots=STAFF_SLOTS,
            valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc),
        )

        # --- Ростер (Employee.division — fallback roster_on, history не нужна) ---
        employees = Employee.objects.bulk_create(
            Employee(
                iin=f"9001013{index:05d}",
                full_name=name,
                rank_code="LT",
                position_code="OPER",
                division=division,
                data_source="E2E",
            )
            for index, name in enumerate(EMPLOYEE_NAMES)
        )

        # --- Роль e2e-оператора: НАЗНАЧЕНИЕ существующей ADMIN (`*`),
        #     scope=None → глобальная видимость (Д5). Гранты ролей не трогаем.
        UserRole.objects.create(
            user_id=E2E_OPERATOR, role_code_id="ADMIN", scope_division_id=None
        )

        # --- Горизонт данных: вчерашний однодневный факт [вчера, сегодня) у
        #     ПОСЛЕДНЕГО по алфавиту сотрудника (спек его не правит); сегодня
        #     он уже COMPLETED → в расход дня не попадает. Заодно кормит
        #     prefill 10.1b «вчерашней расстановкой».
        EmployeeStatus.objects.create(
            employee_id=employees[-1].id,
            status_type_code="DUTY",
            date_start=yesterday,
            date_end=today,
            source=EmployeeStatus.Source.USER,
            created_by=E2E_OPERATOR,
        )

    sys.stdout.write(
        f"e2e_seed: OK — БД {EXPECTED_DB_NAME}, подразделение «{DIVISION_NAME}», "
        f"ростер {len(EMPLOYEE_NAMES)}, горизонт с {yesterday.isoformat()}\n"
    )


if __name__ == "__main__":
    main()
