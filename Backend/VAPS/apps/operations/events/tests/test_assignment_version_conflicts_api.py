"""Story 16.8f — API behavioral tests: `GET .../assignment-versions/{id}/conflicts`.
Thin wrapper over detect_placement_conflicts() (16.3b-d) — fresh recompute on
every call, response filtered to ONLY conflicting rows (distinct from
retrieve's full nested assignments list, 16.8a)."""

import datetime
import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.operations.events.models import AssignmentVersion, SecurityEvent
from apps.operations.events.models import SecurityEventDirectAssignment
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
    role = Role.objects.create(code="TEST_CONFLICTS_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def submitter_client(seeded):
    role = Role.objects.create(code="TEST_CONFLICTS_SUBMITTER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.submit"
    )
    UserRole.objects.create(user_id="submitter-1", role_code=role)
    return _client("submitter-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_submitted_version(
    creator_client,
    submitter_client,
    code,
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


def conflicts_url(version):
    return reverse("ops-assignment-version-conflicts", args=[version.pk])


def test_conflicts_returns_only_conflicting_rows(creator_client, submitter_client):
    employee_id = uuid.uuid4()
    now = timezone.now()
    version_a = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-1A",
        employee_id,
        now,
        now + datetime.timedelta(hours=8),
    )
    make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-1B",
        employee_id,
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )

    resp = submitter_client.get(conflicts_url(version_a))

    assert resp.status_code == 200
    assert len(resp.data) == 1
    assert resp.data[0]["conflict_severity"] == "SOFT"
    assert "DOUBLE_ASSIGNMENT_CONFLICT" in resp.data[0]["conflict_codes"]


def test_conflicts_empty_when_no_conflict(creator_client, submitter_client):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-CONF-2")

    resp = submitter_client.get(conflicts_url(version))

    assert resp.status_code == 200
    assert resp.data == []


def test_conflicts_is_plain_unpaginated_list(creator_client, submitter_client):
    """Distinct from list's paginated {count, next, previous, results}
    envelope — a future accidental pagination-wrap would silently break
    consumers expecting a bare array."""
    version = make_submitted_version(creator_client, submitter_client, "OBJ-CONF-2B")

    resp = submitter_client.get(conflicts_url(version))

    assert isinstance(resp.data, list)
    assert "results" not in resp.data


def test_conflicts_clears_when_resolved(creator_client, submitter_client):
    """Reverse direction of test_conflicts_reflects_fresh_recompute: a row
    that WAS conflicting must disappear from the response once the
    underlying overlap is resolved — not remain stuck from a stale
    snapshot."""
    employee_id = uuid.uuid4()
    now = timezone.now()
    version_a = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-2C-A",
        employee_id,
        now,
        now + datetime.timedelta(hours=8),
    )
    version_b = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-2C-B",
        employee_id,
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )
    first = submitter_client.get(conflicts_url(version_a))
    assert len(first.data) == 1

    version_b.event.starts_at = now + datetime.timedelta(hours=20)
    version_b.event.ends_at = now + datetime.timedelta(hours=24)
    version_b.event.save(update_fields=["starts_at", "ends_at"])
    second = submitter_client.get(conflicts_url(version_a))

    assert second.data == []


def test_conflicts_reflects_fresh_recompute(creator_client, submitter_client):
    employee_id = uuid.uuid4()
    now = timezone.now()
    version_a = make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-3A",
        employee_id,
        now,
        now + datetime.timedelta(hours=8),
    )
    first = submitter_client.get(conflicts_url(version_a))
    assert first.data == []

    make_submitted_version(
        creator_client,
        submitter_client,
        "OBJ-CONF-3B",
        employee_id,
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )
    second = submitter_client.get(conflicts_url(version_a))

    assert len(second.data) == 1


def test_conflicts_nonexistent_version_is_404(submitter_client):
    resp = submitter_client.get(
        reverse("ops-assignment-version-conflicts", args=[999999])
    )
    assert resp.status_code == 404


def test_conflicts_non_numeric_pk_is_404_not_500(submitter_client):
    resp = submitter_client.get("/api/operations/assignment-versions/abc/conflicts/")
    assert resp.status_code == 404


def test_conflicts_without_permission_is_403(
    creator_client, submitter_client, no_permission_client
):
    version = make_submitted_version(creator_client, submitter_client, "OBJ-CONF-4")

    resp = no_permission_client.get(conflicts_url(version))

    assert resp.status_code == 403
