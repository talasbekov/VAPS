"""Story 14.11e — POST /api/operations/duty-plans/{plan_id}/shifts/{shift_id}/replan."""

import uuid

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import Object as FacilityObject, Post
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
    role = Role.objects.create(code="TEST_DUTY_MANAGER_E", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-e", role_code=role)
    return _client("duty-operator-e")


def make_object(code="OBJ-REPLAN-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=9):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def make_shift(plan, starts_at, ends_at, **kwargs):
    kwargs.setdefault("employee_id", uuid.uuid4())
    return DutyShift.objects.create(
        plan=plan, starts_at=starts_at, ends_at=ends_at, **kwargs
    )


def replan_url(plan_id, shift_id):
    return f"/api/operations/duty-plans/{plan_id}/shifts/{shift_id}/replan/"


def test_replan_requires_permission(seeded):
    obj = make_object("OBJ-REPLAN-2")
    plan = make_plan(obj)
    shift = make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    client = _client("plain-operator")
    resp = client.post(
        replan_url(plan.pk, shift.pk),
        {
            "reason": "Перенос",
            "starts_at": "2026-09-02T08:00:00+05:00",
            "ends_at": "2026-09-02T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 403


def test_replan_happy_path_partial_update(duty_manager_client, status_types):
    obj = make_object("OBJ-REPLAN-3")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    old_shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        post=post,
        duty_role_code="SENIOR",
    )
    resp = duty_manager_client.post(
        replan_url(plan.pk, old_shift.pk),
        {
            "reason": "Перенос на другой день",
            "starts_at": "2026-09-02T08:00:00+05:00",
            "ends_at": "2026-09-02T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["starts_at"].startswith("2026-09-02")
    # Unspecified fields inherited from the old shift.
    assert resp.data["post"] == post.pk
    assert resp.data["duty_role_code"] == "SENIOR"

    old_shift.refresh_from_db()
    assert old_shift.cancelled_at is not None
    assert not EmployeeStatus.objects.filter(source_ref=f"DUTY:{old_shift.pk}").exists()
    new_shift_id = resp.data["id"]
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{new_shift_id}").exists()


def test_replan_explicit_null_clears_post_but_absent_field_inherits(
    duty_manager_client,
):
    obj = make_object("OBJ-REPLAN-4")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    old_shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        post=post,
        duty_role_code="SENIOR",
    )
    resp = duty_manager_client.post(
        replan_url(plan.pk, old_shift.pk),
        {
            "reason": "Снятие поста",
            "post": None,
            "starts_at": "2026-09-02T08:00:00+05:00",
            "ends_at": "2026-09-02T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["post"] is None
    # duty_role_code was absent from the body -> inherited, not cleared.
    assert resp.data["duty_role_code"] == "SENIOR"


def test_replan_reason_only_clones_shift_fields(duty_manager_client, status_types):
    obj = make_object("OBJ-REPLAN-4B")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    old_shift = make_shift(
        plan,
        "2026-09-01T08:00:00+05:00",
        "2026-09-01T20:00:00+05:00",
        post=post,
        duty_role_code="SENIOR",
    )
    resp = duty_manager_client.post(
        replan_url(plan.pk, old_shift.pk),
        {"reason": "Без изменений полей"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["post"] == post.pk
    assert resp.data["duty_role_code"] == "SENIOR"
    assert resp.data["starts_at"].startswith("2026-09-01")

    old_shift.refresh_from_db()
    assert old_shift.cancelled_at is not None
    new_shift_id = resp.data["id"]
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{new_shift_id}").exists()


def test_replan_employee_id_null_rejected(duty_manager_client):
    obj = make_object("OBJ-REPLAN-4C")
    plan = make_plan(obj)
    shift = make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    resp = duty_manager_client.post(
        replan_url(plan.pk, shift.pk),
        {"reason": "x", "employee_id": None},
        format="json",
    )
    assert resp.status_code == 400, resp.data


def test_replan_nonexistent_plan_returns_404(duty_manager_client):
    obj = make_object("OBJ-REPLAN-5")
    plan = make_plan(obj)
    shift = make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    resp = duty_manager_client.post(
        replan_url(999999, shift.pk), {"reason": "x"}, format="json"
    )
    assert resp.status_code == 404


def test_replan_nonexistent_shift_returns_404(duty_manager_client):
    obj = make_object("OBJ-REPLAN-6")
    plan = make_plan(obj)
    resp = duty_manager_client.post(
        replan_url(plan.pk, 999999), {"reason": "x"}, format="json"
    )
    assert resp.status_code == 404


def test_replan_shift_from_different_plan_returns_404(duty_manager_client):
    obj = make_object("OBJ-REPLAN-7")
    plan_a = make_plan(obj, month=9)
    plan_b = make_plan(obj, month=10)
    shift_b = make_shift(
        plan_b, "2026-10-01T08:00:00+05:00", "2026-10-01T20:00:00+05:00"
    )
    resp = duty_manager_client.post(
        replan_url(plan_a.pk, shift_b.pk), {"reason": "x"}, format="json"
    )
    assert resp.status_code == 404
    shift_b.refresh_from_db()
    assert shift_b.cancelled_at is None


def test_replan_malformed_shift_id_returns_404(duty_manager_client):
    obj = make_object("OBJ-REPLAN-8")
    plan = make_plan(obj)
    resp = duty_manager_client.post(
        replan_url(plan.pk, "not-a-number"), {"reason": "x"}, format="json"
    )
    assert resp.status_code == 404


def test_replan_empty_reason_rejected(duty_manager_client):
    obj = make_object("OBJ-REPLAN-9")
    plan = make_plan(obj)
    shift = make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    resp = duty_manager_client.post(
        replan_url(plan.pk, shift.pk), {"reason": ""}, format="json"
    )
    assert resp.status_code == 400, resp.data


def test_replan_already_cancelled_shift_rejected(duty_manager_client):
    obj = make_object("OBJ-REPLAN-10")
    plan = make_plan(obj)
    shift = make_shift(plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00")
    first = duty_manager_client.post(
        f"/api/operations/duty-plans/{plan.pk}/shifts/{shift.pk}/cancel/",
        {"reason": "Отмена"},
        format="json",
    )
    assert first.status_code == 200

    resp = duty_manager_client.post(
        replan_url(plan.pk, shift.pk), {"reason": "Перенос"}, format="json"
    )
    assert resp.status_code == 422, resp.data


def test_replan_already_started_shift_rejected(duty_manager_client):
    obj = make_object("OBJ-REPLAN-11")
    plan = make_plan(obj, year=2026, month=1)
    shift = make_shift(plan, "2026-01-01T08:00:00+05:00", "2026-01-01T20:00:00+05:00")
    resp = duty_manager_client.post(
        replan_url(plan.pk, shift.pk), {"reason": "Перенос"}, format="json"
    )
    assert resp.status_code == 422, resp.data


def test_replan_incompatible_post_rejected_and_old_shift_not_cancelled(
    duty_manager_client,
):
    obj_a = make_object("OBJ-REPLAN-12A")
    obj_b = make_object("OBJ-REPLAN-12B")
    plan = make_plan(obj_a)
    post_b = Post.objects.create(object=obj_b, code="P-1", name="КПП-1")
    old_shift = make_shift(
        plan, "2026-09-01T08:00:00+05:00", "2026-09-01T20:00:00+05:00"
    )
    resp = duty_manager_client.post(
        replan_url(plan.pk, old_shift.pk),
        {
            "reason": "Смена поста",
            "post": post_b.pk,
            "starts_at": "2026-09-02T08:00:00+05:00",
            "ends_at": "2026-09-02T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 400, resp.data
    old_shift.refresh_from_db()
    assert old_shift.cancelled_at is None
