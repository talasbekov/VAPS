"""Story 16.6b (FR-27) — `acknowledge_placement_assignment()`: marks
`PlacementAssignment.acknowledged_at`, only for an APPROVED version,
idempotent (first ack wins)."""

import uuid

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import (
    acknowledge_placement_assignment,
    approve_assignment_version,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-ACK-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_draft_version(event, employee_id=None, post_code="POST-1"):
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=employee_id or uuid.uuid4(), post=post
    )
    return version, assignment


def make_approved_assignment(code="OBJ-ACK-1", post_code="POST-1"):
    event = make_event(code)
    version, assignment = make_draft_version(event, post_code=post_code)
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")
    assignment.refresh_from_db()
    return assignment


def test_first_acknowledge_sets_timestamp():
    assignment = make_approved_assignment("OBJ-ACK-2")

    result = acknowledge_placement_assignment(assignment, actor="employee-1")

    assert result.acknowledged_at is not None
    assert AuditLog.objects.filter(
        action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED"
    ).count() == 1


def test_replay_acknowledge_keeps_first_timestamp():
    assignment = make_approved_assignment("OBJ-ACK-3")
    first = acknowledge_placement_assignment(assignment, actor="employee-1")
    first_ts = first.acknowledged_at

    second = acknowledge_placement_assignment(assignment, actor="employee-1")

    assert second.acknowledged_at == first_ts
    assert AuditLog.objects.filter(
        action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED"
    ).count() == 1


def test_non_approved_version_is_rejected():
    event = make_event("OBJ-ACK-4")
    version, assignment = make_draft_version(event)  # still DRAFT

    with pytest.raises(DomainError) as exc_info:
        acknowledge_placement_assignment(assignment, actor="employee-1")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"

    assignment.refresh_from_db()
    assert assignment.acknowledged_at is None


def test_submitted_version_is_rejected():
    event = make_event("OBJ-ACK-5")
    version, assignment = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    with pytest.raises(DomainError) as exc_info:
        acknowledge_placement_assignment(assignment, actor="employee-1")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_blank_actor_is_rejected():
    assignment = make_approved_assignment("OBJ-ACK-6")

    with pytest.raises(DomainError) as exc_info:
        acknowledge_placement_assignment(assignment, actor="")
    assert exc_info.value.code == "VALIDATION_ERROR"

    assignment.refresh_from_db()
    assert assignment.acknowledged_at is None


def test_any_actor_can_acknowledge_identity_not_checked():
    """AC-7: this story deliberately does NOT verify actor == assigned
    employee — that's 16.8's territory. A different actor than the
    assigned employee succeeds, documenting this as intentional."""
    assignment = make_approved_assignment("OBJ-ACK-7")

    result = acknowledge_placement_assignment(assignment, actor="someone-else")

    assert result.acknowledged_at is not None
