"""Story 16.5 — `project_placement_assignment()` / `EVENT_ASSIGNMENT`
projection on `approve_assignment_version()`'s real SUBMITTED->APPROVED
transition, extending Story 16.4's workflow."""

import datetime
import uuid

import pytest
from django.utils import timezone

from apps.operations.duties.services import _to_date_range
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import (
    approve_assignment_version,
    project_placement_assignment,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


def make_event(code, starts_at=None, ends_at=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", starts_at=starts_at, ends_at=ends_at
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


def test_approve_projects_event_assignment_status(db):
    """Review finding (Blind Hunter, live-confirmed): the naive assertion
    `status.date_start == now.date()` compares a UTC calendar date
    (`timezone.now()` is UTC-aware) against `_to_date_range()`'s
    LOCAL-timezone conversion (`TIME_ZONE = "Asia/Qyzylorda"`, UTC+5,
    `config/settings.py`) — the two dates DIVERGE whenever the test runs
    between 19:00-23:59 UTC (00:00-04:59 local), a real, reproducible
    flake window, not a hypothetical one. Asserting against
    `_to_date_range()`'s own output instead is correct at any run time."""
    now = timezone.now()
    event = make_event(
        "OBJ-PROJ-1", now, now + datetime.timedelta(hours=8)
    )
    employee_id = uuid.uuid4()
    version, assignment = make_draft_version(event, employee_id)
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    status = EmployeeStatus.objects.get(source_ref=f"EVENT_ASSIGNMENT:{assignment.pk}")
    expected_start, expected_end = _to_date_range(event.starts_at, event.ends_at)
    assert status.employee_id == employee_id
    assert status.status_type_code == "EVENT_ASSIGNMENT"
    assert status.source == EmployeeStatus.Source.OM_AUTO
    assert status.date_start == expected_start
    assert status.date_end == expected_end


def test_projection_idempotent_by_source_ref(db):
    now = timezone.now()
    event = make_event("OBJ-PROJ-2", now, now + datetime.timedelta(hours=8))
    version, assignment = make_draft_version(event)

    project_placement_assignment(assignment, event)
    project_placement_assignment(assignment, event)

    assert (
        EmployeeStatus.objects.filter(
            source_ref=f"EVENT_ASSIGNMENT:{assignment.pk}"
        ).count()
        == 1
    )


def test_no_schedule_skips_projection_but_approve_still_succeeds(db):
    event = make_event("OBJ-PROJ-3")  # no starts_at/ends_at
    version, assignment = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    result = approve_assignment_version(version, actor="approver-1")

    result.refresh_from_db()
    assert result.status == "APPROVED"
    assert not EmployeeStatus.objects.filter(
        source_ref=f"EVENT_ASSIGNMENT:{assignment.pk}"
    ).exists()


def test_idempotent_replay_approve_does_not_duplicate_projection(db):
    now = timezone.now()
    event = make_event("OBJ-PROJ-4", now, now + datetime.timedelta(hours=8))
    employee_id = uuid.uuid4()
    version, assignment = make_draft_version(event, employee_id)
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")

    approve_assignment_version(version, actor="approver-1")

    assert (
        EmployeeStatus.objects.filter(
            source_ref=f"EVENT_ASSIGNMENT:{assignment.pk}"
        ).count()
        == 1
    )


def test_overlapping_event_assignment_rows_do_not_violate_db_constraint(db):
    """AC-5: EVENT_ASSIGNMENT is SOFT — not in HARD_BLOCK_CODES, so two
    overlapping rows for the same employee across two events never hit
    `excl_hard_status_overlap` at the DB level. The overlap DOES trip
    16.3b's DOUBLE_ASSIGNMENT_CONFLICT soft-conflict gate (a separate,
    higher-level concern) — override=True clears that gate so the second
    approve, and its projection, actually run."""
    now = timezone.now()
    employee_id = uuid.uuid4()

    event_a = make_event("OBJ-PROJ-5A", now, now + datetime.timedelta(hours=8))
    version_a, assignment_a = make_draft_version(event_a, employee_id, "POST-A")
    submit_assignment_version(version_a, actor="planner-1")
    approve_assignment_version(version_a, actor="approver-1")

    event_b = make_event(
        "OBJ-PROJ-5B",
        now + datetime.timedelta(hours=2),
        now + datetime.timedelta(hours=10),
    )
    version_b, assignment_b = make_draft_version(event_b, employee_id, "POST-B")
    submit_assignment_version(version_b, actor="planner-1")
    result_b = approve_assignment_version(
        version_b, actor="approver-1", override=True, override_reason="Проверено"
    )

    assert result_b.status == "APPROVED"
    assert EmployeeStatus.objects.filter(
        source_ref=f"EVENT_ASSIGNMENT:{assignment_a.pk}"
    ).exists()
    assert EmployeeStatus.objects.filter(
        source_ref=f"EVENT_ASSIGNMENT:{assignment_b.pk}"
    ).exists()


def test_multiple_assignments_project_one_row_each(db):
    now = timezone.now()
    event = make_event("OBJ-PROJ-6", now, now + datetime.timedelta(hours=8))
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post_a = Post.objects.create(object=event.object, code="POST-A", name="A")
    post_b = Post.objects.create(object=event.object, code="POST-B", name="B")
    employee_a = uuid.uuid4()
    employee_b = uuid.uuid4()
    assignment_a = PlacementAssignment.objects.create(
        version=version, employee_id=employee_a, post=post_a
    )
    assignment_b = PlacementAssignment.objects.create(
        version=version, employee_id=employee_b, post=post_b
    )
    submit_assignment_version(version, actor="planner-1")

    approve_assignment_version(version, actor="approver-1")

    status_a = EmployeeStatus.objects.get(
        source_ref=f"EVENT_ASSIGNMENT:{assignment_a.pk}"
    )
    status_b = EmployeeStatus.objects.get(
        source_ref=f"EVENT_ASSIGNMENT:{assignment_b.pk}"
    )
    assert status_a.employee_id == employee_a
    assert status_b.employee_id == employee_b
