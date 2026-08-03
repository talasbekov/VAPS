"""Story 16.6c (FR-27) — `escalate_missing_acknowledgements()`:
ACK_MISSING_ESCALATION digest to the event's senior, literal analogue of
`escalate_stale_force_requests()` (15.10)."""

import datetime
import uuid

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
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
    escalate_missing_acknowledgements,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="ESC", code="ESC")
    dtp = DivisionType.objects.create(code="esc-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="ESC", code="ESC"
    )


def make_senior(division, iin, bound=True):
    senior = Employee.objects.create(
        iin=iin,
        full_name="Старший",
        rank_code="MAJOR",
        position_code="SENIOR",
        division=division,
    )
    if bound:
        UserEmployeeBinding.objects.create(
            user_id=f"user-{iin}", employee=senior
        )
    return senior


def make_approved_assignment(code, starts_at, senior_employee_id=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        starts_at=starts_at,
        ends_at=starts_at + datetime.timedelta(hours=8),
        senior_employee_id=senior_employee_id,
    )
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = Post.objects.create(object=event.object, code="POST-1", name="Пост")
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")
    assignment.refresh_from_db()
    return event, assignment


def test_escalates_unacknowledged_assignment_near_event_start(division):
    senior = make_senior(division, "900101300801")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-ESC-1", now + datetime.timedelta(hours=1), senior.id
    )

    escalated = escalate_missing_acknowledgements()

    assignment.refresh_from_db()
    assert assignment.pk in [a.pk for a in escalated]
    assert assignment.ack_escalated_at is not None
    assert Notification.objects.filter(
        recipient="user-900101300801",
        kind=Notification.Kind.ACK_MISSING_ESCALATION,
    ).exists()
    assert AuditLog.objects.filter(
        action="PLACEMENT_ACKNOWLEDGEMENT_ESCALATED"
    ).count() == 1


def test_event_too_far_away_is_not_escalated(division):
    senior = make_senior(division, "900101300802")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-ESC-2", now + datetime.timedelta(days=3), senior.id
    )

    escalated = escalate_missing_acknowledgements()

    assert escalated == []
    assignment.refresh_from_db()
    assert assignment.ack_escalated_at is None


def test_already_acknowledged_is_not_escalated(division):
    senior = make_senior(division, "900101300803")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-ESC-3", now + datetime.timedelta(hours=1), senior.id
    )
    assignment.acknowledged_at = now
    assignment.save(update_fields=["acknowledged_at"])

    escalated = escalate_missing_acknowledgements()

    assert escalated == []


def test_already_escalated_is_not_re_escalated(division):
    senior = make_senior(division, "900101300804")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-ESC-4", now + datetime.timedelta(hours=1), senior.id
    )

    first = escalate_missing_acknowledgements()
    assert len(first) == 1

    second = escalate_missing_acknowledgements()

    assert second == []
    assert AuditLog.objects.filter(
        action="PLACEMENT_ACKNOWLEDGEMENT_ESCALATED"
    ).count() == 1


def test_no_senior_binding_marks_row_but_skips_notification(division):
    senior = make_senior(division, "900101300805", bound=False)
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-ESC-5", now + datetime.timedelta(hours=1), senior.id
    )

    escalated = escalate_missing_acknowledgements()

    assignment.refresh_from_db()
    assert len(escalated) == 1
    assert assignment.ack_escalated_at is not None
    assert not Notification.objects.filter(
        kind=Notification.Kind.ACK_MISSING_ESCALATION
    ).exists()


def test_multiple_missing_same_event_yield_one_notification(division):
    senior = make_senior(division, "900101300806")
    now = timezone.now()
    obj = FacilityObject.objects.create(
        code="OBJ-ESC-6", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        starts_at=now + datetime.timedelta(hours=1),
        ends_at=now + datetime.timedelta(hours=9),
        senior_employee_id=senior.id,
    )
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post_a = Post.objects.create(object=event.object, code="POST-A", name="A")
    post_b = Post.objects.create(object=event.object, code="POST-B", name="B")
    PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post_a
    )
    PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post_b
    )
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")

    escalate_missing_acknowledgements()

    assert (
        Notification.objects.filter(
            recipient="user-900101300806",
            kind=Notification.Kind.ACK_MISSING_ESCALATION,
        ).count()
        == 1
    )


def test_second_same_day_batch_merges_into_existing_notification(division):
    senior = make_senior(division, "900101300807")
    now = timezone.now()
    event_a, assignment_a = make_approved_assignment(
        "OBJ-ESC-7A", now + datetime.timedelta(hours=1), senior.id
    )
    escalate_missing_acknowledgements()

    event_b, assignment_b = make_approved_assignment(
        "OBJ-ESC-7B", now + datetime.timedelta(hours=2), senior.id
    )
    escalate_missing_acknowledgements()

    notifications = Notification.objects.filter(
        recipient="user-900101300807", kind=Notification.Kind.ACK_MISSING_ESCALATION
    )
    assert notifications.count() == 1
    escalated_ids = {
        e["assignment_id"] for e in notifications.first().payload["escalated"]
    }
    assert escalated_ids == {assignment_a.pk, assignment_b.pk}
