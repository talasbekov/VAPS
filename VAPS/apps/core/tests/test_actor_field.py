import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division,
    DivisionType,
    Organization,
    Position,
    StaffingSlot,
    Vacancy,
)
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    d1 = Division.objects.create(organization=org, type_code=dtp, name="D1", code="D1")
    d2 = Division.objects.create(organization=org, type_code=dtp, name="D2", code="D2")
    from apps.core.models import Employee

    emp = Employee.objects.create(
        iin="900101300500",
        full_name="Тест",
        rank_code="MAJOR",
        position_code="OPER",
        division=d1,
    )
    return emp, d1, d2


def test_assign_employee_division_fills_created_by(setup):
    emp, d1, _ = setup
    t0 = timezone.now() - dt.timedelta(days=1)
    record = assign_employee_division(emp, d1, starts_at=t0, actor="u1")
    assert record.created_by == "u1"
    record.refresh_from_db()
    assert record.created_by == "u1"


def test_assign_employee_division_rejects_blank_actor(setup):
    # Blank actor must not masquerade as an identity: NULL means "honestly
    # actorless", an empty string would make that ambiguous.
    emp, d1, _ = setup
    t0 = timezone.now() - dt.timedelta(days=1)
    with pytest.raises(ValidationError):
        assign_employee_division(emp, d1, starts_at=t0, actor="")
    with pytest.raises(ValidationError):
        assign_employee_division(emp, d1, starts_at=t0, actor="  ")


def test_created_by_is_nullable_on_direct_create(setup):
    # Backfill safety: existing rows / writes without an actor stay NULL.
    _, d1, _ = setup
    assert d1.created_by is None
    d1.refresh_from_db()
    assert d1.created_by is None


def test_assign_employee_api_fills_created_by_from_header(setup, grant):
    from rest_framework.test import APIClient

    emp, d1, _ = setup
    from apps.core.models import EmployeeStaffingAssignment

    pos = Position.objects.create(code="OPER2", name="Оператор")
    slot = StaffingSlot.objects.create(
        division=d1, position_code=pos, valid_from=timezone.now()
    )
    client = APIClient()
    # Gate (story 2.14): assign-employee needs personnel.edit; bind hr-7 so the
    # actor_id ("hr-7") still lands in created_by.
    grant(client, user_id="hr-7")
    resp = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)},
        format="json",
    )
    assert resp.status_code == 201
    assignment = EmployeeStaffingAssignment.objects.get(staffing_slot=slot)
    assert assignment.created_by == "hr-7"


def test_assign_employee_api_denies_anonymous_caller(setup):
    # Story 2.14 closes deferred-work.md#L25: assign-employee is gated on
    # personnel.edit, so an anonymous caller (no X-User-Id) is rejected BEFORE
    # the view runs. The actorless, created_by-NULL path is no longer reachable
    # via the API — that was the security hole this test used to document.
    from rest_framework.test import APIClient

    emp, d1, _ = setup
    from apps.core.models import EmployeeStaffingAssignment

    pos = Position.objects.create(code="OPER3", name="Оператор")
    slot = StaffingSlot.objects.create(
        division=d1, position_code=pos, valid_from=timezone.now()
    )
    resp = APIClient().post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)},
        format="json",
    )
    assert resp.status_code == 403
    # Assert it is the RBAC gate (not CSRF/validation) that rejected it.
    assert resp.json().get("detail") == "PERMISSION_DENIED"
    assert not EmployeeStaffingAssignment.objects.filter(staffing_slot=slot).exists()


def test_vacancy_inherits_created_by_from_base(setup):
    _, d1, _ = setup
    pos = Position.objects.create(code="OPER", name="Оператор")
    slot = StaffingSlot.objects.create(
        division=d1, position_code=pos, valid_from=timezone.now()
    )
    vac = Vacancy.objects.create(
        staffing_slot=slot, opened_at=timezone.now(), created_by="hr-1"
    )
    vac.refresh_from_db()
    assert vac.created_by == "hr-1"
