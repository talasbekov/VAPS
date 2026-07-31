"""Story 14.12a — HTTP-smoke pins for duty-plan/shift audit emission.

Same pattern as apps/operations/submissions/tests/test_submission_audit.py
(5.9): a real HTTP call through the route, asserting the AuditLog row
exists with the correct action/actor — the behavioral test _Audited()'s own
docstring requires alongside the service-level record() call.
"""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole
from apps.operations.statuses.models import StatusType

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
    role = Role.objects.create(code="TEST_DUTY_MANAGER_AUDIT", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator-audit", role_code=role)
    return _client("duty-operator-audit")


def make_object(code="OBJ-AUDIT-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=9):
    return DutyPlan.objects.create(object=obj, year=year, month=month)


def make_shift(plan, **kwargs):
    kwargs.setdefault("employee_id", uuid.uuid4())
    kwargs.setdefault("starts_at", "2026-09-01T08:00:00+05:00")
    kwargs.setdefault("ends_at", "2026-09-01T20:00:00+05:00")
    return DutyShift.objects.create(plan=plan, **kwargs)


def test_http_smoke_create_plan_emits_audited_row(duty_manager_client):
    obj = make_object("OBJ-AUDIT-2")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-list"),
        {"object": obj.pk, "year": 2026, "month": 9},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    log = AuditLog.objects.get(action="DUTY_PLAN_CREATED")
    assert log.actor_user_id == "duty-operator-audit"
    assert log.entity_id == uuid.UUID(int=resp.data["id"])
    assert log.new_value["plan_id"] == resp.data["id"]


def test_http_smoke_create_shift_emits_audited_row(duty_manager_client):
    obj = make_object("OBJ-AUDIT-3")
    plan = make_plan(obj)
    employee_id = str(uuid.uuid4())
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-shifts", args=[plan.pk]),
        {
            "employee_id": employee_id,
            "starts_at": "2026-09-01T08:00:00+05:00",
            "ends_at": "2026-09-01T20:00:00+05:00",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    log = AuditLog.objects.get(action="DUTY_SHIFT_CREATED")
    assert log.actor_user_id == "duty-operator-audit"
    assert log.entity_id == uuid.UUID(int=resp.data["id"])
    assert log.new_value["employee_id"] == employee_id


def test_http_smoke_approve_emits_audited_row(duty_manager_client, status_types):
    obj = make_object("OBJ-AUDIT-4")
    plan = make_plan(obj)
    resp = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))
    assert resp.status_code == 200, resp.data
    log = AuditLog.objects.get(action="DUTY_PLAN_APPROVED")
    assert log.actor_user_id == "duty-operator-audit"
    assert log.entity_id == uuid.UUID(int=plan.pk)


def test_http_smoke_approve_idempotent_replay_does_not_duplicate_row(
    duty_manager_client, status_types
):
    obj = make_object("OBJ-AUDIT-5")
    plan = make_plan(obj)
    first = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))
    second = duty_manager_client.post(reverse("ops-duty-plan-approve", args=[plan.pk]))
    assert first.status_code == 200
    assert second.status_code == 200
    assert AuditLog.objects.filter(action="DUTY_PLAN_APPROVED").count() == 1


def test_http_smoke_cancel_shift_emits_audited_row(duty_manager_client):
    obj = make_object("OBJ-AUDIT-6")
    plan = make_plan(obj)
    shift = make_shift(plan)
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-cancel-shift", args=[plan.pk, shift.pk]),
        {"reason": "Болезнь"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    log = AuditLog.objects.get(action="DUTY_SHIFT_CANCELLED")
    assert log.actor_user_id == "duty-operator-audit"
    assert log.entity_id == uuid.UUID(int=shift.pk)
    assert log.reason == "Болезнь"


def test_http_smoke_replan_shift_emits_both_cancelled_and_replanned_rows(
    duty_manager_client,
):
    obj = make_object("OBJ-AUDIT-7")
    plan = make_plan(obj)
    shift = make_shift(plan)
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-replan-shift", args=[plan.pk, shift.pk]),
        {"reason": "Перенос", "starts_at": "2026-09-02T08:00:00+05:00",
         "ends_at": "2026-09-02T20:00:00+05:00"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    cancel_log = AuditLog.objects.get(
        action="DUTY_SHIFT_CANCELLED", entity_id=uuid.UUID(int=shift.pk)
    )
    assert cancel_log.reason == "Перенос"
    replan_log = AuditLog.objects.get(action="DUTY_SHIFT_REPLANNED")
    assert replan_log.entity_id == uuid.UUID(int=resp.data["id"])
    assert replan_log.old_value["old_shift_id"] == shift.pk
    assert replan_log.new_value["new_shift_id"] == resp.data["id"]


def test_http_smoke_validate_does_not_emit_any_audit_row(duty_manager_client):
    # Story 14.11f/14.12a: validate is a read-only dry-run — nothing to audit.
    obj = make_object("OBJ-AUDIT-8")
    plan = make_plan(obj)
    resp = duty_manager_client.post(reverse("ops-duty-plan-validate", args=[plan.pk]))
    assert resp.status_code == 200
    assert not AuditLog.objects.filter(
        entity_type="duty_plan", entity_id=uuid.UUID(int=plan.pk)
    ).exists()
