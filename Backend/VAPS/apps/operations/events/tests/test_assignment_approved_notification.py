"""Story 16.6a (FR-27) — `ASSIGNMENT_APPROVED` notification to assigned
employees + event senior, on `approve_assignment_version()`'s real
SUBMITTED->APPROVED transition."""

import uuid

import pytest

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
    UserEmployeeBinding,
)
from apps.notifications.models import Notification
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import (
    approve_assignment_version,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="AAN", code="AAN")
    dtp = DivisionType.objects.create(code="aan-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="AAN", code="AAN"
    )


def make_employee(division, iin):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )


def make_event(code, senior_employee_id=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", senior_employee_id=senior_employee_id
    )


def make_draft_version(event, employee_id=None, post_code="POST-1"):
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=employee_id or uuid.uuid4(), post=post
    )
    return version, assignment


def test_approve_notifies_assigned_employee(division):
    employee = make_employee(division, "900101300701")
    UserEmployeeBinding.objects.create(user_id="user-701", employee=employee)
    event = make_event("OBJ-NOTIFY-1")
    version, assignment = make_draft_version(event, employee.id)
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    notification = Notification.objects.get(
        recipient="user-701", kind=Notification.Kind.ASSIGNMENT_APPROVED
    )
    assert notification.payload["event_id"] == event.pk
    assert notification.payload["version_id"] == version.pk


def test_approve_notifies_event_senior(division):
    senior = make_employee(division, "900101300702")
    UserEmployeeBinding.objects.create(user_id="user-senior", employee=senior)
    event = make_event("OBJ-NOTIFY-2", senior_employee_id=senior.id)
    version, assignment = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    assert Notification.objects.filter(
        recipient="user-senior", kind=Notification.Kind.ASSIGNMENT_APPROVED
    ).exists()


def test_employee_without_binding_is_skipped_not_error(division):
    employee = make_employee(division, "900101300703")  # no UserEmployeeBinding
    event = make_event("OBJ-NOTIFY-3")
    version, assignment = make_draft_version(event, employee.id)
    submit_assignment_version(version, actor="planner-1")

    result = approve_assignment_version(version, actor="approver-1")

    assert result.status == "APPROVED"
    assert not Notification.objects.filter(
        kind=Notification.Kind.ASSIGNMENT_APPROVED
    ).exists()


def test_senior_not_set_skips_senior_notification(division):
    employee = make_employee(division, "900101300704")
    UserEmployeeBinding.objects.create(user_id="user-704", employee=employee)
    event = make_event("OBJ-NOTIFY-4")  # senior_employee_id is None
    version, assignment = make_draft_version(event, employee.id)
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    assert Notification.objects.filter(
        kind=Notification.Kind.ASSIGNMENT_APPROVED
    ).count() == 1
    assert Notification.objects.get(
        kind=Notification.Kind.ASSIGNMENT_APPROVED
    ).recipient == "user-704"


def test_senior_who_is_also_assigned_gets_one_notification(division):
    """Review coverage gap (Blind/Edge Case Hunter): the employee_ids set
    is built from BOTH assignments and event.senior_employee_id — if the
    same person is both a participant and the senior, the two dedup
    layers (employee_ids set, then set(user_ids.values())) must collapse
    to exactly one notify() call, not two."""
    employee = make_employee(division, "900101300707")
    UserEmployeeBinding.objects.create(user_id="user-707", employee=employee)
    event = make_event("OBJ-NOTIFY-7", senior_employee_id=employee.id)
    version, assignment = make_draft_version(event, employee.id)
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    assert (
        Notification.objects.filter(
            recipient="user-707", kind=Notification.Kind.ASSIGNMENT_APPROVED
        ).count()
        == 1
    )


def test_idempotent_replay_approve_does_not_duplicate_notification(division):
    employee = make_employee(division, "900101300705")
    UserEmployeeBinding.objects.create(user_id="user-705", employee=employee)
    event = make_event("OBJ-NOTIFY-5")
    version, assignment = make_draft_version(event, employee.id)
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")

    approve_assignment_version(version, actor="approver-1")

    assert (
        Notification.objects.filter(
            recipient="user-705", kind=Notification.Kind.ASSIGNMENT_APPROVED
        ).count()
        == 1
    )


def test_multiple_assignments_same_employee_yield_one_notification(division):
    employee = make_employee(division, "900101300706")
    UserEmployeeBinding.objects.create(user_id="user-706", employee=employee)
    event = make_event("OBJ-NOTIFY-6")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post_a = Post.objects.create(object=event.object, code="POST-A", name="A")
    post_b = Post.objects.create(object=event.object, code="POST-B", name="B")
    PlacementAssignment.objects.create(
        version=version, employee_id=employee.id, post=post_a
    )
    PlacementAssignment.objects.create(
        version=version, employee_id=employee.id, post=post_b
    )
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(
        version, actor="approver-1", override=True, override_reason="Проверено"
    )

    assert (
        Notification.objects.filter(
            recipient="user-706", kind=Notification.Kind.ASSIGNMENT_APPROVED
        ).count()
        == 1
    )
