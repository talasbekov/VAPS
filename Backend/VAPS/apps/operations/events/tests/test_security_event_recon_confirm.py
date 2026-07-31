"""Story 15.3c — `POST .../recon/confirm` behavioral tests (dual control:
first confirmation pending, second-different-actor completes, same-actor
rejected, status conflict, idempotency, audit)."""

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
def event_manager_role(seeded):
    role = Role.objects.create(code="TEST_EVENT_MANAGER_RECON_CONFIRM", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    return role


def make_client(role, actor):
    UserRole.objects.create(user_id=actor, role_code=role)
    return _client(actor)


def make_event(
    code="OBJ-RECON-CONFIRM-1", status_code=SecurityEvent.StatusCode.BULLETIN
):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def confirm_url(event):
    return reverse("ops-security-event-recon-confirm", args=[event.pk])


def test_first_confirmation_is_202_pending_no_status_change(event_manager_role):
    event = make_event("OBJ-RECON-CONFIRM-2")
    client = make_client(event_manager_role, "recon-actor-a")
    resp = client.post(confirm_url(event))
    assert resp.status_code == 202, resp.data
    assert resp.data["status_code"] == "BULLETIN"
    event.refresh_from_db()
    assert event.recon_first_confirmed_by == "recon-actor-a"
    assert event.recon_first_confirmed_at is not None


def test_second_different_actor_completes_transition(event_manager_role):
    event = make_event("OBJ-RECON-CONFIRM-3")
    first = make_client(event_manager_role, "recon-actor-b1")
    second = make_client(event_manager_role, "recon-actor-b2")
    first.post(confirm_url(event))
    resp = second.post(confirm_url(event))
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "RECON"
    event.refresh_from_db()
    assert event.status_code == "RECON"
    assert event.recon_first_confirmed_by == ""
    assert event.recon_first_confirmed_at is None


def test_same_actor_twice_is_422(event_manager_role):
    event = make_event("OBJ-RECON-CONFIRM-4")
    client = make_client(event_manager_role, "recon-actor-c")
    client.post(confirm_url(event))
    resp = client.post(confirm_url(event))
    assert resp.status_code == 422
    event.refresh_from_db()
    assert event.status_code == "BULLETIN"


def test_confirm_from_non_bulletin_status_is_422(event_manager_role):
    event = make_event(
        "OBJ-RECON-CONFIRM-5", status_code=SecurityEvent.StatusCode.DRAFT
    )
    client = make_client(event_manager_role, "recon-actor-d")
    resp = client.post(confirm_url(event))
    assert resp.status_code == 422


def test_confirm_on_already_recon_is_idempotent_200(event_manager_role):
    event = make_event(
        "OBJ-RECON-CONFIRM-6", status_code=SecurityEvent.StatusCode.RECON
    )
    client = make_client(event_manager_role, "recon-actor-e")
    resp = client.post(confirm_url(event))
    assert resp.status_code == 200
    assert resp.data["status_code"] == "RECON"
    assert not AuditLog.objects.filter(action="SECURITY_EVENT_RECON_CONFIRMED").exists()


def test_confirm_without_permission_is_403(seeded):
    event = make_event("OBJ-RECON-CONFIRM-7")
    resp = _client("nobody").post(confirm_url(event))
    assert resp.status_code == 403


def test_second_confirmation_emits_audited_row(event_manager_role):
    event = make_event("OBJ-RECON-CONFIRM-8")
    first = make_client(event_manager_role, "recon-actor-f1")
    second = make_client(event_manager_role, "recon-actor-f2")
    first.post(confirm_url(event))
    second.post(confirm_url(event))
    log = AuditLog.objects.get(action="SECURITY_EVENT_RECON_CONFIRMED")
    assert log.actor_user_id == "recon-actor-f2"
    assert log.new_value["first_confirmed_by"] == "recon-actor-f1"
    assert log.new_value["second_confirmed_by"] == "recon-actor-f2"
