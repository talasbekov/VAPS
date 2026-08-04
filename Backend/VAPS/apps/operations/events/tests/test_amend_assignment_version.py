"""Story 17.3 (FR-28) — amend_assignment_version(): post-approval
operational changes, sanction-gated, no approve sub-cycle."""

import uuid

from django.db import IntegrityError

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import AssignmentVersion, SecurityEvent
from apps.operations.events.services import amend_assignment_version
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def make_approved_version(event, version=1, is_current=True):
    return AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=version,
        is_current=is_current,
    )


def test_amend_creates_new_approved_current_version():
    event = make_event("OBJ-AMEND-1")
    old = make_approved_version(event)
    post = make_post(event.object)
    employee = uuid.uuid4()

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="Замена выбывшего",
        sanction="Приказ №1",
        assignments=[(employee, post)],
    )

    assert new_version.status == "APPROVED"
    assert new_version.version == 2
    assert new_version.is_current is True
    assert new_version.is_amendment is True
    assert new_version.reason == "Замена выбывшего"
    assert new_version.sanction == "Приказ №1"
    old.refresh_from_db()
    assert old.is_current is False
    assert new_version.assignments.count() == 1


@pytest.mark.parametrize("missing_field", ["reason", "sanction"])
def test_amend_rejects_blank_reason_or_sanction(missing_field):
    event = make_event("OBJ-AMEND-2")
    old = make_approved_version(event)
    post = make_post(event.object)
    kwargs = {"reason": "x", "sanction": "y"}
    kwargs[missing_field] = "   "

    with pytest.raises(DomainError):
        amend_assignment_version(
            old, actor="staff-1", assignments=[(uuid.uuid4(), post)], **kwargs
        )

    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_amend_rejects_non_current_version():
    event = make_event("OBJ-AMEND-3")
    old = make_approved_version(event, version=1, is_current=False)
    make_approved_version(event, version=2, is_current=True)
    post = make_post(event.object)

    with pytest.raises(DomainError):
        amend_assignment_version(
            old,
            actor="staff-1",
            reason="x",
            sanction="y",
            assignments=[(uuid.uuid4(), post)],
        )


def test_amend_rejects_non_approved_version():
    event = make_event("OBJ-AMEND-4")
    draft = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT, version=1, is_current=True
    )
    post = make_post(event.object)

    with pytest.raises(DomainError):
        amend_assignment_version(
            draft,
            actor="staff-1",
            reason="x",
            sanction="y",
            assignments=[(uuid.uuid4(), post)],
        )


@pytest.mark.parametrize(
    "status_code",
    [
        SecurityEvent.StatusCode.APPROVED,
        SecurityEvent.StatusCode.CLOSED,
        SecurityEvent.StatusCode.DRAFT,
    ],
)
def test_amend_rejected_when_event_not_in_progress(status_code):
    event = make_event("OBJ-AMEND-5", status_code=status_code)
    old = make_approved_version(event)
    post = make_post(event.object)

    with pytest.raises(DomainError):
        amend_assignment_version(
            old,
            actor="staff-1",
            reason="x",
            sanction="y",
            assignments=[(uuid.uuid4(), post)],
        )

    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_amend_does_not_block_on_conflicting_assignment():
    """AC-5: conflicts are recorded, not blocking — sanction is
    unconditional authorization."""
    event = make_event("OBJ-AMEND-6")
    old = make_approved_version(event)
    post = make_post(event.object)
    same_employee = uuid.uuid4()

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="x",
        sanction="y",
        # Duplicate assignment for the same post — a real conflict shape
        # per detect_placement_conflicts(), but must not block creation.
        assignments=[(same_employee, post), (same_employee, post)],
    )

    assert new_version.pk is not None
    assert new_version.assignments.count() == 2


def test_amend_rejects_post_from_a_different_object():
    event = make_event("OBJ-AMEND-7")
    old = make_approved_version(event)
    other_obj = FacilityObject.objects.create(
        code="OBJ-AMEND-7-OTHER", name="Штаб", address="г. Кызылорда"
    )
    foreign_post = make_post(other_obj, code="POST-FOREIGN")

    with pytest.raises(DomainError):
        amend_assignment_version(
            old,
            actor="staff-1",
            reason="x",
            sanction="y",
            assignments=[(uuid.uuid4(), foreign_post)],
        )

    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_amend_writes_audit_row():
    event = make_event("OBJ-AMEND-8")
    old = make_approved_version(event)
    post = make_post(event.object)

    new_version = amend_assignment_version(
        old,
        actor="staff-1",
        reason="Причина",
        sanction="Санкция",
        assignments=[(uuid.uuid4(), post)],
    )

    audit = AuditLog.objects.get(action="ASSIGNMENT_VERSION_AMENDED")
    assert audit.entity_type == "assignment_version"
    assert audit.new_value["new_version_id"] == new_version.pk
    assert audit.new_value["reason"] == "Причина"
    assert audit.new_value["sanction"] == "Санкция"
    assert audit.old_value["old_version_id"] == old.pk


def test_amend_requires_actor():
    event = make_event("OBJ-AMEND-9")
    old = make_approved_version(event)
    post = make_post(event.object)

    with pytest.raises(DomainError):
        amend_assignment_version(
            old, actor="", reason="x", sanction="y", assignments=[(uuid.uuid4(), post)]
        )


def test_db_constraint_rejects_amendment_without_reason_or_sanction():
    event = make_event("OBJ-AMEND-10")

    with pytest.raises(IntegrityError):
        AssignmentVersion.objects.create(
            event=event,
            status=AssignmentVersion.Status.APPROVED,
            version=1,
            is_amendment=True,
            reason="",
            sanction="",
        )


def test_db_constraint_rejects_non_amendment_with_reason_or_sanction():
    event = make_event("OBJ-AMEND-11")

    with pytest.raises(IntegrityError):
        AssignmentVersion.objects.create(
            event=event,
            status=AssignmentVersion.Status.APPROVED,
            version=1,
            is_amendment=False,
            reason="x",
            sanction="y",
        )
