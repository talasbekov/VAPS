"""Story 16.8b — API behavioral tests: `POST .../assignment-versions/{id}/submit`.
Thin wrapper over the already-idempotent submit_assignment_version() (16.4)."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import (
    AssignmentVersion,
    SecurityEvent,
    SecurityEventDirectAssignment,
)
from apps.operations.events.services import (
    approve_assignment_version,
    return_assignment_version,
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
    role = Role.objects.create(code="TEST_SUBMIT_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def submitter_client(seeded):
    role = Role.objects.create(code="TEST_SUBMIT_SUBMITTER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.submit"
    )
    UserRole.objects.create(user_id="submitter-1", role_code=role)
    return _client("submitter-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_draft_version(code="OBJ-SUB-1", post_code="POST-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code=post_code, name="Пост")
    sector_post = event.sector_posts.create(sector="A", post=post_code)
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    return event


def draft_url(event):
    return reverse("ops-security-event-placement-draft", args=[event.pk])


def submit_url(version):
    return reverse("ops-assignment-version-submit", args=[version.pk])


def test_submit_draft(creator_client, submitter_client):
    event = make_draft_version()
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])

    resp = submitter_client.post(submit_url(version))

    assert resp.status_code == 200
    assert resp.data["status"] == "SUBMITTED"


def test_submit_replay_is_idempotent(creator_client, submitter_client):
    event = make_draft_version("OBJ-SUB-2")
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(submit_url(version))

    resp = submitter_client.post(submit_url(version))

    assert resp.status_code == 200
    assert resp.data["status"] == "SUBMITTED"
    assert AuditLog.objects.filter(action="ASSIGNMENT_VERSION_SUBMITTED").count() == 1


def test_submit_approved_version_is_422(creator_client, submitter_client):
    """16.8d (approve API) doesn't exist yet — reach APPROVED via the
    already-tested service function directly, same as other 16.8x tests
    do for states their own story doesn't build the API for."""
    event = make_draft_version("OBJ-SUB-3")
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(submit_url(version))
    approve_assignment_version(version, actor="approver-1")

    resp = submitter_client.post(submit_url(version))

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_submit_nonexistent_version_is_404(submitter_client):
    resp = submitter_client.post(
        reverse("ops-assignment-version-submit", args=[999999])
    )
    assert resp.status_code == 404


def test_submit_non_numeric_pk_is_404_not_500(submitter_client):
    """Review coverage gap (Edge Case Hunter): only the nonexistent-
    numeric-pk path was pinned by a test — the isdigit() guard itself
    (16.8a's established pattern) was untested on THIS action."""
    resp = submitter_client.post(
        "/api/operations/assignment-versions/abc/submit/"
    )
    assert resp.status_code == 404


def test_submit_returned_version_is_422(creator_client, submitter_client):
    """Review coverage gap (Edge Case Hunter): AC-3 was only exercised via
    an APPROVED-source version — RETURNED is a DISTINCT status hitting
    the same "not DRAFT and not SUBMITTED" branch, worth pinning
    separately since it's the OLD (now non-current) version, not the
    fresh DRAFT return_assignment_version() also creates."""
    event = make_draft_version("OBJ-SUB-5")
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(submit_url(version))
    return_assignment_version(version, actor="approver-1", reason="Проверить")
    version.refresh_from_db()
    assert version.status == "RETURNED"

    resp = submitter_client.post(submit_url(version))

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_submit_without_permission_is_403(creator_client, no_permission_client):
    event = make_draft_version("OBJ-SUB-4")
    created = creator_client.post(draft_url(event))
    version = AssignmentVersion.objects.get(pk=created.data["id"])

    resp = no_permission_client.post(submit_url(version))

    assert resp.status_code == 403
