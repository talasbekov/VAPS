"""Story 15.7b — `POST .../force-requests/generate` + `GET .../force-requests`
behavioral tests."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import (
    Group,
    GroupForceRequest,
    SecurityEvent,
    SecurityEventStaffingDemand,
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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_FORCEREQ", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="forcereq-operator", role_code=role)
    return _client("forcereq-operator")


def make_event(code="OBJ-FORCEREQ-API-1", status_code=SecurityEvent.StatusCode.DEMAND):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def generate_url(event):
    return reverse("ops-security-event-force-requests-generate", args=[event.pk])


def list_url(event):
    return reverse("ops-security-event-force-requests", args=[event.pk])


def test_generate_aggregates_by_group_and_sends(event_manager_client):
    event = make_event()
    Group.objects.create(code="DOGS", name="Кинология")
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", need=2, group="Кинология"
    )
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="B", need=3, group="Кинология"
    )
    resp = event_manager_client.post(generate_url(event))
    assert resp.status_code == 200, resp.data
    assert resp.data["unmatched_groups"] == []
    assert len(resp.data["force_requests"]) == 1
    row = resp.data["force_requests"][0]
    assert row["requested_count"] == 5
    assert row["status"] == "SENT"


def test_generate_reports_unmatched_groups(event_manager_client):
    event = make_event("OBJ-FORCEREQ-API-2")
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", need=1, group="Несуществующая группа"
    )
    resp = event_manager_client.post(generate_url(event))
    assert resp.status_code == 200
    assert resp.data["force_requests"] == []
    assert resp.data["unmatched_groups"] == ["Несуществующая группа"]


def test_regenerate_updates_count_but_preserves_allocation_progress(
    event_manager_client,
):
    event = make_event("OBJ-FORCEREQ-API-3")
    group = Group.objects.create(code="DOGS3", name="Кинология")
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", need=2, group="Кинология"
    )
    event_manager_client.post(generate_url(event))
    row = GroupForceRequest.objects.get(event=event, group=group)
    row.allocated_count = 1
    row.status = GroupForceRequest.Status.PARTIALLY_ALLOCATED
    row.save(update_fields=["allocated_count", "status"])

    SecurityEventStaffingDemand.objects.filter(event=event).update(need=10)
    resp = event_manager_client.post(generate_url(event))
    assert resp.status_code == 200
    row.refresh_from_db()
    assert row.requested_count == 10
    assert row.allocated_count == 1
    assert row.status == "PARTIALLY_ALLOCATED"
    assert GroupForceRequest.objects.filter(event=event).count() == 1


def test_generate_from_non_demand_status_is_422(event_manager_client):
    event = make_event("OBJ-FORCEREQ-API-4", status_code=SecurityEvent.StatusCode.RECON)
    resp = event_manager_client.post(generate_url(event))
    assert resp.status_code == 422


def test_generate_without_permission_is_403(seeded):
    event = make_event("OBJ-FORCEREQ-API-5")
    resp = _client("nobody").post(generate_url(event))
    assert resp.status_code == 403


def test_generate_emits_audited_row(event_manager_client):
    event = make_event("OBJ-FORCEREQ-API-6")
    Group.objects.create(code="DOGS6", name="Кинология")
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", need=1, group="Кинология"
    )
    event_manager_client.post(generate_url(event))
    log = AuditLog.objects.get(action="SECURITY_EVENT_FORCE_REQUESTS_GENERATED")
    assert log.actor_user_id == "forcereq-operator"
    assert log.new_value["requested_groups"] == ["Кинология"]


def test_list_returns_generated_requests(event_manager_client):
    event = make_event("OBJ-FORCEREQ-API-7")
    Group.objects.create(code="DOGS7", name="Кинология")
    SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", need=4, group="Кинология"
    )
    event_manager_client.post(generate_url(event))
    resp = event_manager_client.get(list_url(event))
    assert resp.status_code == 200
    assert len(resp.data) == 1
    assert resp.data[0]["group"]["code"] == "DOGS7"
