"""Story 16.8c — API behavioral tests: `POST .../assignment-versions/{id}/return`.
Thin wrapper over return_assignment_version() (16.4) — NOT idempotent,
requires a reason, returns (old RETURNED version, new DRAFT version)."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
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
    role = Role.objects.create(code="TEST_RETURN_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def submitter_client(seeded):
    role = Role.objects.create(code="TEST_RETURN_SUBMITTER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.submit"
    )
    UserRole.objects.create(user_id="submitter-1", role_code=role)
    return _client("submitter-1")


@pytest.fixture
def approver_client(seeded):
    role = Role.objects.create(code="TEST_RETURN_APPROVER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.return"
    )
    UserRole.objects.create(user_id="approver-1", role_code=role)
    return _client("approver-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_submitted_version(creator_client, submitter_client, code="OBJ-RET-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    created = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[event.pk])
    )
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(reverse("ops-assignment-version-submit", args=[version.pk]))
    return version


def return_url(version):
    return reverse("ops-assignment-version-return", args=[version.pk])


def test_return_submitted_version(creator_client, submitter_client, approver_client):
    version = make_submitted_version(creator_client, submitter_client)

    resp = approver_client.post(return_url(version), {"reason": "Проверить состав"})

    assert resp.status_code == 200
    assert resp.data["status"] == "RETURNED"
    assert resp.data["new_draft_version"]["status"] == "DRAFT"
    assert resp.data["new_draft_version"]["version"] == version.version + 1
    assert "assignments" not in resp.data["new_draft_version"]


def test_return_copies_assignments_to_new_draft(
    creator_client, submitter_client, approver_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-2")
    old_assignment = PlacementAssignment.objects.get(version=version)

    resp = approver_client.post(return_url(version), {"reason": "Проверить состав"})

    new_version_id = resp.data["new_draft_version"]["id"]
    new_assignment = PlacementAssignment.objects.get(version_id=new_version_id)
    assert new_assignment.employee_id == old_assignment.employee_id
    assert new_assignment.post_id == old_assignment.post_id


def test_return_without_reason_is_400(
    creator_client, submitter_client, approver_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-3")

    resp = approver_client.post(return_url(version), {})

    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"
    assert "reason" in resp.data["details"]


def test_return_blank_reason_is_400(creator_client, submitter_client, approver_client):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-4")

    resp = approver_client.post(return_url(version), {"reason": ""})

    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_return_whitespace_only_reason_is_400(
    creator_client, submitter_client, approver_client
):
    """Whitespace-only reason passes ReturnVersionSerializer's allow_blank=False
    check (non-empty string) and is only caught by return_assignment_version()'s
    own .strip() guard — a different code path than the blank-string case above,
    still a clean 400, not a 500 or a silently-accepted reason."""
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-8")

    resp = approver_client.post(return_url(version), {"reason": "   "})

    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_return_draft_version_is_422(creator_client, approver_client):
    obj = FacilityObject.objects.create(
        code="OBJ-RET-5", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    created = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[event.pk])
    )
    version = AssignmentVersion.objects.get(pk=created.data["id"])

    resp = approver_client.post(return_url(version), {"reason": "Проверить"})

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_return_replay_is_not_idempotent(
    creator_client, submitter_client, approver_client
):
    """AC-3: unlike submit/approve, return_assignment_version() is
    terminal on the specific row — a second /return on the now-RETURNED
    version is a real 422, not a clean 200."""
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-6")
    approver_client.post(return_url(version), {"reason": "Первая причина"})

    resp = approver_client.post(return_url(version), {"reason": "Вторая причина"})

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"
    assert AuditLog.objects.filter(action="ASSIGNMENT_VERSION_RETURNED").count() == 1


def test_return_nonexistent_version_is_404(approver_client):
    resp = approver_client.post(
        reverse("ops-assignment-version-return", args=[999999]), {"reason": "X"}
    )
    assert resp.status_code == 404


def test_return_non_numeric_pk_is_404_not_500(approver_client):
    resp = approver_client.post(
        "/api/operations/assignment-versions/abc/return/", {"reason": "X"}
    )
    assert resp.status_code == 404


def test_return_without_permission_is_403(
    creator_client, submitter_client, no_permission_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-RET-7")

    resp = no_permission_client.post(return_url(version), {"reason": "X"})

    assert resp.status_code == 403
