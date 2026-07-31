"""Story 15.11c — `process_temp_duty_transitions()` behavioral tests (FR-34)."""

import datetime as dt

import pytest
from django.core.management import call_command

from apps.audit.models import AuditLog
from apps.core.clock import Clock
from apps.notifications.models import Notification
from apps.operations.rbac.models import TemporaryDutyPermission
from apps.operations.services import process_temp_duty_transitions

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def make_grant(starts_delta, ends_delta, is_active=True, activated_notified_at=None):
    now = Clock.now()
    return TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD", is_active=is_active,
        starts_at=now + dt.timedelta(hours=starts_delta),
        ends_at=now + dt.timedelta(hours=ends_delta),
        created_by="admin",
        activated_notified_at=activated_notified_at,
    )


def test_active_grant_notifies_and_marks(seeded):
    grant = make_grant(-1, 1)
    result = process_temp_duty_transitions()
    assert len(result["activated"]) == 1
    assert result["activated"][0].pk == grant.pk
    grant.refresh_from_db()
    assert grant.activated_notified_at is not None
    assert Notification.objects.filter(
        recipient="duty-1", kind="TEMP_PERMISSION_ACTIVE"
    ).exists()


def test_repeat_run_does_not_renotify_activation(seeded):
    make_grant(-1, 1)
    process_temp_duty_transitions()
    second = process_temp_duty_transitions()
    assert second["activated"] == []
    assert Notification.objects.filter(kind="TEMP_PERMISSION_ACTIVE").count() == 1


def test_future_grant_not_yet_activated(seeded):
    make_grant(1, 3)
    result = process_temp_duty_transitions()
    assert result["activated"] == []
    assert not Notification.objects.filter(kind="TEMP_PERMISSION_ACTIVE").exists()


def test_expired_grant_auto_gashes_and_notifies(seeded):
    grant = make_grant(-3, -1)
    result = process_temp_duty_transitions()
    assert len(result["expired"]) == 1
    assert result["expired"][0].pk == grant.pk
    grant.refresh_from_db()
    assert grant.is_active is False
    assert Notification.objects.filter(
        recipient="duty-1", kind="TEMP_PERMISSION_EXPIRED"
    ).exists()
    log = AuditLog.objects.get(action="TEMP_DUTY_EXPIRED")
    assert log.actor_user_id == "SYSTEM"


def test_repeat_run_does_not_reexpire(seeded):
    make_grant(-3, -1)
    process_temp_duty_transitions()
    second = process_temp_duty_transitions()
    assert second["expired"] == []
    assert Notification.objects.filter(kind="TEMP_PERMISSION_EXPIRED").count() == 1
    assert AuditLog.objects.filter(action="TEMP_DUTY_EXPIRED").count() == 1


def test_already_expired_grant_never_activated(seeded):
    """A grant that expires before the catch-up job ever sees it "active"
    (a long gap between runs, or a very short window) is expired without a
    TEMP_PERMISSION_ACTIVE notification — not a bug, just a boundary never
    caught while being watched."""
    make_grant(-3, -1)
    process_temp_duty_transitions()
    assert not Notification.objects.filter(kind="TEMP_PERMISSION_ACTIVE").exists()


def test_no_boundary_crossings_is_a_clean_noop(seeded):
    make_grant(1, 3)  # future — neither active nor expired yet
    result = process_temp_duty_transitions()
    assert result == {"activated": [], "expired": []}
    assert not Notification.objects.exists()


def test_manually_deactivated_grant_is_not_reprocessed(seeded):
    make_grant(-3, -1, is_active=False)
    result = process_temp_duty_transitions()
    assert result == {"activated": [], "expired": []}
