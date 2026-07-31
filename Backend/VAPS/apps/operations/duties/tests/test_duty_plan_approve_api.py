"""Story 14.11c — POST /api/operations/duty-plans/{id}/approve."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def status_types(db):
    StatusType.objects.create(
        code="DUTY",
        name="На дежурстве",
        is_hard_block=False,
        priority=70,
        report_column_code="ON_DUTY",
    )
    StatusType.objects.create(
        code="REST_AFTER_DUTY",
        name="После дежурства",
        is_hard_block=False,
        priority=60,
        report_column_code="AFTER_DUTY",
    )


@pytest.fixture
def duty_manager_client(seeded):
    role = Role.objects.create(code="TEST_DUTY_MANAGER_C", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-c", role_code=role)
    return _client("duty-operator-c")


def make_object(code="OBJ-APPROVE-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def test_approve_requires_permission(seeded):
    obj = make_object("OBJ-APPROVE-2")
    plan = make_plan(obj)
    client = _client("plain-operator")
    resp = client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))
    assert resp.status_code == 403


def test_approve_happy_path_projects_statuses(duty_manager_client, status_types):
    obj = make_object("OBJ-APPROVE-3")
    plan = make_plan(obj)
    shift = DutyShift.objects.create(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at="2026-08-01T08:00:00+05:00",
        ends_at="2026-08-01T20:00:00+05:00",
    )

    resp = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))

    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "APPROVED"
    plan.refresh_from_db()
    assert plan.status_code == "APPROVED"
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()
    assert EmployeeStatus.objects.filter(
        source_ref=f"REST_AFTER_DUTY:{shift.pk}"
    ).exists()


def test_approve_nonexistent_plan_returns_404(duty_manager_client):
    resp = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[999999]))
    assert resp.status_code == 404


def test_approve_is_idempotent(duty_manager_client, status_types):
    obj = make_object("OBJ-APPROVE-4")
    plan = make_plan(obj)
    shift = DutyShift.objects.create(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at="2026-08-01T08:00:00+05:00",
        ends_at="2026-08-01T20:00:00+05:00",
    )

    first = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))
    second = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.data["status_code"] == "APPROVED"
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").count() == 1
    assert (
        EmployeeStatus.objects.filter(source_ref=f"REST_AFTER_DUTY:{shift.pk}").count()
        == 1
    )


def test_approve_plan_without_shifts_succeeds(duty_manager_client):
    obj = make_object("OBJ-APPROVE-5")
    plan = make_plan(obj)

    resp = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))

    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "APPROVED"
