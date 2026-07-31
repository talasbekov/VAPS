"""Story 15.5c — `POST .../staffing-demand/approve` behavioral tests."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import SecurityEvent, SecurityEventStaffingDemand
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
def event_manager_client(seeded):
    role = Role.objects.create(code="TEST_EVENT_MANAGER_DEMAND_APPROVE", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="demand-approver", role_code=role)
    return _client("demand-approver")


def make_event(code="OBJ-DEMAND-APPROVE-1", status_code=SecurityEvent.StatusCode.RECON):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def approve_url(event):
    return reverse("ops-security-event-staffing-demand-approve", args=[event.pk])


def test_approve_from_recon_succeeds(event_manager_client):
    event = make_event()
    resp = event_manager_client.post(approve_url(event))
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "DEMAND"
    event.refresh_from_db()
    assert event.status_code == "DEMAND"


def test_approve_replay_on_already_demand_is_idempotent(event_manager_client):
    event = make_event(status_code=SecurityEvent.StatusCode.DEMAND)
    resp = event_manager_client.post(approve_url(event))
    assert resp.status_code == 200
    assert resp.data["status_code"] == "DEMAND"
    assert not AuditLog.objects.filter(action="SECURITY_EVENT_DEMAND_APPROVED").exists()


def test_approve_from_other_status_is_422(event_manager_client):
    event = make_event(status_code=SecurityEvent.StatusCode.BULLETIN)
    resp = event_manager_client.post(approve_url(event))
    assert resp.status_code == 422
    event.refresh_from_db()
    assert event.status_code == "BULLETIN"


def test_approve_without_permission_is_403(seeded):
    event = make_event()
    resp = _client("nobody").post(approve_url(event))
    assert resp.status_code == 403


def test_approve_emits_audited_row_with_demand_snapshot(event_manager_client):
    event = make_event()
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", group="Кинология", need=2
    )
    resp = event_manager_client.post(approve_url(event))
    assert resp.status_code == 200
    log = AuditLog.objects.get(action="SECURITY_EVENT_DEMAND_APPROVED")
    assert log.actor_user_id == "demand-approver"
    assert log.new_value["status_code"] == "DEMAND"
    assert log.new_value["staffing_demand"] == [
        {"sector": "A", "task": "", "shift": "", "need": 2, "group": "Кинология"}
    ]
