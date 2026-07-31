"""Story 15.8 — `PATCH /force-requests/{id}/allocate` behavioral tests."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import Group, GroupForceRequest, SecurityEvent
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
def broker_client(seeded):
    role = Role.objects.create(code="TEST_BROKER", name="Test broker")
    RolePermission.objects.create(role_code=role, permission_code_id="brokerage.manage")
    UserRole.objects.create(user_id="broker-operator", role_code=role)
    return _client("broker-operator")


def make_request(requested_count=5):
    obj = FacilityObject.objects.create(
        code="OBJ-ALLOCATE-1", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    group = Group.objects.create(code="DOGS", name="Кинология")
    return GroupForceRequest.objects.create(
        event=event, group=group, requested_count=requested_count, status="SENT"
    )


def allocate_url(request):
    return reverse("ops-force-request-allocate", args=[request.pk])


def test_full_allocation_sets_allocated_status(broker_client):
    force_request = make_request(requested_count=5)
    resp = broker_client.patch(
        allocate_url(force_request), {"allocated_count": 5}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["status"] == "ALLOCATED"
    force_request.refresh_from_db()
    assert force_request.allocated_count == 5


def test_partial_allocation_sets_partially_allocated_status(broker_client):
    force_request = make_request(requested_count=5)
    resp = broker_client.patch(
        allocate_url(force_request), {"allocated_count": 2}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["status"] == "PARTIALLY_ALLOCATED"


def test_zero_allocation_stays_sent(broker_client):
    force_request = make_request(requested_count=5)
    resp = broker_client.patch(
        allocate_url(force_request), {"allocated_count": 0}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["status"] == "SENT"


def test_zero_requested_zero_allocated_is_sent_not_allocated(broker_client):
    # Review (Blind Hunter/Edge Case Hunter): the `== 0` branch must be
    # checked BEFORE `allocated_count >= requested_count` — otherwise a
    # never-staffed request (requested_count=0) allocating 0 people would
    # wrongly satisfy `0 >= 0` and land on ALLOCATED instead of SENT. Seed
    # a non-zero allocated_count first so the PATCH to 0 is a REAL change
    # (not the count_unchanged no-op shortcut), genuinely exercising the
    # status-derivation branch order.
    force_request = make_request(requested_count=0)
    force_request.allocated_count = 1
    force_request.status = GroupForceRequest.Status.PARTIALLY_ALLOCATED
    force_request.save(update_fields=["allocated_count", "status"])
    resp = broker_client.patch(
        allocate_url(force_request), {"allocated_count": 0}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["status"] == "SENT"


def test_allocation_exceeding_requested_is_400(broker_client):
    force_request = make_request(requested_count=5)
    resp = broker_client.patch(
        allocate_url(force_request), {"allocated_count": 6}, format="json"
    )
    assert resp.status_code == 400
    force_request.refresh_from_db()
    assert force_request.allocated_count == 0


def test_allocate_without_permission_is_403(seeded):
    force_request = make_request()
    resp = _client("nobody").patch(
        allocate_url(force_request), {"allocated_count": 1}, format="json"
    )
    assert resp.status_code == 403


def test_allocate_with_non_numeric_id_is_404(broker_client):
    resp = broker_client.patch(
        reverse("ops-force-request-allocate", args=["not-a-number"]),
        {"allocated_count": 1},
        format="json",
    )
    assert resp.status_code == 404


def test_allocate_emits_audited_row(broker_client):
    force_request = make_request(requested_count=5)
    broker_client.patch(
        allocate_url(force_request), {"allocated_count": 2}, format="json"
    )
    log = AuditLog.objects.get(action="GROUP_FORCE_REQUEST_ALLOCATED")
    assert log.actor_user_id == "broker-operator"
    assert log.new_value["allocated_count"] == 2
    assert log.new_value["status"] == "PARTIALLY_ALLOCATED"


def test_repeat_allocation_of_same_value_does_not_duplicate_audit(broker_client):
    force_request = make_request(requested_count=5)
    broker_client.patch(
        allocate_url(force_request), {"allocated_count": 2}, format="json"
    )
    broker_client.patch(
        allocate_url(force_request), {"allocated_count": 2}, format="json"
    )
    assert AuditLog.objects.filter(action="GROUP_FORCE_REQUEST_ALLOCATED").count() == 1
