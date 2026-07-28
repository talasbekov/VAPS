"""Story 7.9/AC-1 — сквозной цикл: выгрузка → сверка (расхождение найдено) →
исправление ИМПОРТ-ПОПРАВКОЙ (повторный запуск import_donor_employees на
исправленной выгрузке донора) → follow-up сверка (0 расхождений).

Ревью-фикс (Acceptance Auditor, проход 1): AC-1's "исправляются
импорт-поправками" была задокументирована только прозой в Dev Notes —
ничего в сюите не доказывало, что повторный запуск донор-импортёра (7.3)
реально закрывает найденное расхождение. Этот файл — недостающее
интеграционное доказательство, не переписывает существующие юнит-тесты.
"""

import copy
import io
import json
from datetime import date
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.core.models import Division
from apps.migration_legacy.roster_export import build_roster_export_rows
from apps.migration_legacy.roster_signature import latest_signature, record_signature

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"
BUSINESS_DATE = date(2026, 6, 4)


def run_import(path):
    out = io.StringIO()
    call_command("import_donor_employees", str(path), stdout=out)
    return out.getvalue()


@pytest.mark.django_db
def test_discrepancy_fixed_by_reimport_then_followup_reconciliation_is_clean(tmp_path):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))

    # 1) baseline import — donor pk4 (Безиинов) has iin=None, so transform
    # skips him (missing_iin): the owner's roster export for DEP1 will show
    # only pk1/pk3, NOT pk4 (who staff_unit says belongs to DEP1 too).
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    run_import(baseline_path)

    dep1 = Division.objects.get(code="DEP1")
    rows_before = build_roster_export_rows(dep1.id, BUSINESS_DATE)
    names_before = {r.full_name for r in rows_before}
    assert (
        "Безиинов Борис" not in names_before
    )  # discrepancy: donor row present, VAPS silent

    # 2) owner sверяет, находит расхождение (донор-строка pk4 не попала в
    # систему из-за отсутствующего ИИН), подписывает сверку с 1 расхождением.
    first_signature = record_signature(
        dep1.id,
        BUSINESS_DATE,
        actor="owner",
        discrepancy_count=1,
        notes="pk4 Безиинов отсутствует в системе — ИИН пуст у донора",
    )
    assert first_signature.discrepancy_count == 1

    # 3) ИМПОРТ-ПОПРАВКА: донор исправил ИИН у pk4 (staff_unit-строка для
    # pk4 уже существует и указывает на DEP1) — повторный запуск ТОЙ ЖЕ
    # команды (Story 7.3, идемпотентна) на исправленной выгрузке.
    corrected = copy.deepcopy(data)
    for row in corrected:
        if row["model"] == "employees.employee" and row["pk"] == 4:
            row["fields"]["iin"] = "800404300404"
    corrected_path = tmp_path / "corrected.json"
    corrected_path.write_text(
        json.dumps(corrected, ensure_ascii=False), encoding="utf-8"
    )
    run_import(corrected_path)

    # 4) FOLLOW-UP сверка: экспорт теперь содержит исправленного сотрудника.
    rows_after = build_roster_export_rows(dep1.id, BUSINESS_DATE)
    names_after = {r.full_name for r in rows_after}
    assert "Безиинов Борис" in names_after
    assert len(rows_after) == len(rows_before) + 1

    second_signature = record_signature(
        dep1.id, BUSINESS_DATE, actor="owner", discrepancy_count=0
    )

    # 5) latest_signature — единственная точка "что сейчас актуально":
    # follow-up (0 расхождений) авторитетен, первая подпись НЕ стёрта.
    assert latest_signature(dep1.id, BUSINESS_DATE).id == second_signature.id
    assert latest_signature(dep1.id, BUSINESS_DATE).discrepancy_count == 0
