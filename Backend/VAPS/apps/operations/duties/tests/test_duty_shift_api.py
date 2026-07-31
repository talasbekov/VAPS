"""Story 14.11b — POST/GET /api/operations/duty-plans/{id}/shifts."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import DutyType, Object as FacilityObject, Post
from apps.operations.rbac.models import Role, RolePermission, UserRole

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
    role = Role.objects.create(code="TEST_DUTY_MANAGER_B", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-b", role_code=role)
    return _client("duty-operator-b")


def make_object(code="OBJ-SHIFT-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def test_create_shift_requires_permission(seeded):
    obj = make_object("OBJ-SHIFT-2")
    plan = make_plan(obj)
    client = _client("plain-operator")
    resp = client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": str(uuid.uuid4()),
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 403


def test_create_shift_happy_path(duty_manager_client):
    obj = make_object("OBJ-SHIFT-3")
    plan = make_plan(obj)
    emp_id = str(uuid.uuid4())
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": emp_id,
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["employee_id"] == emp_id
    assert DutyShift.objects.filter(plan=plan, employee_id=emp_id).exists()


def test_create_shift_nonexistent_plan_returns_404(duty_manager_client):
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[999999]),
        {
            "employee_id": str(uuid.uuid4()),
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 404


def test_create_shift_invalid_interval_rejected(duty_manager_client):
    obj = make_object("OBJ-SHIFT-4")
    plan = make_plan(obj)
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": str(uuid.uuid4()),
            "starts_at": "2026-08-01T20:00:00+05:00",
            "ends_at": "2026-08-01T08:00:00+05:00",
        },
        format="json",
    )
    # Review (Blind Hunter): assert the error body's field key, not just the
    # status code — proves full_clean()'s NON_FIELD_ERRORS ("__all__") is
    # preserved, not collapsed into an unkeyed/generic message.
    assert resp.status_code == 400, resp.data
    assert "__all__" in resp.data["details"]


def test_create_shift_incompatible_post_rejected(duty_manager_client):
    obj_a = make_object("OBJ-SHIFT-5A")
    obj_b = make_object("OBJ-SHIFT-5B")
    plan = make_plan(obj_a)
    post_b = Post.objects.create(object=obj_b, code="P-1", name="КПП-1")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": str(uuid.uuid4()),
            "post": post_b.pk,
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "post" in resp.data["details"]


def test_create_shift_incompatible_duty_type_rejected(duty_manager_client):
    # Review (Blind Hunter): the cross-FK guard covers BOTH post and
    # duty_type — only "post" was exercised negatively; duty_type alone was
    # untested.
    obj_a = make_object("OBJ-SHIFT-5C")
    obj_b = make_object("OBJ-SHIFT-5D")
    plan = make_plan(obj_a)
    duty_type_b = DutyType.objects.create(object=obj_b, code="DAY", name="Дневное")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": str(uuid.uuid4()),
            "duty_type": duty_type_b.pk,
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "duty_type" in resp.data["details"]


def test_list_shifts_requires_permission(seeded):
    obj = make_object("OBJ-SHIFT-6")
    plan = make_plan(obj)
    client = _client("plain-operator")
    resp = client.get(reverse("ops-duty-plan-shifts", args=[plan.pk]))
    assert resp.status_code == 403


def test_list_shifts_happy_path(duty_manager_client):
    obj = make_object("OBJ-SHIFT-7")
    plan = make_plan(obj)
    DutyShift.objects.create(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at="2026-08-01T08:00:00+05:00",
        ends_at="2026-08-01T20:00:00+05:00",
    )
    resp = duty_manager_client.get(reverse("ops-duty-plan-shifts", args=[plan.pk]))
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["cancelled_at"] is None


def test_list_shifts_shows_cancelled_history(duty_manager_client):
    obj = make_object("OBJ-SHIFT-8")
    plan = make_plan(obj)
    shift = DutyShift.objects.create(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at="2026-08-01T08:00:00+05:00",
        ends_at="2026-08-01T20:00:00+05:00",
    )
    shift.cancelled_at = "2026-07-31T00:00:00+05:00"
    shift.cancelled_by = "operator"
    shift.cancelled_reason = "Отмена"
    shift.save()

    resp = duty_manager_client.get(reverse("ops-duty-plan-shifts", args=[plan.pk]))
    assert resp.status_code == 200
    assert resp.data["results"][0]["cancelled_by"] == "operator"


def test_create_shift_with_valid_post_and_duty_type(duty_manager_client):
    obj = make_object("OBJ-SHIFT-9")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": str(uuid.uuid4()),
            "post": post.pk,
            "duty_type": duty_type.pk,
            "starts_at": "2026-08-01T08:00:00+05:00",
            "ends_at": "2026-08-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["post"] == post.pk
    assert resp.data["duty_type"] == duty_type.pk
