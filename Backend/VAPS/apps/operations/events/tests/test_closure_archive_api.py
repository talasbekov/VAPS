"""Story 18.6a — API behavioral tests: `close`/`archive` actions on
SecurityEventViewSet. Thin wrapper over close_security_event() (18.1) and
SecurityEventArchiveSelector.full_history() (18.2)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import SecurityEvent, SecurityEventSectorPost
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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_18_6A", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-18-6a", role_code=role)
    return _client("event-operator-18-6a")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role-18-6a")


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_sector_post(event, sector, code="POST-1"):
    return SecurityEventSectorPost.objects.create(event=event, sector=sector, post=code)


def post_close(client, event, summaries):
    # nested list-of-dicts body — multipart (APIClient's default format)
    # mangles it, same fix as test_amend_replace_api.py.
    return client.post(close_url(event), {"summaries": summaries}, format="json")


def close_url(event):
    return reverse("ops-security-event-close", args=[event.pk])


def archive_url(event):
    return reverse("ops-security-event-archive", args=[event.pk])


# --- close ---


def test_close_success_with_full_coverage(event_manager_client):
    event = make_event("OBJ-CLARC-1")
    make_sector_post(event, "north")

    resp = post_close(
        event_manager_client, event, [{"sector": "north", "summary": "Спокойно"}]
    )

    assert resp.status_code == 200
    assert resp.data["status_code"] == "CLOSED"


def test_close_missing_sector_is_400_with_detail(event_manager_client):
    event = make_event("OBJ-CLARC-2")
    make_sector_post(event, "north")
    make_sector_post(event, "south")

    resp = post_close(
        event_manager_client, event, [{"sector": "north", "summary": "Спокойно"}]
    )

    assert resp.status_code == 400
    assert resp.data["details"]["missing_sectors"] == ["south"]


def test_close_twice_is_422_not_idempotent(event_manager_client):
    event = make_event("OBJ-CLARC-3")
    make_sector_post(event, "north")
    post_close(
        event_manager_client, event, [{"sector": "north", "summary": "Спокойно"}]
    )

    resp = post_close(
        event_manager_client, event, [{"sector": "north", "summary": "ещё раз"}]
    )

    assert resp.status_code == 422


def test_close_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-CLARC-4")
    make_sector_post(event, "north")

    resp = post_close(
        no_permission_client, event, [{"sector": "north", "summary": "x"}]
    )

    assert resp.status_code == 403


# --- archive ---


def test_archive_on_closed_event_returns_full_history(event_manager_client):
    event = make_event("OBJ-CLARC-5")
    make_sector_post(event, "north")
    post_close(
        event_manager_client, event, [{"sector": "north", "summary": "Спокойно"}]
    )

    resp = event_manager_client.get(archive_url(event))

    assert resp.status_code == 200
    assert resp.data["event"]["id"] == event.pk
    assert resp.data["closure_summaries"][0]["sector"] == "north"
    assert resp.data["closure_summaries"][0]["summary"] == "Спокойно"
    assert resp.data["current_assignment_version"] is None
    assert resp.data["journal_entries"] == []


def test_archive_on_non_closed_event_is_422(event_manager_client):
    event = make_event("OBJ-CLARC-6")

    resp = event_manager_client.get(archive_url(event))

    assert resp.status_code == 422


def test_archive_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-CLARC-7", status_code=SecurityEvent.StatusCode.CLOSED)

    resp = no_permission_client.get(archive_url(event))

    assert resp.status_code == 403
