"""Story 16.8a — API behavioral tests: draft-formation POST +
assignment-versions list/detail GET, permissions, 404, 409."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import (
    AssignmentVersion,
    SecurityEvent,
    SecurityEventDirectAssignment,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
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
def creator_client(seeded):
    role = Role.objects.create(code="TEST_ASSIGNMENT_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def approver_client(seeded):
    role = Role.objects.create(code="TEST_ASSIGNMENT_APPROVER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.approve"
    )
    UserRole.objects.create(user_id="approver-1", role_code=role)
    return _client("approver-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_event_with_direct_assignment(code="OBJ-PL-1", post_code="POST-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    post = Post.objects.create(object=obj, code=post_code, name="Пост")
    sector_post = event.sector_posts.create(sector="A", post=post_code)
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    return event, post


def draft_url(event):
    return reverse("ops-security-event-placement-draft", args=[event.pk])


def list_url():
    return reverse("ops-assignment-version-list")


def detail_url(version):
    return reverse("ops-assignment-version-detail", args=[version.pk])


def test_create_draft(creator_client):
    event, post = make_event_with_direct_assignment()

    resp = creator_client.post(draft_url(event))

    assert resp.status_code == 201
    assert resp.data["status"] == "DRAFT"
    assert resp.data["event"] == event.pk
    assert len(resp.data["assignments"]) == 1
    assert AssignmentVersion.objects.filter(event=event).exists()


def test_create_draft_without_permission_is_403(no_permission_client):
    event, post = make_event_with_direct_assignment("OBJ-PL-2")

    resp = no_permission_client.post(draft_url(event))

    assert resp.status_code == 403


def test_create_draft_twice_is_409(creator_client):
    event, post = make_event_with_direct_assignment("OBJ-PL-3")
    first = creator_client.post(draft_url(event))
    assert first.status_code == 201

    second = creator_client.post(draft_url(event))

    assert second.status_code == 409
    assert second.data["error_code"] == "PLACEMENT_DRAFT_ALREADY_EXISTS"


def test_create_draft_nonexistent_event_is_404(creator_client):
    resp = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[999999])
    )
    assert resp.status_code == 404


def test_list_versions(creator_client):
    event, post = make_event_with_direct_assignment("OBJ-PL-4")
    creator_client.post(draft_url(event))

    resp = creator_client.get(list_url())

    assert resp.status_code == 200
    assert resp.data["count"] == 1


def test_list_filtered_by_event(creator_client):
    event_a, _ = make_event_with_direct_assignment("OBJ-PL-5A")
    event_b, _ = make_event_with_direct_assignment("OBJ-PL-5B")
    creator_client.post(draft_url(event_a))
    creator_client.post(draft_url(event_b))

    resp = creator_client.get(list_url(), {"event": event_a.pk})

    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["event"] == event_a.pk


def test_list_without_permission_is_403(no_permission_client):
    resp = no_permission_client.get(list_url())
    assert resp.status_code == 403


def test_approver_can_read_versions_created_by_omd(creator_client, approver_client):
    """AC-3/4: read access is gated on ANY of the assignment.* codes —
    an APPROVER (who never creates drafts) can still list/read them."""
    event, post = make_event_with_direct_assignment("OBJ-PL-6")
    creator_client.post(draft_url(event))

    resp = approver_client.get(list_url())

    assert resp.status_code == 200
    assert resp.data["count"] == 1


def test_retrieve_version_detail(creator_client):
    event, post = make_event_with_direct_assignment("OBJ-PL-7")
    created = creator_client.post(draft_url(event))
    version_id = created.data["id"]

    resp = creator_client.get(detail_url(AssignmentVersion.objects.get(pk=version_id)))

    assert resp.status_code == 200
    assert resp.data["status"] == "DRAFT"
    assert len(resp.data["assignments"]) == 1
    row = resp.data["assignments"][0]
    assert "conflict_severity" in row
    assert "conflict_codes" in row
    assert "acknowledged_at" in row
    assert "ack_escalated_at" in row


def test_retrieve_nonexistent_version_is_404(creator_client):
    resp = creator_client.get(reverse("ops-assignment-version-detail", args=[999999]))
    assert resp.status_code == 404


def test_retrieve_without_permission_is_403(creator_client, no_permission_client):
    event, post = make_event_with_direct_assignment("OBJ-PL-8")
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])

    resp = no_permission_client.get(detail_url(version))

    assert resp.status_code == 403
