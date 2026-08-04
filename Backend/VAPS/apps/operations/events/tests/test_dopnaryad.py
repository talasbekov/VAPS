"""Story 17.4 (FR-28) — допнаряд: PlacementAssignment.is_unplanned +
source_division_id/source_duty_shift_id, wired through
amend_assignment_version() (17.3)."""

import uuid

from django.db import IntegrityError

import pytest

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import amend_assignment_version
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.core.exceptions import DomainError

pytestmark = pytest.mark.django_db


def make_event(code):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", status_code=SecurityEvent.StatusCode.IN_PROGRESS
    )


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def make_approved_version(event, version=1):
    return AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.APPROVED, version=version
    )


def test_amend_marks_unplanned_with_division_source():
    event = make_event("OBJ-DOP-1")
    old = make_approved_version(event)
    post = make_post(event.object)
    division_id = uuid.uuid4()

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="Допнаряд",
        sanction="Приказ",
        assignments=[
            {
                "employee_id": uuid.uuid4(),
                "post": post,
                "is_unplanned": True,
                "source_division_id": division_id,
            }
        ],
    )

    row = new_version.assignments.get()
    assert row.is_unplanned is True
    assert row.source_division_id == division_id
    assert row.source_duty_shift_id is None


def test_amend_marks_unplanned_with_duty_shift_source():
    event = make_event("OBJ-DOP-2")
    old = make_approved_version(event)
    post = make_post(event.object)

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="Допнаряд",
        sanction="Приказ",
        assignments=[
            {
                "employee_id": uuid.uuid4(),
                "post": post,
                "is_unplanned": True,
                "source_duty_shift_id": 42,
            }
        ],
    )

    row = new_version.assignments.get()
    assert row.is_unplanned is True
    assert row.source_duty_shift_id == 42
    assert row.source_division_id is None


def test_amend_rejects_unplanned_without_any_source():
    event = make_event("OBJ-DOP-3")
    old = make_approved_version(event)
    post = make_post(event.object)

    with pytest.raises(DomainError):
        amend_assignment_version(
            old,
            actor="staff-1",
            reason="x",
            sanction="y",
            assignments=[
                {"employee_id": uuid.uuid4(), "post": post, "is_unplanned": True}
            ],
        )

    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_amend_without_unplanned_key_defaults_to_planned():
    """AC-4: backward compatibility with 17.3's plain dicts."""
    event = make_event("OBJ-DOP-4")
    old = make_approved_version(event)
    post = make_post(event.object)

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": uuid.uuid4(), "post": post}],
    )

    row = new_version.assignments.get()
    assert row.is_unplanned is False
    assert row.source_division_id is None
    assert row.source_duty_shift_id is None


def test_amend_mixed_planned_and_unplanned_rows_independent():
    event = make_event("OBJ-DOP-5")
    old = make_approved_version(event)
    post = make_post(event.object)
    division_id = uuid.uuid4()

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[
            {"employee_id": uuid.uuid4(), "post": post},
            {
                "employee_id": uuid.uuid4(),
                "post": post,
                "is_unplanned": True,
                "source_division_id": division_id,
            },
        ],
    )

    rows = list(new_version.assignments.order_by("id"))
    assert rows[0].is_unplanned is False
    assert rows[1].is_unplanned is True
    assert rows[1].source_division_id == division_id


def test_db_constraint_rejects_unplanned_without_source():
    event = make_event("OBJ-DOP-6")
    version = make_approved_version(event)
    post = make_post(event.object)

    with pytest.raises(IntegrityError):
        PlacementAssignment.objects.create(
            version=version, employee_id=uuid.uuid4(), post=post, is_unplanned=True
        )


def test_db_constraint_rejects_planned_with_source():
    event = make_event("OBJ-DOP-7")
    version = make_approved_version(event)
    post = make_post(event.object)

    with pytest.raises(IntegrityError):
        PlacementAssignment.objects.create(
            version=version,
            employee_id=uuid.uuid4(),
            post=post,
            is_unplanned=False,
            source_division_id=uuid.uuid4(),
        )


def test_db_constraint_allows_unplanned_with_both_sources():
    """Both sources filled is allowed (FR-28's "/" means at-least-one, not
    exactly-one)."""
    event = make_event("OBJ-DOP-8")
    version = make_approved_version(event)
    post = make_post(event.object)

    PlacementAssignment.objects.create(
        version=version,
        employee_id=uuid.uuid4(),
        post=post,
        is_unplanned=True,
        source_division_id=uuid.uuid4(),
        source_duty_shift_id=7,
    )
