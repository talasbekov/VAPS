"""Одноразовый продюсер golden-корпуса расхода (Story 6.8, Task 3).

Сидит СИНТЕТИЧЕСКОЕ подразделение (~40 сотрудников со статусами, покрывающими
25 последовательных бизнес-дат), затем для каждой даты D:
  build_division_snapshot(div, D)  → snapshot (JSON-safe)
  + staff_map/division_names (заморожены)  → input.json
  + golden.expected_values / expected_document_xml  → expected_values.json / expected_document.xml

Пишет case_NNN/ в golden/. Работа в ОТКАТ-транзакции: файлы на диск пишутся,
строки БД откатываются (чистая БД). Спайк
живёт вне app-кода (spikes/) — он ЛЕГАЛЬНО пишет apps.core.models, чего
consumer/golden_update делать нельзя (арх-гвард operations↛core.models,
Ловушка №7).

Запуск (cwd = Backend/VAPS, DB env как у `make gate`):
  VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps \
  VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 \
  .venv/bin/python ../../spikes/golden-seed/seed_golden_corpus.py
"""

import os
import shutil
import sys
from datetime import date, timedelta

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402

from apps.core.models import (  # noqa: E402
    Division,
    DivisionType,
    Employee,
    Organization,
)
from apps.operations.statuses.models import EmployeeStatus  # noqa: E402
from apps.operations.submissions.golden import (  # noqa: E402
    dumps,
    expected_document_xml,
    expected_values,
    load_input,
)
from apps.operations.submissions.services.snapshot import (  # noqa: E402
    build_division_snapshot,
)

GOLDEN_DIR = os.path.join(
    os.getcwd(), "apps", "operations", "submissions", "tests", "golden"
)

# Коды в порядке, покрывающем все колонки REPORT_COLUMNS + ATTACHED + PENDING;
# EVENT_ASSIGNMENT маппится в IN_SERVICE (как и «без факта»).
_CODES = [
    "SICK_LEAVE",
    "LEAVE_BY_REPORT",
    "VACATION",
    "COMMAND",
    "STUDY",
    "COMPETITION",
    "CONFERENCE",
    "OTHER_ABSENCE",
    "DETACHED",
    "ATTACHED",
    "REST_AFTER_DUTY",
    "BEFORE_DUTY",
    "DUTY",
    "GEV",
    "EVENT_ASSIGNMENT",
    "PENDING_CLARIFICATION",
]
_RANKS = ["", "рядовой", "сержант", "лейтенант", "капитан", "майор", "полковник"]

_WIN_START = date(2026, 5, 1)
_N_DATES = 25
_N_EMPLOYEES = 40
_STAFF = 45  # ≥ max списка → вакансии положительны и варьируются, без violations


def _seed_division():
    org = Organization.objects.create(name="Голден-Орг", code="ORG-GOLDEN")
    div_type, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    div = Division.objects.create(
        organization=org, type_code=div_type, name="Отдел Голден", code="GOLDEN-A"
    )
    for i in range(_N_EMPLOYEES):
        emp = Employee.objects.create(
            iin=f"{700000000000 + i:012d}",
            full_name=f"Сотрудник №{i:02d}",
            rank_code=_RANKS[i % len(_RANKS)],
            position_code="",
            division=div,
            employment_status="WORKING",
        )
        # Каждый ~6-й — без факта (всегда «В строю»); остальные — ОДИН интервал
        # (без пересечений per-employee → GiST hard-overlap не задет).
        if i % 6 == 5:
            continue
        code = _CODES[i % len(_CODES)]
        offset = i % 20
        span = 4 + (i % 6)
        start = _WIN_START + timedelta(days=offset)
        EmployeeStatus.objects.create(
            employee_id=emp.id,
            status_type_code=code,
            date_start=start,
            date_end=start + timedelta(days=span),
            source="USER",
        )
    return div


def _write_case(index, div):
    business_date = _WIN_START + timedelta(days=index - 1)
    snapshot = build_division_snapshot(div.id, business_date)
    div_key = str(div.id)
    input_obj = {
        "snapshot": snapshot,
        "business_date": business_date.isoformat(),
        "division_id": div_key,
        "staff_map": {div_key: _STAFF},
        "division_names": {div_key: div.name},
    }
    inputs = load_input(input_obj)
    values = expected_values(inputs)
    xml = expected_document_xml(inputs)

    case_dir = os.path.join(GOLDEN_DIR, f"case_{index:03d}")
    os.makedirs(case_dir, exist_ok=True)
    with open(os.path.join(case_dir, "input.json"), "w", encoding="utf-8") as fh:
        fh.write(dumps(input_obj))
    with open(
        os.path.join(case_dir, "expected_values.json"), "w", encoding="utf-8"
    ) as fh:
        fh.write(dumps(values))
    with open(os.path.join(case_dir, "expected_document.xml"), "wb") as fh:
        fh.write(xml)
    totals = values["totals"]
    return business_date, totals["list_total"], totals["attached"], totals["vacancies"]


def main():
    if os.path.isdir(GOLDEN_DIR):
        shutil.rmtree(GOLDEN_DIR)
    os.makedirs(GOLDEN_DIR, exist_ok=True)

    with transaction.atomic():
        div = _seed_division()
        summary = [_write_case(i, div) for i in range(1, _N_DATES + 1)]
        transaction.set_rollback(True)  # БД чистая; файлы уже на диске

    print(f"Записано {len(summary)} кейсов в {GOLDEN_DIR}")
    for bd, lst, att, vac in summary:
        print(f"  {bd}: список={lst} attached={att} вакансии={vac}")


if __name__ == "__main__":
    main()
