"""Story 15.2a — `POST|GET /api/operations/security-events` behavioral tests
(create + list + permission gate). Same pattern as
apps.operations.duties.tests.test_duty_plan_audit for the HTTP-smoke shape.
"""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

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
    role = Role.objects.create(code="TEST_EVENT_MANAGER", name="Test event manager")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-15-2a", role_code=role)
    return _client("event-operator-15-2a")


def make_object(code="OBJ-EVT-API-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def test_create_without_senior_defaults_to_draft_and_null_senior(
    event_manager_client,
):
    obj = make_object("OBJ-EVT-API-2")
    resp = event_manager_client.post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ №1"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["status_code"] == "DRAFT"
    assert resp.data["senior_employee_id"] is None


def test_create_with_senior_persists_it_literally(event_manager_client):
    obj = make_object("OBJ-EVT-API-3")
    senior_id = str(uuid.uuid4())
    resp = event_manager_client.post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ №2", "senior_employee_id": senior_id},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["senior_employee_id"] == senior_id
    event = SecurityEvent.objects.get(pk=resp.data["id"])
    assert str(event.senior_employee_id) == senior_id


def test_create_without_permission_is_403(seeded):
    obj = make_object("OBJ-EVT-API-4")
    resp = _client("nobody").post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ №3"},
        format="json",
    )
    assert resp.status_code == 403


def test_list_paginates_and_filters_by_object(event_manager_client):
    obj_a = make_object("OBJ-EVT-API-5")
    obj_b = make_object("OBJ-EVT-API-6")
    SecurityEvent.objects.create(object=obj_a, title="ОМ A1")
    SecurityEvent.objects.create(object=obj_a, title="ОМ A2")
    SecurityEvent.objects.create(object=obj_b, title="ОМ B1")

    resp_all = event_manager_client.get(reverse("ops-security-event-list"))
    assert resp_all.status_code == 200
    assert resp_all.data["count"] == 3

    resp_filtered = event_manager_client.get(
        reverse("ops-security-event-list"), {"object": obj_a.pk}
    )
    assert resp_filtered.status_code == 200
    assert resp_filtered.data["count"] == 2


def test_list_with_non_numeric_object_filter_is_400_not_500(event_manager_client):
    resp = event_manager_client.get(
        reverse("ops-security-event-list"), {"object": "not-a-number"}
    )
    assert resp.status_code == 400
