"""Story 15.9 — физнаряд (direct assignment) behavioral tests: create,
list, delete, NO double-assignment blocking ("система пассивна"),
permission, 404, audit."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventDirectAssignment,
    SecurityEventSectorPost,
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
    role = Role.objects.create(code="TEST_EVENT_MANAGER_DIRECT", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="omd-operator", role_code=role)
    return _client("omd-operator")


def make_event_and_post(code="OBJ-DIRECT-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    post = SecurityEventSectorPost.objects.create(
        event=event, sector="A", post="Пост 1"
    )
    return event, post


def list_create_url(event):
    return reverse("ops-security-event-direct-assignments", args=[event.pk])


def detail_url(assignment):
    return reverse("ops-direct-assignment-detail", args=[assignment.pk])


def test_create_direct_assignment(event_manager_client):
    event, post = make_event_and_post()
    employee_id = str(uuid.uuid4())
    resp = event_manager_client.post(
        list_create_url(event),
        {"sector_post": post.pk, "employee_id": employee_id},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["employee_id"] == employee_id
    assert SecurityEventDirectAssignment.objects.filter(event=event).count() == 1


def test_create_rejects_sector_post_from_different_event(event_manager_client):
    event, _post = make_event_and_post("OBJ-DIRECT-2")
    other_event, other_post = make_event_and_post("OBJ-DIRECT-3")
    resp = event_manager_client.post(
        list_create_url(event),
        {"sector_post": other_post.pk, "employee_id": str(uuid.uuid4())},
        format="json",
    )
    assert resp.status_code == 400


def test_no_double_assignment_blocking_system_is_passive(event_manager_client):
    # AC-3: система пассивна — тот же employee_id можно назначить дважды.
    event, post = make_event_and_post("OBJ-DIRECT-4")
    employee_id = str(uuid.uuid4())
    first = event_manager_client.post(
        list_create_url(event),
        {"sector_post": post.pk, "employee_id": employee_id},
        format="json",
    )
    second = event_manager_client.post(
        list_create_url(event),
        {"sector_post": post.pk, "employee_id": employee_id},
        format="json",
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert (
        SecurityEventDirectAssignment.objects.filter(
            event=event, employee_id=employee_id
        ).count()
        == 2
    )


def test_list_direct_assignments(event_manager_client):
    event, post = make_event_and_post("OBJ-DIRECT-5")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=post, employee_id=uuid.uuid4()
    )
    resp = event_manager_client.get(list_create_url(event))
    assert resp.status_code == 200
    assert len(resp.data) == 1


def test_delete_direct_assignment(event_manager_client):
    event, post = make_event_and_post("OBJ-DIRECT-6")
    assignment = SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=post, employee_id=uuid.uuid4()
    )
    resp = event_manager_client.delete(detail_url(assignment))
    assert resp.status_code == 204
    assert not SecurityEventDirectAssignment.objects.filter(pk=assignment.pk).exists()


def test_create_without_permission_is_403(seeded):
    event, post = make_event_and_post("OBJ-DIRECT-7")
    resp = _client("nobody").post(
        list_create_url(event),
        {"sector_post": post.pk, "employee_id": str(uuid.uuid4())},
        format="json",
    )
    assert resp.status_code == 403


def test_create_with_non_numeric_event_id_is_404(event_manager_client):
    resp = event_manager_client.post(
        reverse("ops-security-event-direct-assignments", args=["not-a-number"]),
        {"employee_id": str(uuid.uuid4())},
        format="json",
    )
    assert resp.status_code == 404


def test_delete_with_non_numeric_id_is_404(event_manager_client):
    resp = event_manager_client.delete(
        reverse("ops-direct-assignment-detail", args=["not-a-number"])
    )
    assert resp.status_code == 404


def test_create_emits_audited_row(event_manager_client):
    event, post = make_event_and_post("OBJ-DIRECT-8")
    employee_id = str(uuid.uuid4())
    event_manager_client.post(
        list_create_url(event),
        {"sector_post": post.pk, "employee_id": employee_id},
        format="json",
    )
    log = AuditLog.objects.get(action="SECURITY_EVENT_DIRECT_ASSIGNMENT_CREATED")
    assert log.actor_user_id == "omd-operator"
    assert log.new_value["employee_id"] == employee_id


def test_delete_emits_audited_row(event_manager_client):
    event, post = make_event_and_post("OBJ-DIRECT-9")
    assignment = SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=post, employee_id=uuid.uuid4()
    )
    event_manager_client.delete(detail_url(assignment))
    log = AuditLog.objects.get(action="SECURITY_EVENT_DIRECT_ASSIGNMENT_DELETED")
    assert log.actor_user_id == "omd-operator"
