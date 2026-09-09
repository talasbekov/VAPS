"""Manual reminders use current required children, scoped authority and atomic delivery."""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.tests.test_summary_api import (
    client, post, submit, tree, types, TODAY,
)
from organization_management.apps.operations.tests.test_lagging_check import pin_recipient, set_duty

pytestmark = pytest.mark.django_db
URL = "/api/operations/daily-summaries/remind/"


def test_only_missing_required_children_are_notified_and_audited(types, tree):
    root, left, right = tree
    Division.objects.create(name="Empty", parent=root)
    submit(left)
    pin_recipient(right, "recipient")
    api, user = client("reminder", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk, actor="forged")
    assert response.status_code == 200
    assert response.data == {
        "business_date": TODAY.isoformat(), "laggard_division_ids": [right.pk],
        "notified_recipient_count": 1, "unresolved_division_ids": [],
    }
    row = OpsNotification.objects.get(kind="SUBMISSION_LAGGING")
    assert row.recipient == "recipient"
    assert row.payload["laggard_division_ids"] == [right.pk]
    assert row.dedupe_key == f"manual:{root.pk}"
    log = OpsAuditLog.objects.get(action="DAILY_SUMMARY_REMINDED")
    assert log.actor_user_id == str(user.pk)
    assert log.new_value == response.data


def test_shared_recipient_and_repeat_create_one_manual_notification(types, tree):
    root, left, right = tree
    set_duty("recipient")
    api, _ = client("repeat", ["daily_report.generate"], root.pk)
    for _ in range(2):
        response = post(api, URL, division_id=root.pk)
        assert response.status_code == 200
        assert response.data["notified_recipient_count"] == 1
    row = OpsNotification.objects.get(kind="SUBMISSION_LAGGING")
    assert row.payload["laggard_division_ids"] == sorted([left.pk, right.pk])


def test_unresolved_recipient_is_explicit(types, tree):
    root, left, right = tree
    set_duty("")
    pin_recipient(left, "recipient")
    api, _ = client("unresolved", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk)
    assert response.status_code == 200
    assert response.data["unresolved_division_ids"] == [right.pk]
    assert response.data["notified_recipient_count"] == 1


def test_foreign_department_forbidden(tree):
    root, _, _ = tree
    foreign = Division.objects.create(name="Foreign")
    api, _ = client("foreign", ["daily_report.generate"], foreign.pk)
    assert post(api, URL, division_id=root.pk).status_code == 403
    assert not OpsNotification.objects.exists()


def test_generate_permission_required(tree):
    root, _, _ = tree
    api, _ = client("reader", ["status.view"], root.pk)
    assert post(api, URL, division_id=root.pk).status_code == 403


def test_completed_day_has_no_laggards(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    api, _ = client("complete", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk)
    assert response.status_code == 200
    assert response.data["laggard_division_ids"] == []
    assert response.data["notified_recipient_count"] == 0
    assert not OpsNotification.objects.exists()


def test_other_date_submission_does_not_hide_missing_current_day(types, tree):
    root, left, right = tree
    submit(left, TODAY + timedelta(days=1))
    set_duty("recipient")
    api, _ = client("other-day", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk)
    assert response.status_code == 200
    assert response.data["laggard_division_ids"] == sorted([left.pk, right.pk])


def test_manual_dedupe_does_not_consume_automatic_notification(tree):
    root, _, _ = tree
    set_duty("recipient")
    OpsNotification.objects.create(
        recipient="recipient", kind="SUBMISSION_LAGGING", business_date=TODAY,
        payload={"laggard_division_ids": [999]},
    )
    api, _ = client("auto-separate", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk)
    assert response.status_code == 200
    assert OpsNotification.objects.filter(kind="SUBMISSION_LAGGING").count() == 2


@pytest.mark.parametrize("day", ["2026-02-30", "not-a-date", ""])
def test_invalid_date_rejected(tree, day):
    root, _, _ = tree
    api, _ = client("date", ["daily_report.generate"], root.pk)
    assert post(api, URL, division_id=root.pk, business_date=day).status_code == 400


def test_delivery_failure_rolls_back_previous_notification_and_audit(tree, monkeypatch):
    from organization_management.apps.operations import daily_reminders
    root, left, right = tree
    pin_recipient(left, "first")
    pin_recipient(right, "second")
    real_notify = daily_reminders.notify

    def fail_second(recipient, *args, **kwargs):
        return None if recipient == "second" else real_notify(recipient, *args, **kwargs)

    monkeypatch.setattr(daily_reminders, "notify", fail_second)
    api, _ = client("failure", ["daily_report.generate"], root.pk)
    response = post(api, URL, division_id=root.pk)
    assert response.status_code == 503
    assert not OpsNotification.objects.exists()
    assert not OpsAuditLog.objects.filter(action="DAILY_SUMMARY_REMINDED").exists()
