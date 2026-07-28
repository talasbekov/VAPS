"""Story 7.9/AC-1 — выгрузка ростера «как в системе» через канон roster_on()."""

import itertools
from datetime import date

import pytest

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    Organization,
    Position,
    Rank,
)
from apps.core.selectors import HistoricalEmployeeSelector, local_midnight
from apps.migration_legacy.roster_export import build_roster_export_rows

pytestmark = pytest.mark.django_db

_iin = itertools.count(700)
ON_DATE = date(2026, 6, 4)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-RE")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="RE-A"
    )


@pytest.fixture
def other_division():
    org = Organization.objects.create(name="Орг2", code="ORG-RE2")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Другой отдел", code="RE-B"
    )


def make_employee(division, *, full_name=None, rank_code="", position_code=""):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=full_name or f"Сотрудник {n}",
        rank_code=rank_code,
        position_code=position_code,
        division=division,
        employment_status=Employee.EmploymentStatus.WORKING,
        is_active=True,
        personnel_number=f"PN-{n}",
    )


def test_rows_match_roster_on_membership(division, other_division):
    e1 = make_employee(division, full_name="Иванов И.И.")
    make_employee(other_division)  # noise — must not appear

    rows = build_roster_export_rows(division.id, ON_DATE)

    assert [r.employee_id for r in rows] == [str(e1.id)]


def test_rows_denormalize_rank_and_position_names(division):
    Rank.objects.create(code="LT", name="Лейтенант")
    Position.objects.create(code="CMD", name="Командир взвода")
    make_employee(
        division, full_name="Иванов И.И.", rank_code="LT", position_code="CMD"
    )

    rows = build_roster_export_rows(division.id, ON_DATE)

    assert rows[0].rank_name == "Лейтенант"
    assert rows[0].position_name == "Командир взвода"


def test_no_members_returns_empty_list(division):
    assert build_roster_export_rows(division.id, ON_DATE) == []


def test_rows_use_history_covering_interval_not_current_division(
    division, other_division
):
    """Сотрудник СЕЙЧАС в other_division, но на ON_DATE был в division —
    выгрузка должна отражать историю, а не текущее Employee.division
    (тот же канон, что roster_on)."""
    employee = make_employee(other_division, full_name="Петров П.П.")
    t = local_midnight(ON_DATE)
    EmployeeDivisionHistory.objects.create(
        employee=employee,
        division=division,
        starts_at=t,
        ends_at=None,
    )
    # sanity: roster_on itself agrees
    assert HistoricalEmployeeSelector.roster_on(ON_DATE, [division.id]) == {
        division.id: [employee.id]
    }

    rows = build_roster_export_rows(division.id, ON_DATE)

    assert [r.employee_id for r in rows] == [str(employee.id)]
