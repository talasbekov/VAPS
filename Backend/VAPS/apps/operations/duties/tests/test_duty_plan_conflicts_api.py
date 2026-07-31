"""Story 14.11g — GET /api/operations/duty-plans/{id}/conflicts."""

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
    role = Role.objects.create(code="TEST_DUTY_MANAGER_C", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-c", role_code=role)
    return _client("duty-operator-c")


def make_object(code="OBJ-CONFLICTS-1"):
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


def conflicts_url(plan_id):
    return f"/api/operations/duty-plans/{plan_id}/conflicts/"


def validate_url(plan_id):
    return f"/api/operations/duty-plans/{plan_id}/validate/"


def test_conflicts_requires_permission(seeded):
    obj = make_object("OBJ-CONFLICTS-2")
    plan = make_plan(obj)
    client = _client("plain-operator")
    resp = client.get(conflicts_url(plan.pk))
    assert resp.status_code == 403


def test_conflicts_clean_plan_returns_empty_list(duty_manager_client):
    obj = make_object("OBJ-CONFLICTS-3")
    plan = make_plan(obj)
    make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    resp = duty_manager_client.get(conflicts_url(plan.pk))
    assert resp.status_code == 200, resp.data
    assert resp.data == []


def test_conflicts_matches_validate_result(duty_manager_client):
    obj = make_object("OBJ-CONFLICTS-4")
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
    EmployeeStatus.objects.create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start="2026-08-25",
        date_end="2026-09-15",
    )

    validate_resp = duty_manager_client.post(validate_url(plan.pk), format="json")
    conflicts_resp = duty_manager_client.get(conflicts_url(plan.pk))

    assert validate_resp.status_code == 200
    assert conflicts_resp.status_code == 200
    sort_key = lambda e: (e["shift_id"], e["conflict_code"])  # noqa: E731
    assert sorted(conflicts_resp.data, key=sort_key) == sorted(
        validate_resp.data, key=sort_key
    )
    assert len(conflicts_resp.data) > 0  # sanity: conflicts were actually found


def test_conflicts_nonexistent_plan_returns_404(duty_manager_client):
    resp = duty_manager_client.get(conflicts_url(999999))
    assert resp.status_code == 404
