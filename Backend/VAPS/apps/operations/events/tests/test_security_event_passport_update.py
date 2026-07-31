"""Story 15.4 — `PUT .../security-events/{id}/passport` behavioral tests
(RECON-gate, partial update, get_or_create, permission, audit)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject, ObjectPassport
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
def object_manager_client(seeded):
    role = Role.objects.create(code="TEST_OBJECT_MANAGER_PASSPORT", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="object.manage")
    UserRole.objects.create(user_id="passport-operator", role_code=role)
    return _client("passport-operator")


def make_event(code="OBJ-PASSPORT-1", status_code=SecurityEvent.StatusCode.RECON):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def passport_url(event):
    return reverse("ops-security-event-passport", args=[event.pk])


def test_update_on_recon_creates_passport_and_stamps_verification(
    object_manager_client,
):
    event = make_event()
    resp = object_manager_client.put(
        passport_url(event), {"description": "Проверено"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["description"] == "Проверено"
    assert resp.data["last_verified_by"] == "passport-operator"
    assert resp.data["last_verified_at"] is not None
    passport = ObjectPassport.objects.get(object=event.object)
    assert passport.description == "Проверено"


def test_partial_update_does_not_clear_unset_fields(object_manager_client):
    event = make_event("OBJ-PASSPORT-2")
    ObjectPassport.objects.create(
        object=event.object, description="Старое", security_notes="Заметки"
    )
    resp = object_manager_client.put(
        passport_url(event), {"description": "Новое"}, format="json"
    )
    assert resp.status_code == 200
    passport = ObjectPassport.objects.get(object=event.object)
    assert passport.description == "Новое"
    assert passport.security_notes == "Заметки"


def test_update_from_non_recon_status_is_422(object_manager_client):
    event = make_event("OBJ-PASSPORT-3", status_code=SecurityEvent.StatusCode.BULLETIN)
    resp = object_manager_client.put(
        passport_url(event), {"description": "x"}, format="json"
    )
    assert resp.status_code == 422
    assert not ObjectPassport.objects.filter(object=event.object).exists()


def test_update_without_permission_is_403(seeded):
    event = make_event("OBJ-PASSPORT-4")
    resp = _client("nobody").put(
        passport_url(event), {"description": "x"}, format="json"
    )
    assert resp.status_code == 403


def test_update_emits_audited_row(object_manager_client):
    event = make_event("OBJ-PASSPORT-5")
    object_manager_client.put(passport_url(event), {"description": "x"}, format="json")
    log = AuditLog.objects.get(action="OBJECT_PASSPORT_UPDATED")
    assert log.actor_user_id == "passport-operator"
    assert log.new_value["security_event_id"] == event.pk
    assert log.new_value["fields"] == ["description"]
