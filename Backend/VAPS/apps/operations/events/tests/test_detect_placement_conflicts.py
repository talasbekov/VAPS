"""Story 16.3b (FR-25) — `detect_placement_conflicts()` behavioral tests:
double-assignment + rest-violation, both fixed-SOFT."""

import datetime
import uuid

import pytest
from django.utils import timezone

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import detect_placement_conflicts
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-CONFLICT-1", starts_at=None, ends_at=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", starts_at=starts_at, ends_at=ends_at
    )


def make_version_with_assignment(event, employee_id=None, post_code="POST-1"):
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=employee_id or uuid.uuid4(), post=post
    )
    return version, assignment


def test_no_conflicts_leaves_row_clean(db):
    now = timezone.now()
    event = make_event(starts_at=now, ends_at=now + datetime.timedelta(hours=8))
    version, assignment = make_version_with_assignment(event)

    touched = detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_severity == ""
    assert assignment.conflict_codes == []
    assert touched[0].pk == assignment.pk


def test_double_assignment_detected_across_overlapping_events(db):
    employee_id = uuid.uuid4()
    now = timezone.now()
    event_a = make_event("OBJ-CONFLICT-2A", now, now + datetime.timedelta(hours=8))
    event_b = make_event(
        "OBJ-CONFLICT-2B",
        now + datetime.timedelta(hours=4),
        now + datetime.timedelta(hours=12),
    )
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)
    version_b, assignment_b = make_version_with_assignment(event_b, employee_id)

    detect_placement_conflicts(version_a)
    detect_placement_conflicts(version_b)

    assignment_a.refresh_from_db()
    assignment_b.refresh_from_db()
    assert "DOUBLE_ASSIGNMENT_CONFLICT" in assignment_a.conflict_codes
    assert "DOUBLE_ASSIGNMENT_CONFLICT" in assignment_b.conflict_codes
    assert assignment_a.conflict_severity == "SOFT"


def test_non_overlapping_events_no_double_assignment_conflict(db):
    employee_id = uuid.uuid4()
    now = timezone.now()
    event_a = make_event("OBJ-CONFLICT-3A", now, now + datetime.timedelta(hours=8))
    event_b = make_event(
        "OBJ-CONFLICT-3B",
        now + datetime.timedelta(days=1),
        now + datetime.timedelta(days=1, hours=8),
    )
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)
    make_version_with_assignment(event_b, employee_id)

    detect_placement_conflicts(version_a)

    assignment_a.refresh_from_db()
    assert assignment_a.conflict_codes == []


def test_non_current_version_excluded_from_double_assignment_check(db):
    employee_id = uuid.uuid4()
    now = timezone.now()
    event_a = make_event("OBJ-CONFLICT-4A", now, now + datetime.timedelta(hours=8))
    event_b = make_event("OBJ-CONFLICT-4B", now, now + datetime.timedelta(hours=8))
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)
    version_b, _ = make_version_with_assignment(event_b, employee_id)
    AssignmentVersion.objects.filter(pk=version_b.pk).update(is_current=False)

    detect_placement_conflicts(version_a)

    assignment_a.refresh_from_db()
    assert assignment_a.conflict_codes == []


def test_missing_schedule_skips_double_assignment_check_not_false_positive(db):
    employee_id = uuid.uuid4()
    event_a = make_event("OBJ-CONFLICT-5A")  # no starts_at/ends_at
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)

    detect_placement_conflicts(version_a)

    assignment_a.refresh_from_db()
    assert assignment_a.conflict_codes == []
    assert assignment_a.conflict_severity == ""


def test_rest_violation_detected(db):
    now = timezone.now()
    event = make_event("OBJ-CONFLICT-6", now, now + datetime.timedelta(hours=8))
    version, assignment = make_version_with_assignment(event)
    EmployeeStatus.objects.create(
        employee_id=assignment.employee_id,
        status_type_code="REST_AFTER_DUTY",
        date_start=now.date(),
        date_end=now.date() + datetime.timedelta(days=1),
        source=EmployeeStatus.Source.OM_AUTO,
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "REST_VIOLATION_CONFLICT" in assignment.conflict_codes
    assert assignment.conflict_severity == "SOFT"


def test_cancelled_rest_status_does_not_conflict(db):
    now = timezone.now()
    event = make_event("OBJ-CONFLICT-7", now, now + datetime.timedelta(hours=8))
    version, assignment = make_version_with_assignment(event)
    EmployeeStatus.objects.create(
        employee_id=assignment.employee_id,
        status_type_code="REST_AFTER_DUTY",
        date_start=now.date(),
        date_end=now.date() + datetime.timedelta(days=1),
        source=EmployeeStatus.Source.OM_AUTO,
        cancelled_at=now,
        cancelled_by="admin",
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_both_conflicts_accumulate_on_same_row(db):
    employee_id = uuid.uuid4()
    now = timezone.now()
    event_a = make_event("OBJ-CONFLICT-8A", now, now + datetime.timedelta(hours=8))
    event_b = make_event(
        "OBJ-CONFLICT-8B",
        now + datetime.timedelta(hours=2),
        now + datetime.timedelta(hours=10),
    )
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)
    make_version_with_assignment(event_b, employee_id)
    EmployeeStatus.objects.create(
        employee_id=employee_id,
        status_type_code="REST_AFTER_DUTY",
        date_start=now.date(),
        date_end=now.date() + datetime.timedelta(days=1),
        source=EmployeeStatus.Source.OM_AUTO,
    )

    detect_placement_conflicts(version_a)

    assignment_a.refresh_from_db()
    assert set(assignment_a.conflict_codes) == {
        "DOUBLE_ASSIGNMENT_CONFLICT",
        "REST_VIOLATION_CONFLICT",
    }
    assert assignment_a.conflict_severity == "SOFT"


def test_resolved_conflict_is_cleared_on_recompute(db):
    employee_id = uuid.uuid4()
    now = timezone.now()
    event_a = make_event("OBJ-CONFLICT-9A", now, now + datetime.timedelta(hours=8))
    event_b = make_event("OBJ-CONFLICT-9B", now, now + datetime.timedelta(hours=8))
    version_a, assignment_a = make_version_with_assignment(event_a, employee_id)
    version_b, _ = make_version_with_assignment(event_b, employee_id)

    detect_placement_conflicts(version_a)
    assignment_a.refresh_from_db()
    assert assignment_a.conflict_codes == ["DOUBLE_ASSIGNMENT_CONFLICT"]

    AssignmentVersion.objects.filter(pk=version_b.pk).update(is_current=False)
    detect_placement_conflicts(version_a)

    assignment_a.refresh_from_db()
    assert assignment_a.conflict_codes == []
    assert assignment_a.conflict_severity == ""
