"""Story 17.7b — API behavioral tests: amend/replace-departed actions on
AssignmentVersionViewSet. Thin wrappers over amend_assignment_version()
(17.3) / cascade_replace_departed() (17.5)."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
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
def amend_client(seeded):
    role = Role.objects.create(code="TEST_AMEND", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="assignment.amend")
    UserRole.objects.create(user_id="amender-1", role_code=role)
    return _client("amender-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_division(code):
    org = Organization.objects.create(name=code, code=code)
    dtype = DivisionType.objects.get_or_create(code="dept", defaults={"name": "Отдел"})[
        0
    ]
    return Division.objects.create(
        organization=org, type_code=dtype, name=code, code=code
    )


def make_employee(division, iin, position_code="GUARD"):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        position_code=position_code,
        division=division,
    )


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def make_approved_version(event, division=None):
    return AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.APPROVED, version=1
    )


def assign(version, employee_id, post):
    return PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post
    )


def amend_url(version):
    return reverse("ops-assignment-version-amend", args=[version.pk])


def replace_url(version):
    return reverse("ops-assignment-version-replace-departed", args=[version.pk])


def test_amend_creates_new_version(amend_client):
    event = make_event("OBJ-AMD-1")
    post = make_post(event.object)
    version = make_approved_version(event)
    employee_id = str(uuid.uuid4())

    resp = amend_client.post(
        amend_url(version),
        {
            "reason": "Уточнение состава",
            "sanction": "Приказ №5",
            "assignments": [{"employee_id": employee_id, "post": post.pk}],
        },
        format="json",
    )

    assert resp.status_code == 201
    assert resp.data["id"] != version.pk
    assert resp.data["is_current"] is True
    assert len(resp.data["assignments"]) == 1


def test_amend_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-AMD-2")
    version = make_approved_version(event)

    resp = no_permission_client.post(
        amend_url(version),
        {"reason": "x", "sanction": "y", "assignments": []},
        format="json",
    )

    assert resp.status_code == 403


def test_amend_empty_reason_is_400(amend_client):
    event = make_event("OBJ-AMD-3")
    version = make_approved_version(event)

    resp = amend_client.post(
        amend_url(version),
        {"reason": "", "sanction": "y", "assignments": []},
        format="json",
    )

    assert resp.status_code == 400


def test_amend_non_current_version_is_422(amend_client):
    event = make_event("OBJ-AMD-4")
    post = make_post(event.object)
    version = make_approved_version(event)
    version.is_current = False
    version.save(update_fields=["is_current"])

    resp = amend_client.post(
        amend_url(version),
        {
            "reason": "x",
            "sanction": "y",
            "assignments": [{"employee_id": str(uuid.uuid4()), "post": post.pk}],
        },
        format="json",
    )

    assert resp.status_code == 422


def test_amend_nonexistent_version_is_404(amend_client):
    resp = amend_client.post(
        reverse("ops-assignment-version-amend", args=[999999]),
        {"reason": "x", "sanction": "y", "assignments": []},
        format="json",
    )
    assert resp.status_code == 404


def test_replace_departed_success(amend_client):
    division = make_division("DIV-AMD-1")
    departed = make_employee(division, "900101400001")
    candidate = make_employee(division, "900101400002")
    event = make_event("OBJ-REPL-1")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    resp = amend_client.post(
        replace_url(version),
        {
            "departed_employee_id": str(departed.id),
            "reason": "Выбыл",
            "sanction": "Приказ №9",
        },
        format="json",
    )

    assert resp.status_code == 201
    row = resp.data["assignments"][0]
    assert row["employee_id"] == str(candidate.id)


def test_replace_departed_no_candidate_is_409(amend_client):
    division = make_division("DIV-AMD-2")
    departed = make_employee(division, "900101400003")
    event = make_event("OBJ-REPL-2")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    resp = amend_client.post(
        replace_url(version),
        {
            "departed_employee_id": str(departed.id),
            "reason": "Выбыл",
            "sanction": "Приказ №9",
        },
        format="json",
    )

    assert resp.status_code == 409


def test_replace_departed_manual_replacement_round_trips(amend_client):
    division = make_division("DIV-AMD-3")
    departed = make_employee(division, "900101400004")
    auto_candidate = make_employee(division, "900101400005")
    manual_candidate = make_employee(division, "900101400006")
    event = make_event("OBJ-REPL-3")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    resp = amend_client.post(
        replace_url(version),
        {
            "departed_employee_id": str(departed.id),
            "reason": "Выбыл",
            "sanction": "Приказ №9",
            "manual_replacement_employee_id": str(manual_candidate.id),
        },
        format="json",
    )

    assert resp.status_code == 201
    row = resp.data["assignments"][0]
    assert row["employee_id"] == str(manual_candidate.id)
    assert row["employee_id"] != str(auto_candidate.id)


def test_replace_departed_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-REPL-4")
    version = make_approved_version(event)

    resp = no_permission_client.post(
        replace_url(version),
        {"departed_employee_id": str(uuid.uuid4()), "reason": "x", "sanction": "y"},
        format="json",
    )

    assert resp.status_code == 403
