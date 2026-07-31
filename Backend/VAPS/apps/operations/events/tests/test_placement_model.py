"""Story 16.1 — `AssignmentVersion`/`PlacementAssignment`: model+migration
invariant proofs (versioning per DailySubmission's pattern, DB-level
CheckConstraints proven via bulk update() which bypasses full_clean())."""

import uuid

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-PLACEMENT-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_post(event, code="POST-1"):
    return Post.objects.create(object=event.object, code=code, name="Пост №1")


def test_create_draft_version_is_current_by_default():
    event = make_event()
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assert version.version == 1
    assert version.is_current is True


def test_only_one_current_version_per_event():
    event = make_event("OBJ-PLACEMENT-2")
    AssignmentVersion.objects.create(event=event, status=AssignmentVersion.Status.DRAFT)
    with pytest.raises(IntegrityError), transaction.atomic():
        AssignmentVersion.objects.create(
            event=event, status=AssignmentVersion.Status.DRAFT, version=2
        )


def test_second_version_allowed_when_first_is_not_current():
    event = make_event("OBJ-PLACEMENT-3")
    first = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.RETURNED
    )
    AssignmentVersion.objects.filter(pk=first.pk).update(is_current=False)
    second = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT, version=2
    )
    assert second.version == 2


def test_version_numbers_unique_per_event():
    event = make_event("OBJ-PLACEMENT-4")
    first = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    AssignmentVersion.objects.filter(pk=first.pk).update(is_current=False)
    with pytest.raises(IntegrityError), transaction.atomic():
        AssignmentVersion.objects.create(
            event=event, status=AssignmentVersion.Status.DRAFT, version=1
        )


def test_status_check_constraint_rejects_invalid_value():
    event = make_event("OBJ-PLACEMENT-5")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        AssignmentVersion.objects.filter(pk=version.pk).update(status="NOT_A_STATUS")


def test_version_min_check_constraint_rejects_zero():
    event = make_event("OBJ-PLACEMENT-6")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        AssignmentVersion.objects.filter(pk=version.pk).update(version=0)


def test_placement_assignment_creates_with_blank_conflict_severity():
    event = make_event("OBJ-PLACEMENT-7")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = make_post(event)

    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    assert assignment.acknowledged_at is None
    assert assignment.conflict_severity == ""


def test_placement_assignment_conflict_severity_check_constraint():
    event = make_event("OBJ-PLACEMENT-8")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = make_post(event)

    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        PlacementAssignment.objects.filter(pk=assignment.pk).update(
            conflict_severity="INVALID"
        )


def test_post_protected_from_deletion_when_referenced():
    event = make_event("OBJ-PLACEMENT-9")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = make_post(event)

    PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):
        post.delete()


def test_version_cascade_deletes_its_assignments():
    event = make_event("OBJ-PLACEMENT-10")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = make_post(event)

    PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    version.delete()
    assert PlacementAssignment.objects.count() == 0


def test_clean_rejects_post_from_a_different_object():
    """Review finding (Blind Hunter/Edge Case Hunter): a Post belonging to
    a DIFFERENT Object than the AssignmentVersion's event must be rejected
    by full_clean() — same cross-FK guard class as Post.clean()/
    ChecklistOverride.clean()/DutyShift.clean(). `.objects.create()` alone
    does NOT call full_clean() (Django convention) — this proves the
    validation exists at the model level for a future service to invoke."""
    event = make_event("OBJ-PLACEMENT-11")
    other_obj = FacilityObject.objects.create(
        code="OBJ-PLACEMENT-11-OTHER", name="Другой штаб", address="г. Астана"
    )
    foreign_post = Post.objects.create(
        object=other_obj, code="FOREIGN-POST", name="Чужой пост"
    )
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assignment = PlacementAssignment(
        version=version, employee_id=uuid.uuid4(), post=foreign_post
    )
    with pytest.raises(ValidationError):
        assignment.full_clean()


def test_clean_accepts_post_from_the_same_object():
    event = make_event("OBJ-PLACEMENT-12")
    post = make_post(event, code="POST-12")
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assignment = PlacementAssignment(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    assignment.full_clean()  # must not raise
