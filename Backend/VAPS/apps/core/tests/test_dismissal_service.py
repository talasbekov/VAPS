"""Story 2.5 — core dismissal service (archive + interval + slot→vacancy).

Postgres-only (django_db needs the EmployeeStatus EXCLUDE schema, как в 2.4).
"""

import datetime as dt

import pytest
from django.core.exceptions import ValidationError

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    EmployeeStaffingAssignment,
    Organization,
    Position,
    StaffingSlot,
    Vacancy,
)
from apps.core.selectors import HistoricalEmployeeSelector, local_midnight
from apps.core.services import (
    assign_employee_division,
    compute_free_slots,
    dismiss_employee,
)

pytestmark = pytest.mark.django_db

D = dt.date(2026, 6, 15)


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер")
    slot = StaffingSlot.objects.create(
        division=div, position_code=pos, valid_from=local_midnight(dt.date(2026, 6, 1))
    )
    emp = Employee.objects.create(
        iin="900101300600",
        full_name="Тест",
        rank_code="MAJOR",
        position_code="OPER",
        division=div,
    )
    return org, div, pos, slot, emp


def test_dismiss_archives_without_hard_delete(setup):
    _, _, _, _, emp = setup
    dismiss_employee(emp, date=D, reason="по собственному", actor="op1")
    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.ARCHIVED
    assert emp.is_active is False
    assert emp.dismissal_date == D
    assert emp.separated_at == local_midnight(D)
    assert Employee.objects.filter(id=emp.id).exists()  # soft-delete, not removed


def test_dismiss_closes_division_interval_without_deleting(setup):
    _, div, _, _, emp = setup
    assign_employee_division(
        emp, div, starts_at=local_midnight(dt.date(2026, 6, 1)), actor="op1"
    )
    dismiss_employee(emp, date=D, reason=None, actor="op1")
    interval = EmployeeDivisionHistory.objects.get(employee=emp)
    assert interval.ends_at == local_midnight(D)  # closed, history preserved


def test_dismiss_frees_slot_and_opens_vacancy(setup):
    _, div, _, slot, emp = setup
    EmployeeStaffingAssignment.objects.create(
        employee=emp, staffing_slot=slot, starts_at=local_midnight(dt.date(2026, 6, 1))
    )
    dismiss_employee(emp, date=D, reason="расформирование", actor="op1")
    assignment = EmployeeStaffingAssignment.objects.get(employee=emp)
    assert assignment.ends_at == local_midnight(D)
    vacancy = Vacancy.objects.get(staffing_slot=slot)
    assert vacancy.status_code == Vacancy.Status.OPEN
    assert vacancy.opened_at == local_midnight(D)
    assert vacancy.reason == "расформирование"
    free_ids = {s.id for s in compute_free_slots(div.id, on_date=local_midnight(D))}
    assert slot.id in free_ids


def test_dismissed_employee_drops_from_roster(setup):
    _, div, _, _, emp = setup
    dismiss_employee(emp, date=D, reason=None, actor="op1")
    assert emp.id not in HistoricalEmployeeSelector.roster_on(D).get(div.id, [])


def test_re_dismiss_non_working_rejected(setup):
    _, _, _, _, emp = setup
    dismiss_employee(emp, date=D, reason=None, actor="op1")
    with pytest.raises(ValidationError):
        dismiss_employee(emp, date=D, reason=None, actor="op1")


def test_dismiss_before_interval_start_rejected(setup):
    _, div, _, _, emp = setup
    assign_employee_division(
        emp, div, starts_at=local_midnight(dt.date(2026, 6, 20)), actor="op1"
    )
    with pytest.raises(ValidationError):
        dismiss_employee(emp, date=D, reason=None, actor="op1")
    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.WORKING  # rolled back


def test_dismiss_blank_actor_rejected(setup):
    _, _, _, _, emp = setup
    with pytest.raises(ValidationError):
        dismiss_employee(emp, date=D, reason=None, actor="  ")
