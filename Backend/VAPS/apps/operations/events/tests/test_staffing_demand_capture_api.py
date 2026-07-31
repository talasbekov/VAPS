"""Story 15.5b — `PUT .../staffing-demand` behavioral tests (replace-all,
empty-array reset, permission, 404)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_DEMAND", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="demand-operator", role_code=role)
    return _client("demand-operator")


def make_event(code="OBJ-DEMAND-API-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def demand_url(event):
    return reverse("ops-security-event-staffing-demand", args=[event.pk])


def test_replace_creates_rows(event_manager_client):
    event = make_event()
    resp = event_manager_client.put(
        demand_url(event),
        [{"sector": "A", "group": "Кинология", "need": 2}],
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert len(resp.data) == 1
    assert resp.data[0]["need"] == 2
    assert SecurityEventStaffingDemand.objects.filter(event=event).count() == 1


def test_replace_removes_old_rows(event_manager_client):
    event = make_event("OBJ-DEMAND-API-2")
    SecurityEventStaffingDemand.objects.create(event=event, sector="OLD", need=1)
    resp = event_manager_client.put(
        demand_url(event), [{"sector": "NEW", "need": 5}], format="json"
    )
    assert resp.status_code == 200
    sectors = list(
        SecurityEventStaffingDemand.objects.filter(event=event).values_list(
            "sector", flat=True
        )
    )
    assert sectors == ["NEW"]


def test_replace_with_empty_array_clears_all(event_manager_client):
    event = make_event("OBJ-DEMAND-API-3")
    SecurityEventStaffingDemand.objects.create(event=event, sector="A", need=1)
    resp = event_manager_client.put(demand_url(event), [], format="json")
    assert resp.status_code == 200
    assert resp.data == []
    assert not SecurityEventStaffingDemand.objects.filter(event=event).exists()


def test_without_permission_is_403(seeded):
    event = make_event("OBJ-DEMAND-API-4")
    resp = _client("nobody").put(demand_url(event), [], format="json")
    assert resp.status_code == 403


def test_with_non_numeric_id_is_404(event_manager_client):
    resp = event_manager_client.put(
        reverse("ops-security-event-staffing-demand", args=["not-a-number"]),
        [],
        format="json",
    )
    assert resp.status_code == 404
