"""Story 16.8d — API behavioral tests: `POST .../assignment-versions/{id}/approve`.
Thin wrapper over approve_assignment_version() (16.4) — idempotent (unlike
16.8c's return), optional override/override_reason, 409 SOFT_CONFLICT_DETECTED
on unreviewed conflicts."""

import datetime
import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
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
    role = Role.objects.create(code="TEST_APPROVE_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def submitter_client(seeded):
    role = Role.objects.create(code="TEST_APPROVE_SUBMITTER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.submit"
    )
    UserRole.objects.create(user_id="submitter-1", role_code=role)
    return _client("submitter-1")


@pytest.fixture
def approver_client(seeded):
    role = Role.objects.create(code="TEST_APPROVE_APPROVER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.approve"
    )
    UserRole.objects.create(user_id="approver-1", role_code=role)
    return _client("approver-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_submitted_version(
    creator_client,
    submitter_client,
    code="OBJ-APR-1",
    employee_id=None,
    starts_at=None,
    ends_at=None,
):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(
        object=obj, title="ОМ", starts_at=starts_at, ends_at=ends_at
    )
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event,
        sector_post=sector_post,
        employee_id=employee_id or uuid.uuid4(),
    )
    created = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[event.pk])
    )
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(reverse("ops-assignment-version-submit", args=[version.pk]))
    return version


def approve_url(version):
    return reverse("ops-assignment-version-approve", args=[version.pk])


def test_approve_submitted_version(creator_client, submitter_client, approver_client):
    version = make_submitted_version(creator_client, submitter_client)

    resp = approver_client.post(approve_url(version), {})

    assert resp.status_code == 200
    assert resp.data["status"] == "APPROVED"
    assert resp.data["signature_hash"]


def test_approve_replay_is_idempotent(
    creator_client, submitter_client, approver_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-APR-2")
    approver_client.post(approve_url(version), {})

    resp = approver_client.post(approve_url(version), {})

    assert resp.status_code == 200
    assert resp.data["status"] == "APPROVED"
    assert AuditLog.objects.filter(action="ASSIGNMENT_VERSION_APPROVED").count() == 1


def test_approve_with_conflict_without_override_is_409(
    creator_client, submitter_client, approver_client
):
    employee_id = uuid.uuid4()
    now = timezone.now()
    version_a = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-APR-3A",
        employee_id,
        now,
        now + datetime.timedelta(hours=8),
    )
    make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-APR-3B",
        employee_id,
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )

    resp = approver_client.post(approve_url(version_a), {})

    assert resp.status_code == 409
    assert resp.data["error_code"] == "SOFT_CONFLICT_DETECTED"


def test_approve_with_conflict_and_override_is_200(
    creator_client, submitter_client, approver_client
):
    employee_id = uuid.uuid4()
    now = timezone.now()
    version_a = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-APR-4A",
        employee_id,
        now,
        now + datetime.timedelta(hours=8),
    )
    make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-APR-4B",
        employee_id,
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )

    resp = approver_client.post(
        approve_url(version_a),
        {"override": True, "override_reason": "Разрешено вручную"},
    )

    assert resp.status_code == 200
    assert resp.data["status"] == "APPROVED"


def test_approve_override_true_without_reason_is_400(
    creator_client, submitter_client, approver_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-APR-5")

    resp = approver_client.post(approve_url(version), {"override": True})

    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_approve_draft_version_is_422(creator_client, approver_client):
    obj = FacilityObject.objects.create(
        code="OBJ-APR-6", name="Штаб", address="г. Кызылорда"
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

    resp = approver_client.post(approve_url(version), {})

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_approve_nonexistent_version_is_404(approver_client):
    resp = approver_client.post(
        reverse("ops-assignment-version-approve", args=[999999]), {}
    )
    assert resp.status_code == 404


def test_approve_non_numeric_pk_is_404_not_500(approver_client):
    resp = approver_client.post("/api/operations/assignment-versions/abc/approve/", {})
    assert resp.status_code == 404


def test_approve_without_permission_is_403(
    creator_client, submitter_client, no_permission_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-APR-7")

    resp = no_permission_client.post(approve_url(version), {})

    assert resp.status_code == 403
