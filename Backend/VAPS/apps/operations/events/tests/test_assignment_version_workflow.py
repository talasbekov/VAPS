"""Story 16.4 (FR-26) — `submit_assignment_version()`/`return_assignment_version()`/
`approve_assignment_version()` behavioral tests."""

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
    approve_assignment_version,
    return_assignment_version,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-WORKFLOW-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_draft_version(event, with_assignment=True, post_code="POST-1"):
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    if with_assignment:
        post = Post.objects.create(object=event.object, code=post_code, name="Пост")
        PlacementAssignment.objects.create(
            version=version, employee_id=uuid.uuid4(), post=post
        )
    return version


# --- submit ---


def test_submit_draft_transitions_to_submitted():
    event = make_event()
    version = make_draft_version(event)

    result = submit_assignment_version(version, actor="planner-1")

    assert result.status == "SUBMITTED"


def test_submit_replay_on_already_submitted_is_idempotent():
    event = make_event("OBJ-WORKFLOW-2")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    result = submit_assignment_version(version, actor="planner-1")

    assert result.status == "SUBMITTED"
    assert AuditLog.objects.filter(action="ASSIGNMENT_VERSION_SUBMITTED").count() == 1


def test_submit_from_non_draft_status_is_rejected():
    event = make_event("OBJ-WORKFLOW-3")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")

    with pytest.raises(DomainError) as exc_info:
        submit_assignment_version(version, actor="planner-1")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_submit_requires_actor():
    event = make_event("OBJ-WORKFLOW-4")
    version = make_draft_version(event)
    with pytest.raises(DomainError) as exc_info:
        submit_assignment_version(version, actor="")
    assert exc_info.value.code == "VALIDATION_ERROR"


# --- return ---


def test_return_creates_new_draft_version_with_copied_assignments():
    event = make_event("OBJ-WORKFLOW-5")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    returned, new_version = return_assignment_version(
        version, actor="approver-1", reason="Не хватает поста"
    )

    returned.refresh_from_db()
    assert returned.status == "RETURNED"
    assert returned.is_current is False
    assert new_version.status == "DRAFT"
    assert new_version.version == 2
    assert new_version.is_current is True
    assert new_version.assignments.count() == 1
    assert (
        new_version.assignments.first().employee_id
        == returned.assignments.first().employee_id
    )


def test_return_requires_non_blank_reason():
    event = make_event("OBJ-WORKFLOW-6")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    with pytest.raises(DomainError) as exc_info:
        return_assignment_version(version, actor="approver-1", reason="   ")
    assert exc_info.value.code == "VALIDATION_ERROR"


def test_return_from_non_submitted_status_is_rejected():
    event = make_event("OBJ-WORKFLOW-7")
    version = make_draft_version(event)

    with pytest.raises(DomainError) as exc_info:
        return_assignment_version(version, actor="approver-1", reason="почему-то")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_return_emits_audit_with_reason_and_new_version_id():
    event = make_event("OBJ-WORKFLOW-8")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    _, new_version = return_assignment_version(
        version, actor="approver-1", reason="Дважды назначен один пост"
    )

    log = AuditLog.objects.get(action="ASSIGNMENT_VERSION_RETURNED")
    assert log.new_value["reason"] == "Дважды назначен один пост"
    assert log.new_value["new_draft_version_id"] == new_version.pk


# --- approve ---


def test_approve_from_submitted_without_conflicts_succeeds():
    event = make_event("OBJ-WORKFLOW-9")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    result = approve_assignment_version(version, actor="approver-1")

    result.refresh_from_db()
    assert result.status == "APPROVED"
    assert len(result.signature_hash) == 64  # sha256 hex digest


def test_approve_replay_on_already_approved_is_idempotent():
    event = make_event("OBJ-WORKFLOW-10")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")
    first_hash = AssignmentVersion.objects.get(pk=version.pk).signature_hash

    approve_assignment_version(version, actor="approver-1")

    version.refresh_from_db()
    assert version.signature_hash == first_hash
    assert AuditLog.objects.filter(action="ASSIGNMENT_VERSION_APPROVED").count() == 1


def test_approve_from_draft_is_rejected():
    event = make_event("OBJ-WORKFLOW-11")
    version = make_draft_version(event)

    with pytest.raises(DomainError) as exc_info:
        approve_assignment_version(version, actor="approver-1")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"


def make_conflicting_version(event, post_code):
    """Two PlacementAssignment rows, same employee, in one version —
    triggers 16.3b's intra-version DOUBLE_ASSIGNMENT_CONFLICT check."""
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    employee_id = uuid.uuid4()
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post
    )
    PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post
    )
    return version


def test_approve_with_conflicts_without_override_is_rejected():
    event = make_event("OBJ-WORKFLOW-12")
    version = make_conflicting_version(event, "POST-DUP")
    submit_assignment_version(version, actor="planner-1")

    with pytest.raises(DomainError) as exc_info:
        approve_assignment_version(version, actor="approver-1")
    assert exc_info.value.code == "SOFT_CONFLICT_DETECTED"
    assert exc_info.value.http_status == 409


def test_approve_with_conflicts_and_override_succeeds():
    event = make_event("OBJ-WORKFLOW-13")
    version = make_conflicting_version(event, "POST-DUP2")
    submit_assignment_version(version, actor="planner-1")

    result = approve_assignment_version(
        version, actor="approver-1", override=True, override_reason="Проверено вручную"
    )

    assert result.status == "APPROVED"
    log = AuditLog.objects.get(action="ASSIGNMENT_VERSION_APPROVED")
    assert log.new_value["override"] is True
    assert log.new_value["override_reason"] == "Проверено вручную"


def test_approve_override_true_requires_non_blank_reason():
    event = make_event("OBJ-WORKFLOW-14")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    with pytest.raises(DomainError) as exc_info:
        approve_assignment_version(version, actor="approver-1", override=True)
    assert exc_info.value.code == "VALIDATION_ERROR"


def test_approve_hash_is_deterministic_for_same_assignments():
    event = make_event("OBJ-WORKFLOW-15")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    result = approve_assignment_version(version, actor="approver-1")

    # Recompute independently and compare.
    import hashlib
    import json

    pairs = list(
        version.assignments.order_by("id").values_list("employee_id", "post_id")
    )
    expected = hashlib.sha256(
        json.dumps([[str(e), p] for e, p in pairs], separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    assert result.signature_hash == expected
