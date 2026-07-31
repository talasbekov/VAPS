"""Story 15.12 — HTTP-level end-to-end chain test for Epic 15's full ОМ
lifecycle: create -> bulletin -> recon/confirm (dual-control) ->
staffing-demand -> staffing-demand/approve -> force-requests/generate ->
allocate.

Every prior story tested ITS OWN route in isolation, seeding fixtures
directly at the model level. This is the first test that proves the routes
actually COMPOSE end-to-end, purely through `APIClient` calls chained
together — each step's URL/payload built from the PREVIOUS step's HTTP
response, never a direct model create for the entity under test.
"""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import Group
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
    role = Role.objects.create(code="TEST_E2E_EVENT_MANAGER", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="e2e-event-operator", role_code=role)
    return _client("e2e-event-operator")


@pytest.fixture
def event_manager_role(seeded):
    role = Role.objects.create(code="TEST_E2E_RECON_MANAGER", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    return role


@pytest.fixture
def broker_client(seeded):
    role = Role.objects.create(code="TEST_E2E_BROKER", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="brokerage.manage")
    UserRole.objects.create(user_id="e2e-broker-operator", role_code=role)
    return _client("e2e-broker-operator")


def make_object(code="OBJ-E2E-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def test_full_chain_create_to_allocated(
    event_manager_client, event_manager_role, broker_client
):
    obj = make_object()
    Group.objects.create(code="E2E-DOGS", name="Кинология")

    # Step 1 — create (DRAFT)
    resp = event_manager_client.post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ e2e"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["status_code"] == "DRAFT"
    event_id = resp.data["id"]

    # Step 2 — bulletin (DRAFT -> BULLETIN)
    resp = event_manager_client.post(
        reverse("ops-security-event-bulletin", args=[event_id])
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "BULLETIN"

    # Step 3 — recon/confirm, dual-control: two DIFFERENT actors.
    confirm_url = reverse("ops-security-event-recon-confirm", args=[event_id])
    recon_actor_a = _client("e2e-recon-actor-a")
    UserRole.objects.create(user_id="e2e-recon-actor-a", role_code=event_manager_role)
    recon_actor_b = _client("e2e-recon-actor-b")
    UserRole.objects.create(user_id="e2e-recon-actor-b", role_code=event_manager_role)

    resp = recon_actor_a.post(confirm_url)
    assert resp.status_code == 202, resp.data
    assert resp.data["status_code"] == "BULLETIN"  # first confirmation is pending

    resp = recon_actor_b.post(confirm_url)
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "RECON"

    # Step 4 — staffing-demand (working draft, replace-all)
    resp = event_manager_client.put(
        reverse("ops-security-event-staffing-demand", args=[event_id]),
        [{"sector": "A", "group": "Кинология", "need": 5}],
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data[0]["need"] == 5

    # Step 5 — staffing-demand/approve (RECON -> DEMAND)
    resp = event_manager_client.post(
        reverse("ops-security-event-staffing-demand-approve", args=[event_id])
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["status_code"] == "DEMAND"

    # Step 6 — force-requests/generate (aggregates demand -> GroupForceRequest)
    resp = event_manager_client.post(
        reverse("ops-security-event-force-requests-generate", args=[event_id])
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["unmatched_groups"] == []
    assert len(resp.data["force_requests"]) == 1
    force_request = resp.data["force_requests"][0]
    assert force_request["requested_count"] == 5
    assert force_request["status"] == "SENT"
    force_request_id = force_request["id"]

    # Step 7 — allocate (SENT -> ALLOCATED), a DIFFERENT ViewSet/router.
    resp = broker_client.patch(
        reverse("ops-force-request-allocate", args=[force_request_id]),
        {"allocated_count": 5},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["status"] == "ALLOCATED"

    # AC-4 — the chain leaves a full audit trail, not just status changes.
    audited_actions = set(
        AuditLog.objects.filter(entity_id__isnull=False).values_list(
            "action", flat=True
        )
    )
    for expected_action in {
        "SECURITY_EVENT_BULLETIN_ISSUED",
        "SECURITY_EVENT_RECON_CONFIRMED",
        "SECURITY_EVENT_DEMAND_APPROVED",
        "SECURITY_EVENT_FORCE_REQUESTS_GENERATED",
        "GROUP_FORCE_REQUEST_ALLOCATED",
    }:
        assert expected_action in audited_actions, (
            f"{expected_action} missing from audit trail: {audited_actions}"
        )


def test_force_requests_generate_before_demand_approved_is_rejected(
    event_manager_client,
):
    """AC-5: the chain cannot skip a step — generating force requests
    before the event has reached DEMAND status must be rejected, not
    silently allowed."""
    obj = make_object("OBJ-E2E-SKIP-1")
    resp = event_manager_client.post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ e2e skip"},
        format="json",
    )
    event_id = resp.data["id"]
    assert resp.data["status_code"] == "DRAFT"

    # Still DRAFT — never went through bulletin/recon/approve.
    resp = event_manager_client.post(
        reverse("ops-security-event-force-requests-generate", args=[event_id])
    )
    assert resp.status_code in (400, 404, 409, 422)
