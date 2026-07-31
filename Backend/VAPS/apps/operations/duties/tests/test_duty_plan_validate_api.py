"""Story 14.11f — POST /api/operations/duty-plans/{id}/validate."""

import uuid

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole
from apps.operations.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def duty_manager_client(seeded):
    role = Role.objects.create(code="TEST_DUTY_MANAGER_V", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-v", role_code=role)
    return _client("duty-operator-v")


def make_object(code="OBJ-VALIDATE-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=9):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def make_shift(plan, starts_at, ends_at, employee_id=None, **kwargs):
    return DutyShift.objects.create(
        plan=plan,
        employee_id=employee_id or uuid.uuid4(),
        starts_at=starts_at,
        ends_at=ends_at,
        **kwargs,
    )


def validate_url(plan_id):
    return f"/api/operations/duty-plans/{plan_id}/validate/"


def test_validate_requires_permission(seeded):
    obj = make_object("OBJ-VALIDATE-2")
    plan = make_plan(obj)
    client = _client("plain-operator")
    resp = client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 403


def test_validate_clean_plan_returns_empty_list(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-3")
    plan = make_plan(obj)
    make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    make_shift(plan, "2026-09-02T08:00:00+05:00", "2026-09-02T20:00:00+05:00")
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data == []


def test_validate_self_overlap_same_employee_reported_soft(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-4")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    shift_a = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    shift_b = make_shift(
        plan,
        "2026-09-01T14:00:00+05:00",
        "2026-09-02T02:00:00+05:00",
        employee_id=employee,
    )
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    assert len(resp.data) == 2
    for entry in resp.data:
        assert entry["severity"] == "SOFT"
        assert entry["employee_id"] == str(employee)
    reported_shift_ids = {entry["shift_id"] for entry in resp.data}
    assert reported_shift_ids == {shift_a.pk, shift_b.pk}


def test_validate_hard_overlap_with_existing_status(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-5")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    EmployeeStatus.objects.create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start="2026-08-25",
        date_end="2026-09-15",
    )
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    assert len(resp.data) == 1
    assert resp.data[0]["shift_id"] == shift.pk
    assert resp.data[0]["severity"] == "HARD"
    assert resp.data[0]["conflict_code"] == "OVERLAP_SICK_LEAVE"


def test_validate_cancelled_employee_status_excluded(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-5B")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    EmployeeStatus.objects.create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start="2026-08-25",
        date_end="2026-09-15",
        cancelled_at="2026-08-20T00:00:00+05:00",
        cancelled_by="tester",
        cancelled_reason="test",
    )
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data == []


def test_validate_sibling_shift_projection_not_double_reported(duty_manager_client):
    """Review (Blind Hunter): re-validating an APPROVED plan must not report
    the same shift-vs-shift conflict twice — once directly, once via a
    sibling shift's own EmployeeStatus projection."""
    obj = make_object("OBJ-VALIDATE-5C")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    shift_a = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    shift_b = make_shift(
        plan,
        "2026-09-01T14:00:00+05:00",
        "2026-09-02T02:00:00+05:00",
        employee_id=employee,
    )
    # Simulate an already-approved plan: both shifts have their own DUTY
    # EmployeeStatus projection.
    EmployeeStatus.objects.create(
        employee_id=employee,
        status_type_code="DUTY",
        date_start="2026-09-01",
        date_end="2026-09-02",
        source=EmployeeStatus.Source.OM_AUTO,
        source_ref=f"DUTY:{shift_a.pk}",
    )
    EmployeeStatus.objects.create(
        employee_id=employee,
        status_type_code="DUTY",
        date_start="2026-09-01",
        date_end="2026-09-02",
        source=EmployeeStatus.Source.OM_AUTO,
        source_ref=f"DUTY:{shift_b.pk}",
    )
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    # Exactly one entry per direction of the direct shift-vs-shift overlap —
    # NOT duplicated via each shift's sibling's own projection.
    assert len(resp.data) == 2
    reported_shift_ids = {entry["shift_id"] for entry in resp.data}
    assert reported_shift_ids == {shift_a.pk, shift_b.pk}


def test_validate_cancelled_shift_excluded(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-6")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    shift_a = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    make_shift(
        plan,
        "2026-09-01T14:00:00+05:00",
        "2026-09-02T02:00:00+05:00",
        employee_id=employee,
        cancelled_at="2026-08-01T00:00:00+05:00",
        cancelled_by="tester",
        cancelled_reason="test",
    )
    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data == []
    assert shift_a.pk  # sanity: the non-cancelled shift itself is not flagged


def test_validate_nonexistent_plan_returns_404(duty_manager_client):
    resp = duty_manager_client.post(validate_url(999999), format="json")
    assert resp.status_code == 404


def test_validate_is_read_only(duty_manager_client):
    obj = make_object("OBJ-VALIDATE-7")
    plan = make_plan(obj)
    employee = uuid.uuid4()
    make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        employee_id=employee,
    )
    make_shift(
        plan,
        "2026-09-01T14:00:00+05:00",
        "2026-09-02T02:00:00+05:00",
        employee_id=employee,
    )
    plan_status_before = plan.status_code
    shifts_before = list(
        DutyShift.objects.filter(plan=plan).order_by("pk").values()
    )
    statuses_before = list(EmployeeStatus.objects.all().order_by("pk").values())

    resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    assert resp.status_code == 200
    assert len(resp.data) == 2  # sanity: conflicts were actually found

    plan.refresh_from_db()
    assert plan.status_code == plan_status_before
    shifts_after = list(DutyShift.objects.filter(plan=plan).order_by("pk").values())
    statuses_after = list(EmployeeStatus.objects.all().order_by("pk").values())
    assert shifts_after == shifts_before
    assert statuses_after == statuses_before
