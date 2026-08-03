"""Story 16.6e (FR-27) — `send_ack_reminders()`: once-daily ACK_REQUIRED
reminder to the assigned employee, no watermark field (deliberately
narrowed from the registry's "every 2h" cadence — see the story's Scope
Decision)."""

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
    send_ack_reminders,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="RMD", code="RMD")
    dtp = DivisionType.objects.create(code="rmd-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="RMD", code="RMD"
    )


def make_employee(division, iin, bound=True):
    employee = Employee.objects.create(
        iin=iin,
        full_name="Сотрудник",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )
    if bound:
        UserEmployeeBinding.objects.create(user_id=f"user-{iin}", employee=employee)
    return employee


def make_approved_assignment(code, starts_at, employee_id=None, post_code="POST-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        starts_at=starts_at,
        ends_at=starts_at + datetime.timedelta(hours=8),
    )
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=employee_id or uuid.uuid4(), post=post
    )
    submit_assignment_version(version, actor="planner-1")
    approve_assignment_version(version, actor="approver-1")
    assignment.refresh_from_db()
    return event, assignment


def test_reminds_unacknowledged_employee_during_prep_window(division):
    employee = make_employee(division, "900101300901")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-RMD-1", now + datetime.timedelta(days=1), employee.id
    )

    reminded = send_ack_reminders()

    assert assignment.pk in [a.pk for a in reminded]
    assert Notification.objects.filter(
        recipient="user-900101300901", kind=Notification.Kind.ACK_REQUIRED
    ).exists()
    assert AuditLog.objects.filter(action="PLACEMENT_ACK_REMINDER_SENT").count() == 1


def test_event_too_far_away_is_not_reminded(division):
    employee = make_employee(division, "900101300902")
    now = timezone.now()
    make_approved_assignment(
        "OBJ-RMD-2", now + datetime.timedelta(days=10), employee.id
    )

    reminded = send_ack_reminders()

    assert reminded == []


def test_already_acknowledged_is_not_reminded(division):
    employee = make_employee(division, "900101300903")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-RMD-3", now + datetime.timedelta(days=1), employee.id
    )
    assignment.acknowledged_at = now
    assignment.save(update_fields=["acknowledged_at"])

    reminded = send_ack_reminders()

    assert reminded == []


def test_no_binding_skips_notification_no_crash(division):
    employee = make_employee(division, "900101300904", bound=False)
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-RMD-4", now + datetime.timedelta(days=1), employee.id
    )

    reminded = send_ack_reminders()

    assert len(reminded) == 1
    assert not Notification.objects.filter(kind=Notification.Kind.ACK_REQUIRED).exists()


def test_same_day_replay_is_idempotent_via_notify_contract(division):
    employee = make_employee(division, "900101300905")
    now = timezone.now()
    make_approved_assignment("OBJ-RMD-5", now + datetime.timedelta(days=1), employee.id)

    send_ack_reminders()
    send_ack_reminders()

    assert (
        Notification.objects.filter(
            recipient="user-900101300905", kind=Notification.Kind.ACK_REQUIRED
        ).count()
        == 1
    )


def test_no_watermark_field_added_to_placement_assignment():
    """AC-8/AC-5: this story deliberately adds no per-row flag — the
    reminder's recurrence relies entirely on notify()'s own daily
    business_date key, unlike 16.6c's ack_escalated_at."""
    fields = {f.name for f in PlacementAssignment._meta.get_fields()}
    assert "ack_reminded_at" not in fields
    assert "ack_reminder_sent_at" not in fields


def test_multiple_unacknowledged_assignments_yield_one_reminder(division):
    employee = make_employee(division, "900101300906")
    now = timezone.now()
    make_approved_assignment(
        "OBJ-RMD-6A", now + datetime.timedelta(days=1), employee.id, "POST-A"
    )
    make_approved_assignment(
        "OBJ-RMD-6B", now + datetime.timedelta(days=2), employee.id, "POST-B"
    )

    send_ack_reminders()

    assert (
        Notification.objects.filter(
            recipient="user-900101300906", kind=Notification.Kind.ACK_REQUIRED
        ).count()
        == 1
    )


def test_reminder_independent_of_escalation(division):
    employee = make_employee(division, "900101300907")
    now = timezone.now()
    event, assignment = make_approved_assignment(
        "OBJ-RMD-7", now + datetime.timedelta(hours=1), employee.id
    )
    escalate_missing_acknowledgements()
    assignment.refresh_from_db()
    assert assignment.ack_escalated_at is not None

    reminded = send_ack_reminders()

    assert assignment.pk in [a.pk for a in reminded]
    assert Notification.objects.filter(
        recipient="user-900101300907", kind=Notification.Kind.ACK_REQUIRED
    ).exists()
