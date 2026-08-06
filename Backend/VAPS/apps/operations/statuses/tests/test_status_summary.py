"""Story 20.6a (FR-40): compute_status_summary() — именованная обёртка над
StrengthReportService.compute().totals (уже существующий расчёт, эта стори
даёт ему явный контракт для будущего отчёта «сводка по статусам»)."""

import itertools
from datetime import date

import pytest

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services import StrengthReportService
from apps.operations.statuses.services.strength_report import (
    ReportTotals,
    compute_status_summary,
)

pytestmark = pytest.mark.django_db

D = date(2026, 6, 4)
_iin_seq = itertools.count(200)


@pytest.fixture
def org():
    return Organization.objects.create(name="Орг", code="ORG-SS")


def make_division(org, name, code, parent=None):
    division_type, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    return Division.objects.create(
        organization=org, type_code=division_type, name=name, code=code, parent=parent
    )


def make_employee(division):
    n = next(_iin_seq)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(employee, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
    )


def make_slot(division, slots):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 6, 1)),
    )


def test_org_wide_summary_matches_direct_call(org):
    div = make_division(org, "Отдел А", "SS-A")
    emp = make_employee(div)
    make_slot(div, 1)
    make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))

    summary = compute_status_summary(D)
    direct = StrengthReportService.compute(D).totals

    assert summary == direct
    assert summary.columns["VACATION"] == 1


def test_division_scoped_summary_matches_direct_call(org):
    div_a = make_division(org, "Отдел А", "SS-B")
    div_b = make_division(org, "Отдел Б", "SS-C")
    make_employee(div_a)
    make_employee(div_b)
    make_slot(div_a, 1)
    make_slot(div_b, 1)

    summary = compute_status_summary(D, division_id=div_a.id)
    direct = StrengthReportService.compute(D, division_id=div_a.id).totals

    assert summary == direct
    assert summary.list_total == 1


def test_division_scoped_summary_covers_real_subtree(org):
    # Review (Blind Hunter): исходный division-scoped тест использовал
    # СОСЕДНИЕ (не parent/child) подразделения — не доказывал реальную
    # агрегацию по ПОДДЕРЕВУ. Тот же fixture-паттерн, что
    # test_strength_report_service.py::test_division_id_scopes_to_subtree.
    parent = make_division(org, "Родитель", "SS-P")
    child = make_division(org, "Ребёнок", "SS-CH", parent=parent)
    outsider = make_division(org, "Чужой", "SS-OUT")
    for d in (parent, child, outsider):
        make_employee(d)
        make_slot(d, 1)

    summary = compute_status_summary(D, division_id=parent.id)
    direct = StrengthReportService.compute(D, division_id=parent.id).totals

    assert summary == direct
    # 2 сотрудника (родитель+ребёнок), НЕ 3 (чужой не входит в поддерево).
    assert summary.list_total == 2


def test_returns_report_totals_shape(org):
    div = make_division(org, "Отдел А", "SS-D")
    make_employee(div)
    make_slot(div, 1)

    summary = compute_status_summary(D)

    assert isinstance(summary, ReportTotals)
    assert hasattr(summary, "staff_total")
    assert hasattr(summary, "list_total")
    assert hasattr(summary, "vacancies")
    assert hasattr(summary, "columns")
    assert hasattr(summary, "attached")
    assert set(summary.columns) == {
        "SICK",
        "VACATION",
        "COMMAND",
        "TRAINING",
        "OTHER",
        "DETACHED",
        "AFTER_DUTY",
        "BEFORE_DUTY",
        "ON_DUTY",
        "PENDING",
        "IN_SERVICE",
    }
