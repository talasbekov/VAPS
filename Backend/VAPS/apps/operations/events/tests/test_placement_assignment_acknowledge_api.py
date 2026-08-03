"""Story 16.8e — API behavioral tests: `POST .../placement-assignments/{id}/
acknowledge`. Thin wrapper over acknowledge_placement_assignment() (16.6b) —
identity-based authorization (actor == the assigned employee via
UserEmployeeBinding), NOT an RBAC permission code, mirroring
NotificationViewSet's self-scope gate."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
    UserEmployeeBinding,
)
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
    role = Role.objects.create(code="TEST_ACK_CREATOR", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.create"
    )
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


@pytest.fixture
def submitter_client(seeded):
    role = Role.objects.create(code="TEST_ACK_SUBMITTER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.submit"
    )
    UserRole.objects.create(user_id="submitter-1", role_code=role)
    return _client("submitter-1")


@pytest.fixture
def approver_client(seeded):
    role = Role.objects.create(code="TEST_ACK_APPROVER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.approve"
    )
    UserRole.objects.create(user_id="approver-1", role_code=role)
    return _client("approver-1")


@pytest.fixture
def division():
    org = Organization.objects.create(name="AAN-ACK", code="AAN-ACK")
    dtp = DivisionType.objects.create(code="ack-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="AAN-ACK", code="AAN-ACK"
    )


def make_employee(division, iin):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )


def make_approved_assignment(
    creator_client, submitter_client, approver_client, division, code
):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    employee = make_employee(division, f"9001{uuid.uuid4().int % 10**8:08d}")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=employee.id
    )
    created = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[event.pk])
    )
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(reverse("ops-assignment-version-submit", args=[version.pk]))
    approver_client.post(reverse("ops-assignment-version-approve", args=[version.pk]))
    assignment = PlacementAssignment.objects.get(version=version)
    return assignment, employee.id


def acknowledge_url(assignment):
    return reverse("ops-placement-assignment-acknowledge", args=[assignment.pk])


def test_acknowledge_own_assignment(
    creator_client, submitter_client, approver_client, division
):
    assignment, employee_id = make_approved_assignment(
        creator_client, submitter_client, approver_client, division, "OBJ-ACK-1"
    )
    UserEmployeeBinding.objects.create(user_id="employee-1", employee_id=employee_id)
    employee_client = _client("employee-1")

    resp = employee_client.post(acknowledge_url(assignment))

    assert resp.status_code == 200
    assert resp.data["acknowledged_at"] is not None


def test_acknowledge_replay_is_idempotent(
    creator_client, submitter_client, approver_client, division
):
    assignment, employee_id = make_approved_assignment(
        creator_client, submitter_client, approver_client, division, "OBJ-ACK-2"
    )
    UserEmployeeBinding.objects.create(user_id="employee-2", employee_id=employee_id)
    employee_client = _client("employee-2")
    first = employee_client.post(acknowledge_url(assignment))

    second = employee_client.post(acknowledge_url(assignment))

    assert second.status_code == 200
    assert second.data["acknowledged_at"] == first.data["acknowledged_at"]
    assert (
        AuditLog.objects.filter(action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED").count() == 1
    )


def test_acknowledge_someone_elses_assignment_is_403(
    creator_client, submitter_client, approver_client, division
):
    assignment, _employee_id = make_approved_assignment(
        creator_client, submitter_client, approver_client, division, "OBJ-ACK-3"
    )
    other_employee = make_employee(division, "90019900001")
    UserEmployeeBinding.objects.create(
        user_id="other-employee", employee_id=other_employee.id
    )
    other_client = _client("other-employee")

    resp = other_client.post(acknowledge_url(assignment))

    assert resp.status_code == 403
    assert not AuditLog.objects.filter(
        action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED"
    ).exists()


def test_acknowledge_without_binding_is_403(
    creator_client, submitter_client, approver_client, division
):
    assignment, _employee_id = make_approved_assignment(
        creator_client, submitter_client, approver_client, division, "OBJ-ACK-4"
    )
    unbound_client = _client("no-binding-actor")

    resp = unbound_client.post(acknowledge_url(assignment))

    assert resp.status_code == 403


def test_acknowledge_not_approved_version_is_422(
    creator_client, submitter_client, division
):
    obj = FacilityObject.objects.create(
        code="OBJ-ACK-5", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    employee = make_employee(division, "90019900002")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=employee.id
    )
    created = creator_client.post(
        reverse("ops-security-event-placement-draft", args=[event.pk])
    )
    version = AssignmentVersion.objects.get(pk=created.data["id"])
    submitter_client.post(reverse("ops-assignment-version-submit", args=[version.pk]))
    assignment = PlacementAssignment.objects.get(version=version)
    UserEmployeeBinding.objects.create(user_id="employee-5", employee_id=employee.id)
    employee_client = _client("employee-5")

    resp = employee_client.post(acknowledge_url(assignment))

    assert resp.status_code == 422
    assert resp.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_acknowledge_nonexistent_assignment_is_404(seeded):
    resp = _client("someone").post(
        reverse("ops-placement-assignment-acknowledge", args=[999999])
    )
    assert resp.status_code == 404


def test_acknowledge_non_numeric_pk_is_404_not_500(seeded):
    resp = _client("someone").post(
        "/api/operations/placement-assignments/abc/acknowledge/"
    )
    assert resp.status_code == 404


def test_acknowledge_anonymous_is_403(
    creator_client, submitter_client, approver_client, division
):
    assignment, _employee_id = make_approved_assignment(
        creator_client, submitter_client, approver_client, division, "OBJ-ACK-6"
    )

    resp = APIClient().post(acknowledge_url(assignment))

    assert resp.status_code == 403
