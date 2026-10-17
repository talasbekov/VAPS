"""Scheduled submission reminders have two independent stages and scoped recipients."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import (
    Permission, Role, RolePermission, TemporaryDutyPermission, UserRole,
)
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import OpsDivisionNotifyRecipient
from organization_management.apps.operations.selectors import SubmissionControlSettingsSelector
from organization_management.apps.operations.tests.test_day_submission_service import submitted

pytestmark = pytest.mark.django_db
DAY = date(2026, 10, 7)
LOCAL = ZoneInfo("Asia/Almaty")


def moment(hour, minute=0, second=0):
    return datetime(2026, 10, 7, hour, minute, second, tzinfo=LOCAL)


def run_at(at):
    from organization_management.apps.operations.submission_reminders import remind_daily_submissions
    with clock.override(at):
        return remind_daily_submissions()


def grant(user, division, role="DIRECTORATE_HEAD", *, active=True, permission="daily_report.mark_update"):
    Role.objects.get_or_create(code=role, defaults={"name": role})
    Permission.objects.get_or_create(code=permission, defaults={"name": permission})
    RolePermission.objects.get_or_create(role_code_id=role, permission_code_id=permission)
    return UserRole.objects.create(
        user_id=str(user.pk), role_code_id=role,
        scope_division_id=division.pk if division else None, is_active=active,
    )


@pytest.fixture
def required():
    department = Division.objects.create(name="Department", division_type="department")
    left = Division.objects.create(name="Left", division_type="directorate", parent=department)
    right = Division.objects.create(name="Right", division_type="directorate", parent=department)
    control = SubmissionControlSettingsSelector.get()
    control.required_division_ids = [left.pk, right.pk]
    control.control_hour = time(17)
    control.default_notify_recipient = ""
    control.save()
    return department, left, right


def test_submission_reminders_have_a_registered_frequent_beat_task(required):
    from organization_management.config.celery import app
    app.autodiscover_tasks(force=True)
    entries = [entry for entry in settings.CELERY_BEAT_SCHEDULE.values()
               if entry["task"] == "operations.remind_daily_submissions"]
    assert len(entries) == 1
    assert entries[0]["schedule"] <= 60
    assert entries[0]["task"] in app.tasks
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    with clock.override(moment(16)):
        result = app.tasks[entries[0]["task"]].apply().get()
    assert result["phase"] == "before_deadline"
    assert OpsNotification.objects.get().recipient == "chief"


@pytest.mark.parametrize("at,phase", [
    (moment(15, 59, 59), None),
    (moment(16), "before_deadline"),
    (moment(16, 59, 59), "before_deadline"),
    (moment(17), "overdue"),
    (moment(17, 0, 1), "overdue"),
])
def test_deadline_stage_boundaries(required, at, phase):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    result = run_at(at)
    assert result["phase"] == phase
    assert OpsNotification.objects.count() == (0 if phase is None else 1)
    if phase:
        note = OpsNotification.objects.get()
        assert note.business_date == DAY
        assert note.payload == {
            "phase": phase, "laggard_division_ids": [left.pk],
            "deadline_at": "2026-10-07T17:00:00+05:00",
        }


def test_stages_deduplicate_independently_without_a_watermark(required):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    for at in [moment(16), moment(16, 30), moment(17), moment(18)]:
        run_at(at)
    notes = list(OpsNotification.objects.order_by("id"))
    assert [note.payload["phase"] for note in notes] == ["before_deadline", "overdue"]
    assert notes[0].dedupe_key != notes[1].dedupe_key


def test_submission_between_stages_cancels_overdue_notice(required):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    run_at(moment(16))
    submitted(left, DAY)
    run_at(moment(17))
    assert [note.payload["phase"] for note in OpsNotification.objects.all()] == ["before_deadline"]


def test_other_date_and_superseded_submissions_do_not_hide_missing_today(required):
    _, left, right = required
    control = SubmissionControlSettingsSelector.get()
    control.default_notify_recipient = "duty"
    control.save()
    submitted(left, DAY - timedelta(days=1))
    submitted(right, DAY, is_current=False)
    run_at(moment(17))
    assert OpsNotification.objects.get().payload["laggard_division_ids"] == [left.pk, right.pk]


def test_explicit_chiefs_and_temporary_deputies_receive_only_their_scope(required):
    from organization_management.apps.operations.api.serializers import GrantTemporaryDutyRequestSerializer
    from organization_management.apps.operations.services import RoleAdminService
    department, left, right = required
    chief = User.objects.create_user(username="chief")
    deputy = User.objects.create_user(username="deputy")
    permanent_deputy = User.objects.create_user(username="permanent-deputy")
    department_chief = User.objects.create_user(username="department-chief")
    foreign = User.objects.create_user(username="foreign")
    observer = User.objects.create_user(username="observer")
    inactive = User.objects.create_user(username="inactive")
    disabled_user = User.objects.create_user(username="disabled-user", is_active=False)
    global_admin = User.objects.create_user(username="global-admin")
    outside = Division.objects.create(name="Outside")
    grant(chief, left)
    grant(permanent_deputy, left)
    # ORGD is accepted by the real temporary-duty API. Its configured submission
    # permission is resolved in the same way as any other role permission.
    grant(deputy, left, role="ORGD", active=False)
    grant(department_chief, department)
    grant(foreign, outside)
    grant(observer, left, role="REMINDER_OBSERVER", permission="status.view")
    grant(inactive, left, active=False)
    grant(disabled_user, left)
    grant(global_admin, None)
    temporary = GrantTemporaryDutyRequestSerializer(data={
        "user_id": str(deputy.pk), "duty_role_code": "ORGD", "scope_division_id": left.pk,
        "starts_at": moment(15).isoformat(), "ends_at": moment(18).isoformat(),
    })
    temporary.is_valid(raise_exception=True)
    RoleAdminService.grant_temporary_duty(**temporary.validated_data, created_by="test")
    # The same chief appears in both sources, without duplicate deliveries.
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient=f" {chief.pk} ")
    OpsDivisionNotifyRecipient.objects.create(division_id=right.pk, recipient="explicit-right")
    run_at(moment(16))
    notices = {note.recipient: note.payload["laggard_division_ids"] for note in OpsNotification.objects.all()}
    assert notices == {
        str(chief.pk): [left.pk], str(deputy.pk): [left.pk], str(permanent_deputy.pk): [left.pk],
        str(department_chief.pk): [left.pk, right.pk], "explicit-right": [right.pk],
    }


@pytest.mark.parametrize("start,end,active", [
    (moment(13), moment(15), True),
    (moment(17), moment(19), True),
    (moment(15), moment(18), False),
])
def test_expired_future_and_inactive_deputies_are_not_notified(required, start, end, active):
    _, left, _ = required
    deputy = User.objects.create_user(username="absent-deputy")
    grant(deputy, left, role="ORGD", active=False)
    TemporaryDutyPermission.objects.create(
        user_id=str(deputy.pk), duty_role_code="ORGD", scope_division_id=left.pk,
        starts_at=start, ends_at=end, is_active=active, created_by="test",
    )
    run_at(moment(16))
    assert not OpsNotification.objects.exists()


def test_live_deadline_setting_and_local_day_are_used(required):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    control = SubmissionControlSettingsSelector.get()
    control.control_hour = time(0)
    control.save()
    run_at(moment(0, 1))  # UTC is still the previous calendar day.
    note = OpsNotification.objects.get()
    assert note.business_date == DAY
    assert note.payload["phase"] == "overdue"
    assert note.payload["deadline_at"] == "2026-10-07T00:00:00+05:00"
    control.control_hour = time(18)
    control.save()
    run_at(moment(17))
    assert OpsNotification.objects.get(payload__phase="before_deadline").payload["deadline_at"] == "2026-10-07T18:00:00+05:00"


@pytest.mark.parametrize("deadline_time,at", [
    (time(0), moment(23)),
    (time(0, 30), moment(23, 30)),
])
def test_early_deadline_reminds_on_the_previous_local_day(required, deadline_time, at):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    control = SubmissionControlSettingsSelector.get()
    control.control_hour = deadline_time
    control.save()
    submitted(left, DAY)
    next_day = DAY + timedelta(days=1)
    run_at(at)
    run_at(at + timedelta(minutes=1))
    note = OpsNotification.objects.get()
    assert note.business_date == next_day
    assert note.payload["phase"] == "before_deadline"
    assert note.payload["deadline_at"] == datetime.combine(next_day, deadline_time, tzinfo=LOCAL).isoformat()
    run_at(datetime.combine(next_day, deadline_time, tzinfo=LOCAL))
    assert list(OpsNotification.objects.order_by("id").values_list("payload__phase", flat=True)) == ["before_deadline", "overdue"]


def test_next_day_window_does_not_skip_todays_overdue_notice(required):
    _, left, _ = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="chief")
    control = SubmissionControlSettingsSelector.get()
    control.control_hour = time(0)
    control.save()
    run_at(moment(23))
    assert set(OpsNotification.objects.values_list("business_date", "payload__phase")) == {
        (DAY, "overdue"), (DAY + timedelta(days=1), "before_deadline"),
    }


def test_failed_delivery_rolls_back_and_the_next_tick_retries(required, monkeypatch):
    from organization_management.apps.operations import submission_reminders
    _, left, right = required
    OpsDivisionNotifyRecipient.objects.create(division_id=left.pk, recipient="first")
    OpsDivisionNotifyRecipient.objects.create(division_id=right.pk, recipient="second")
    real_notify = submission_reminders.notify

    def fail_second(recipient, *args, **kwargs):
        return None if recipient == "second" else real_notify(recipient, *args, **kwargs)

    monkeypatch.setattr(submission_reminders, "notify", fail_second)
    with pytest.raises(submission_reminders.SubmissionReminderDeliveryError):
        run_at(moment(17))
    assert not OpsNotification.objects.exists()
    monkeypatch.setattr(submission_reminders, "notify", real_notify)
    run_at(moment(17, 1))
    assert set(OpsNotification.objects.values_list("recipient", flat=True)) == {"first", "second"}


def test_recipient_resolution_query_count_does_not_grow_with_divisions(required):
    from organization_management.apps.operations.submission_reminders import resolve_submission_recipients
    department, left, right = required
    chief = User.objects.create_user(username="batch-chief")
    grant(chief, department)
    control = SubmissionControlSettingsSelector.get()
    extra = [Division.objects.create(name=f"Unit {i}", parent=department) for i in range(20)]
    with clock.override(moment(16)), CaptureQueriesContext(connection) as small:
        one = resolve_submission_recipients([left.pk], control=control)
    with clock.override(moment(16)), CaptureQueriesContext(connection) as large:
        many = resolve_submission_recipients([left.pk, right.pk, *[d.pk for d in extra]], control=control)
    assert one[left.pk] == {str(chief.pk)}
    assert all(recipients == {str(chief.pk)} for recipients in many.values())
    assert len(large) == len(small)
    assert len(large) <= 6
