"""Story 14.11d — POST /api/operations/duty-plans/{plan_id}/shifts/{shift_id}/cancel."""

import uuid

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import Object as FacilityObject
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
    role = Role.objects.create(code="TEST_DUTY_MANAGER_D", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-d", role_code=role)
    return _client("duty-operator-d")


def make_object(code="OBJ-CANCEL-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=9):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def make_shift(plan, starts_at, ends_at):
    return DutyShift.objects.create(
        plan=plan, employee_id=uuid.uuid4(), starts_at=starts_at, ends_at=ends_at
    )


def cancel_url(plan_id, shift_id):
    return f"/api/operations/duty-plans/{plan_id}/shifts/{shift_id}/cancel/"


def test_cancel_requires_permission(seeded):
    obj = make_object("OBJ-CANCEL-2")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    client = _client("plain-operator")
    resp = client.post(
        cancel_url(plan.pk, shift.pk), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 403


def test_cancel_happy_path(duty_manager_client):
    obj = make_object("OBJ-CANCEL-3")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    resp = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk),
        {"reason": "Плановое сокращение"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["cancelled_by"] == "duty-operator-d"
    assert resp.data["cancelled_reason"] == "Плановое сокращение"
    shift.refresh_from_db()
    assert shift.cancelled_at is not None


def test_cancel_nonexistent_plan_returns_404(duty_manager_client):
    obj = make_object("OBJ-CANCEL-4")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    resp = duty_manager_client.post(
        cancel_url(999999, shift.pk), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 404


def test_cancel_nonexistent_shift_returns_404(duty_manager_client):
    obj = make_object("OBJ-CANCEL-5")
    plan = make_plan(obj)
    resp = duty_manager_client.post(
        cancel_url(plan.pk, 999999), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 404


def test_cancel_shift_from_different_plan_returns_404(duty_manager_client):
    obj = make_object("OBJ-CANCEL-6")
    plan_a = make_plan(obj, month=9)
    plan_b = make_plan(obj, month=10)
    shift_b = make_shift(
        plan_b,
        "2026-10-01T08:00:00+05:00",
        "2026-10-01T20:00:00+05:00",
    )
    # shift_b belongs to plan_b, but the URL names plan_a — cross-plan
    # substitution must 404, not silently cancel a shift in another plan.
    resp = duty_manager_client.post(
        cancel_url(plan_a.pk, shift_b.pk), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 404
    shift_b.refresh_from_db()
    assert shift_b.cancelled_at is None


def test_cancel_empty_reason_rejected(duty_manager_client):
    obj = make_object("OBJ-CANCEL-7")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    resp = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk), {"reason": ""}, format="json"
    )
    assert resp.status_code == 400, resp.data


def test_cancel_whitespace_only_reason_rejected(duty_manager_client):
    # Review (Edge Case Hunter): DRF's CharField trims whitespace by
    # default before the allow_blank check, so "   " is rejected the same
    # clean way as "" — pin this so a future serializer tweak (e.g.
    # trim_whitespace=False) doesn't silently let it slip through to the
    # service's own .strip() guard with a different error shape.
    obj = make_object("OBJ-CANCEL-10")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    resp = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk), {"reason": "   "}, format="json"
    )
    assert resp.status_code == 400, resp.data
    shift.refresh_from_db()
    assert shift.cancelled_at is None


def test_cancel_malformed_shift_id_returns_404(duty_manager_client):
    # Review (Blind Hunter): DutyShift's PK is an integer — a non-numeric
    # shift_id must be a clean 404, not an unhandled ValueError/500.
    obj = make_object("OBJ-CANCEL-11")
    plan = make_plan(obj)
    resp = duty_manager_client.post(
        cancel_url(plan.pk, "not-a-number"), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 404, resp.data


def test_cancel_already_cancelled_shift_rejected(duty_manager_client):
    obj = make_object("OBJ-CANCEL-8")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
    )
    first = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk), {"reason": "Отмена"}, format="json"
    )
    assert first.status_code == 200

    second = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk), {"reason": "Повторная отмена"}, format="json"
    )
    assert second.status_code == 422, second.data


def test_cancel_already_started_shift_rejected(duty_manager_client):
    obj = make_object("OBJ-CANCEL-9")
    plan = make_plan(obj, year=2026, month=1)
    shift = make_shift(
        plan,
        "2026-01-01T08:00:00+05:00",
        "2026-01-01T20:00:00+05:00",
    )
    resp = duty_manager_client.post(
        cancel_url(plan.pk, shift.pk), {"reason": "Отмена"}, format="json"
    )
    assert resp.status_code == 422, resp.data
