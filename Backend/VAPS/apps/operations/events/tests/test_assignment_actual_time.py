"""Story 18.3 (FR-43) — record_assignment_actual_time(): опрос по итогам,
одна фактическая запись на PlacementAssignment, upsert, gated on
CLOSED event + is_current version."""

import datetime

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
)
from apps.operations.events.services import record_assignment_actual_time
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db

START = datetime.datetime(2026, 8, 4, 9, 0, tzinfo=datetime.timezone.utc)
END = datetime.datetime(2026, 8, 4, 17, 0, tzinfo=datetime.timezone.utc)


def make_event(code, status_code=SecurityEvent.StatusCode.CLOSED):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_assignment(event, is_current=True, status=AssignmentVersion.Status.APPROVED):
    post = Post.objects.create(object=event.object, code="POST-1", name="Пост")
    version = AssignmentVersion.objects.create(
        event=event, status=status, version=1, is_current=is_current
    )
    return PlacementAssignment.objects.create(
        version=version, employee_id="11111111-1111-1111-1111-111111111111", post=post
    )


def test_records_actual_time_for_closed_event_current_version():
    event = make_event("OBJ-ACTUAL-1")
    assignment = make_assignment(event)

    actual = record_assignment_actual_time(
        assignment, actor="staff-1", actual_start_at=START, actual_end_at=END
    )

    assert actual.actual_start_at == START
    assert actual.actual_end_at == END
    assert actual.recorded_by == "staff-1"
    audit_row = AuditLog.objects.get(action="ASSIGNMENT_ACTUAL_TIME_RECORDED")
    # review (Blind Hunter): раньше проверялось только .exists() — пустой/
    # неверный new_value прошёл бы незамеченным.
    assert audit_row.new_value["actual_start_at"] == START.isoformat()
    assert audit_row.new_value["actual_end_at"] == END.isoformat()
    assert audit_row.old_value is None


def test_repeated_call_upserts_not_duplicates():
    event = make_event("OBJ-ACTUAL-2")
    assignment = make_assignment(event)
    record_assignment_actual_time(
        assignment, actor="staff-1", actual_start_at=START, actual_end_at=END
    )
    corrected_end = END + datetime.timedelta(hours=1)

    record_assignment_actual_time(
        assignment, actor="staff-2", actual_start_at=START, actual_end_at=corrected_end
    )

    assert PlacementAssignmentActual.objects.filter(assignment=assignment).count() == 1
    row = PlacementAssignmentActual.objects.get(assignment=assignment)
    assert row.actual_end_at == corrected_end
    assert row.recorded_by == "staff-2"
    # review (Blind Hunter): audit-registry обещает "включая исправление" —
    # раньше old_value не писался вовсе, коррекция не несла следа ПРЕЖНЕГО
    # значения.
    correction_audit = AuditLog.objects.filter(
        action="ASSIGNMENT_ACTUAL_TIME_RECORDED"
    ).latest("created_at")
    assert correction_audit.old_value == {
        "actual_start_at": START.isoformat(),
        "actual_end_at": END.isoformat(),
    }
    assert correction_audit.new_value["actual_end_at"] == corrected_end.isoformat()


def test_rejected_when_start_not_before_end():
    event = make_event("OBJ-ACTUAL-3")
    assignment = make_assignment(event)

    with pytest.raises(DomainError) as exc_info:
        record_assignment_actual_time(
            assignment, actor="staff-1", actual_start_at=END, actual_end_at=START
        )

    assert exc_info.value.http_status == 400
    assert not PlacementAssignmentActual.objects.filter(assignment=assignment).exists()


def test_rejected_when_start_equals_end():
    """review (Acceptance Auditor): only the fully-reversed case was
    tested — the actual boundary (start == end) was never exercised, so
    a `>` vs `>=` operator regression would slip through undetected."""
    event = make_event("OBJ-ACTUAL-6")
    assignment = make_assignment(event)

    with pytest.raises(DomainError) as exc_info:
        record_assignment_actual_time(
            assignment, actor="staff-1", actual_start_at=START, actual_end_at=START
        )

    assert exc_info.value.http_status == 400
    assert not PlacementAssignmentActual.objects.filter(assignment=assignment).exists()


def test_rejected_when_event_not_closed():
    event = make_event("OBJ-ACTUAL-4", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    assignment = make_assignment(event)

    with pytest.raises(DomainError) as exc_info:
        record_assignment_actual_time(
            assignment, actor="staff-1", actual_start_at=START, actual_end_at=END
        )

    assert exc_info.value.http_status == 422
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_rejected_when_version_not_current():
    event = make_event("OBJ-ACTUAL-5")
    assignment = make_assignment(event, is_current=False)

    with pytest.raises(DomainError) as exc_info:
        record_assignment_actual_time(
            assignment, actor="staff-1", actual_start_at=START, actual_end_at=END
        )

    assert exc_info.value.http_status == 422
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"
