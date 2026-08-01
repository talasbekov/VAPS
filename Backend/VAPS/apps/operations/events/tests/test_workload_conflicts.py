"""Story 16.3d (FR-25) — `WORKLOAD_EXCEEDED_CONFLICT` (BR-006): 3-consecutive
-day overload, extending `detect_placement_conflicts()` (16.3b/16.3c) in the
SAME pass."""

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

pytestmark = pytest.mark.django_db


def make_event(code, starts_at=None, ends_at=None):
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


def _midnight(day):
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time.min))


def test_single_overloaded_day_is_not_enough(db):
    """AC-1: only the middle day (D) crosses 8h — the other two days of the
    3-day window are quiet, so no conflict."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()
    event = make_event(
        "OBJ-WL-1", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    version, assignment = make_version_with_assignment(event, employee_id)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "WORKLOAD_EXCEEDED_CONFLICT" not in assignment.conflict_codes


def test_three_consecutive_overloaded_days_is_conflict(db):
    """AC-2: D-1, D, D+1 all exceed 8h via other current assignments plus
    this one's own event hours on D."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    other_day_minus_1 = make_event(
        "OBJ-WL-2A",
        _midnight(d0 - datetime.timedelta(days=1)),
        _midnight(d0 - datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_minus_1, employee_id, post_code="POST-A")

    other_day_plus_1 = make_event(
        "OBJ-WL-2B",
        _midnight(d0 + datetime.timedelta(days=1)),
        _midnight(d0 + datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_plus_1, employee_id, post_code="POST-B")

    event = make_event(
        "OBJ-WL-2C", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    version, assignment = make_version_with_assignment(
        event, employee_id, post_code="POST-C"
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "WORKLOAD_EXCEEDED_CONFLICT" in assignment.conflict_codes
    assert assignment.conflict_severity == "SOFT"


def test_exactly_eight_hours_is_not_overload(db):
    """AC-3: threshold is strictly > 8.0, not >=. Three consecutive days
    each carry exactly one 8h event for the employee — no day exceeds the
    threshold, so the run never qualifies as overloaded."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    checked_version = None
    checked_assignment = None
    for offset, code in ((-1, "POST-A"), (0, "POST-B"), (1, "POST-C")):
        day = d0 + datetime.timedelta(days=offset)
        ev = make_event(
            f"OBJ-WL-3-{offset}",
            _midnight(day),
            _midnight(day) + datetime.timedelta(hours=8),
        )
        version, assignment = make_version_with_assignment(
            ev, employee_id, post_code=code
        )
        if offset == 0:
            checked_version, checked_assignment = version, assignment

    detect_placement_conflicts(checked_version)

    checked_assignment.refresh_from_db()
    assert "WORKLOAD_EXCEEDED_CONFLICT" not in checked_assignment.conflict_codes


def test_missing_schedule_skips_workload_check(db):
    """AC-4: no schedule on the assignment's own event — skipped entirely,
    same as double-assignment/rest-violation."""
    employee_id = uuid.uuid4()
    event = make_event("OBJ-WL-4")  # no starts_at/ends_at
    version, assignment = make_version_with_assignment(event, employee_id)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_other_event_without_schedule_excluded_from_sum(db):
    """AC-5: an other current assignment referencing a schedule-less event
    contributes nothing (excluded, not treated as 0h implying safety)."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    unscheduled_other = make_event("OBJ-WL-5A")  # no schedule
    make_version_with_assignment(unscheduled_other, employee_id, post_code="POST-A")

    event = make_event(
        "OBJ-WL-5B", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    version, assignment = make_version_with_assignment(
        event, employee_id, post_code="POST-B"
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "WORKLOAD_EXCEEDED_CONFLICT" not in assignment.conflict_codes


def test_multiday_event_counts_full_hours_on_every_touched_day(db):
    """AC-6: a 2-day event's full duration counts toward BOTH days it
    spans, not split proportionally."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    other_day_minus_1 = make_event(
        "OBJ-WL-6A",
        _midnight(d0 - datetime.timedelta(days=1)),
        _midnight(d0 - datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_minus_1, employee_id, post_code="POST-A")

    other_day_plus_1 = make_event(
        "OBJ-WL-6B",
        _midnight(d0 + datetime.timedelta(days=2)),
        _midnight(d0 + datetime.timedelta(days=2)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_plus_1, employee_id, post_code="POST-B")

    # Spans D and D+1 (2 calendar days), 9h total — counts as 9h on EACH.
    multiday_event = make_event(
        "OBJ-WL-6C",
        _midnight(d0),
        _midnight(d0 + datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    version, assignment = make_version_with_assignment(
        multiday_event, employee_id, post_code="POST-C"
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "WORKLOAD_EXCEEDED_CONFLICT" in assignment.conflict_codes


def test_same_version_duplicate_never_enters_other_events(db):
    """The scanned version's OWN intra-version duplicate rows (the 16.3b
    double-assignment scenario) never reach `other_current_assignments` at
    all — `.exclude(version_id=version.pk)` drops the whole current version,
    both rows. Hours counted once per row's own event, not per duplicate
    row."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()
    event = make_event(
        "OBJ-WL-7", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    post_a = Post.objects.create(object=event.object, code="POST-A", name="A")
    post_b = Post.objects.create(object=event.object, code="POST-B", name="B")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assignment_a = PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post_a
    )
    PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post_b
    )

    detect_placement_conflicts(version)

    assignment_a.refresh_from_db()
    # 9h on D only (single event) — D-1/D+1 are quiet, so no conflict
    # despite the duplicate row.
    assert "WORKLOAD_EXCEEDED_CONFLICT" not in assignment_a.conflict_codes
    assert "DOUBLE_ASSIGNMENT_CONFLICT" in assignment_a.conflict_codes


def test_other_versions_duplicate_rows_for_same_event_not_double_counted(db):
    """AC-7 (real red probe, review finding — Acceptance Auditor): an OTHER
    current version can itself carry an intra-version duplicate (same
    employee assigned to 2 posts of its own event) — THAT is the scenario
    `other_events`'s dedup-by-event-pk in `_workload_conflicts()` actually
    guards against, unlike a duplicate within the version being scanned
    (which never reaches `other_current_assignments` at all,
    `.exclude(version_id=...)`). Without the dedup, the other event's 5h
    would count twice (10h, > 8.0) on D-1; with it, once (5h, <= 8.0) — the
    difference between conflict and no conflict."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    # Other CURRENT version, own event on D-1, 5h — duplicated employee
    # across 2 posts of THAT version (its own intra-version duplicate).
    other_event = make_event(
        "OBJ-WL-9A",
        _midnight(d0 - datetime.timedelta(days=1)),
        _midnight(d0 - datetime.timedelta(days=1)) + datetime.timedelta(hours=5),
    )
    other_post_a = Post.objects.create(object=other_event.object, code="OP-A", name="A")
    other_post_b = Post.objects.create(object=other_event.object, code="OP-B", name="B")
    other_version = AssignmentVersion.objects.create(
        event=other_event, status=AssignmentVersion.Status.DRAFT
    )
    PlacementAssignment.objects.create(
        version=other_version, employee_id=employee_id, post=other_post_a
    )
    PlacementAssignment.objects.create(
        version=other_version, employee_id=employee_id, post=other_post_b
    )

    # D and D+1 both independently exceed 8h so only D-1's total decides
    # the outcome.
    other_day = make_event(
        "OBJ-WL-9B",
        _midnight(d0 + datetime.timedelta(days=1)),
        _midnight(d0 + datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day, employee_id, post_code="POST-D1")

    event = make_event(
        "OBJ-WL-9C", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    version, assignment = make_version_with_assignment(
        event, employee_id, post_code="POST-D0"
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    # D-1 total is 5h (deduped), <= 8.0 — not all 3 days overloaded.
    assert "WORKLOAD_EXCEEDED_CONFLICT" not in assignment.conflict_codes


def test_workload_conflict_accumulates_with_other_conflict_types(db):
    """AC-9: WORKLOAD_EXCEEDED_CONFLICT coexists with other conflict
    categories on the same row, all written in one pass."""
    employee_id = uuid.uuid4()
    d0 = timezone.now().date()

    other_day_minus_1 = make_event(
        "OBJ-WL-8A",
        _midnight(d0 - datetime.timedelta(days=1)),
        _midnight(d0 - datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_minus_1, employee_id, post_code="POST-A")

    other_day_plus_1 = make_event(
        "OBJ-WL-8B",
        _midnight(d0 + datetime.timedelta(days=1)),
        _midnight(d0 + datetime.timedelta(days=1)) + datetime.timedelta(hours=9),
    )
    make_version_with_assignment(other_day_plus_1, employee_id, post_code="POST-B")

    # Overlapping same-day event on D from ANOTHER current version — also
    # triggers DOUBLE_ASSIGNMENT_CONFLICT.
    overlapping_event = make_event(
        "OBJ-WL-8C",
        _midnight(d0) + datetime.timedelta(hours=1),
        _midnight(d0) + datetime.timedelta(hours=5),
    )
    make_version_with_assignment(overlapping_event, employee_id, post_code="POST-C")

    event = make_event(
        "OBJ-WL-8D", _midnight(d0), _midnight(d0) + datetime.timedelta(hours=9)
    )
    version, assignment = make_version_with_assignment(
        event, employee_id, post_code="POST-D"
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert set(assignment.conflict_codes) == {
        "DOUBLE_ASSIGNMENT_CONFLICT",
        "WORKLOAD_EXCEEDED_CONFLICT",
    }
    assert assignment.conflict_severity == "SOFT"
