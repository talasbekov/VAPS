"""Story 15.3b — `PUT .../checklist` + `PUT .../sector-posts` behavioral
tests (replace-all semantics, empty-array reset, permission, 404)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
)
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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_RECON", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-recon", role_code=role)
    return _client("event-operator-recon")


def make_event(code="OBJ-RECON-API-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def test_checklist_replace_creates_rows(event_manager_client):
    event = make_event()
    resp = event_manager_client.put(
        reverse("ops-security-event-checklist", args=[event.pk]),
        [{"label": "Периметр", "done": True, "result": "MATCHES"}],
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert len(resp.data) == 1
    assert resp.data[0]["label"] == "Периметр"
    assert SecurityEventChecklistItem.objects.filter(event=event).count() == 1


def test_checklist_replace_removes_old_rows(event_manager_client):
    event = make_event("OBJ-RECON-API-2")
    SecurityEventChecklistItem.objects.create(event=event, label="Старый пункт")
    resp = event_manager_client.put(
        reverse("ops-security-event-checklist", args=[event.pk]),
        [{"label": "Новый пункт", "done": False}],
        format="json",
    )
    assert resp.status_code == 200
    labels = list(
        SecurityEventChecklistItem.objects.filter(event=event).values_list(
            "label", flat=True
        )
    )
    assert labels == ["Новый пункт"]


def test_checklist_replace_with_empty_array_clears_all(event_manager_client):
    event = make_event("OBJ-RECON-API-3")
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт")
    resp = event_manager_client.put(
        reverse("ops-security-event-checklist", args=[event.pk]), [], format="json"
    )
    assert resp.status_code == 200
    assert resp.data == []
    assert not SecurityEventChecklistItem.objects.filter(event=event).exists()


def test_sector_posts_replace_creates_rows(event_manager_client):
    event = make_event("OBJ-RECON-API-4")
    resp = event_manager_client.put(
        reverse("ops-security-event-sector-posts", args=[event.pk]),
        [{"sector": "A", "post": "Пост 1", "need": 3}],
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert len(resp.data) == 1
    assert resp.data[0]["need"] == 3
    assert SecurityEventSectorPost.objects.filter(event=event).count() == 1


def test_checklist_without_permission_is_403(seeded):
    event = make_event("OBJ-RECON-API-5")
    resp = _client("nobody").put(
        reverse("ops-security-event-checklist", args=[event.pk]), [], format="json"
    )
    assert resp.status_code == 403


def test_checklist_with_non_numeric_id_is_404(event_manager_client):
    resp = event_manager_client.put(
        reverse("ops-security-event-checklist", args=["not-a-number"]),
        [],
        format="json",
    )
    assert resp.status_code == 404


def test_sector_posts_with_non_numeric_id_is_404(event_manager_client):
    resp = event_manager_client.put(
        reverse("ops-security-event-sector-posts", args=["not-a-number"]),
        [],
        format="json",
    )
    assert resp.status_code == 404
