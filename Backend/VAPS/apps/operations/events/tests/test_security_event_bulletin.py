"""Story 15.2b — `POST /api/operations/security-events/{id}/bulletin`
behavioral tests (transition + idempotency + conflict + audit + permission).
"""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import SecurityEvent
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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_BULLETIN", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-bulletin", role_code=role)
    return _client("event-operator-bulletin")


def make_object(code="OBJ-EVT-BULLETIN-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_event(obj=None, status_code=SecurityEvent.StatusCode.DRAFT):
    obj = obj or make_object()
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", status_code=status_code
    )


def test_bulletin_from_draft_succeeds(event_manager_client):
    event = make_event()
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=[event.pk])
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "BULLETIN"
    event.refresh_from_db()
    assert event.status_code == "BULLETIN"


def test_bulletin_replay_on_already_bulletin_is_idempotent(event_manager_client):
    event = make_event(status_code=SecurityEvent.StatusCode.BULLETIN)
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=[event.pk])
    )
    assert resp.status_code == 200
    assert resp.data["status_code"] == "BULLETIN"
    assert not AuditLog.objects.filter(action="SECURITY_EVENT_BULLETIN_ISSUED").exists()


def test_bulletin_from_other_status_is_422_conflict(event_manager_client):
    event = make_event(status_code=SecurityEvent.StatusCode.RECON)
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=[event.pk])
    )
    assert resp.status_code == 422
    event.refresh_from_db()
    assert event.status_code == "RECON"


def test_bulletin_with_non_numeric_id_is_404_not_500(event_manager_client):
    # Review (Edge Case Hunter): the router's default lookup regex accepts
    # non-numeric pk; get_object_or_404() alone only catches DoesNotExist,
    # not the ValueError from casting a malformed string to an int field
    # lookup — must be a clean 404, not a bare 500.
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=["not-a-number"])
    )
    assert resp.status_code == 404


def test_bulletin_without_permission_is_403(seeded):
    event = make_event()
    resp = _client("nobody").post(
        reverse("ops-security-event-bulletin", args=[event.pk])
    )
    assert resp.status_code == 403


def test_bulletin_emits_audited_row_only_on_real_transition(event_manager_client):
    event = make_event()
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=[event.pk])
    )
    assert resp.status_code == 200
    log = AuditLog.objects.get(action="SECURITY_EVENT_BULLETIN_ISSUED")
    assert log.actor_user_id == "event-operator-bulletin"
    assert log.new_value["event_id"] == event.pk
    assert log.new_value["status_code"] == "BULLETIN"
