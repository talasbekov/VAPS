"""Story 15.10 — `escalate_stale_force_requests()` behavioral tests
(FR-42)."""

import datetime

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.audit.models import AuditLog
from apps.core.clock import Clock
from apps.notifications.models import Notification
from apps.operations.events.models import Group, GroupForceRequest, SecurityEvent
from apps.operations.events.services import escalate_stale_force_requests
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


def make_request(status, days_old, code="OBJ-ESCALATE-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    group = Group.objects.create(code=f"{code}-GROUP", name="Кинология")
    request = GroupForceRequest.objects.create(
        event=event, group=group, requested_count=5, status=status
    )
    stale_time = Clock.now() - datetime.timedelta(days=days_old)
    GroupForceRequest.objects.filter(pk=request.pk).update(updated_at=stale_time)
    request.refresh_from_db()
    return request


@pytest.fixture
def broker(db):
    call_command("seed_operations")
    role = Role.objects.create(code="TEST_BROKER_ESCALATE", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="brokerage.manage")
    UserRole.objects.create(user_id="broker-recipient", role_code=role)


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_escalates_stale_sent_request(broker):
    request = make_request("SENT", days_old=3)
    escalated = escalate_stale_force_requests()
    assert len(escalated) == 1
    request.refresh_from_db()
    assert request.escalated_at is not None


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_escalates_stale_partially_allocated_request(broker):
    request = make_request("PARTIALLY_ALLOCATED", days_old=3)
    escalated = escalate_stale_force_requests()
    assert len(escalated) == 1
    request.refresh_from_db()
    assert request.escalated_at is not None


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_does_not_escalate_allocated_request(broker):
    request = make_request("ALLOCATED", days_old=10)
    escalate_stale_force_requests()
    request.refresh_from_db()
    assert request.escalated_at is None


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_does_not_escalate_not_sent_request(broker):
    request = make_request("NOT_SENT", days_old=10)
    escalate_stale_force_requests()
    request.refresh_from_db()
    assert request.escalated_at is None


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_does_not_escalate_fresh_request(broker):
    request = make_request("SENT", days_old=1)
    escalate_stale_force_requests()
    request.refresh_from_db()
    assert request.escalated_at is None


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_repeat_run_does_not_reescalate(broker):
    request = make_request("SENT", days_old=3)
    escalate_stale_force_requests()
    first_escalated_at = GroupForceRequest.objects.get(pk=request.pk).escalated_at
    second_run = escalate_stale_force_requests()
    assert second_run == []
    request.refresh_from_db()
    assert request.escalated_at == first_escalated_at


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_notifies_brokerage_manage_holder(broker):
    make_request("SENT", days_old=3)
    escalate_stale_force_requests()
    assert Notification.objects.filter(
        recipient="broker-recipient", kind="GROUP_FORCE_REQUEST_ESCALATED"
    ).exists()


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_emits_audited_row(broker):
    request = make_request("SENT", days_old=3)
    escalate_stale_force_requests()
    log = AuditLog.objects.get(action="GROUP_FORCE_REQUEST_ESCALATED")
    assert log.actor_user_id == "SYSTEM"
    assert log.new_value["escalated_request_ids"] == [request.pk]


@override_settings(VAPS_FORCE_REQUEST_ESCALATION_DAYS=2)
def test_no_stale_requests_is_a_clean_noop(broker):
    escalated = escalate_stale_force_requests()
    assert escalated == []
    assert not AuditLog.objects.filter(action="GROUP_FORCE_REQUEST_ESCALATED").exists()
