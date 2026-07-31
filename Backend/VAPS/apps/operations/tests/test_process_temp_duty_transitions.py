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


def make_grant_for(user_id, starts_delta, ends_delta, duty_role_code="OMD"):
    now = Clock.now()
    return TemporaryDutyPermission.objects.create(
        user_id=user_id, duty_role_code=duty_role_code, is_active=True,
        starts_at=now + dt.timedelta(hours=starts_delta),
        ends_at=now + dt.timedelta(hours=ends_delta),
        created_by="admin",
    )


def test_same_day_activation_collision_does_not_permanently_stick_loser(seeded):
    """Review finding (Blind Hunter/Edge Case Hunter, HIGH): two grants for
    the SAME user activating the same day must not both be permanently
    marked activated_notified_at when notify()'s (recipient, kind,
    business_date) uniqueness only lets ONE of them actually persist a
    notification. The "losing" grant must stay eligible for a future run,
    not be silently and irrecoverably skipped forever."""
    winner = make_grant_for("dual-1", -1, 1, duty_role_code="OMD")
    loser = make_grant_for("dual-1", -1, 1, duty_role_code="ORGD")

    result = process_temp_duty_transitions()

    assert Notification.objects.filter(kind="TEMP_PERMISSION_ACTIVE").count() == 1
    winner.refresh_from_db()
    loser.refresh_from_db()
    assert winner.activated_notified_at is not None
    assert loser.activated_notified_at is None
    assert {g.pk for g in result["activated"]} == {winner.pk}


def test_same_day_expiry_collision_still_expires_both_grants(seeded):
    """Unlike activation, expiry's idempotency (is_active) is per-grant and
    unconditional on notify()'s outcome — both grants must actually expire
    (is_active=False, audited) even though only one notification survives
    the same-(recipient,kind,business_date) collision."""
    grant_a = make_grant_for("dual-2", -3, -1, duty_role_code="OMD")
    grant_b = make_grant_for("dual-2", -3, -1, duty_role_code="ORGD")

    result = process_temp_duty_transitions()

    assert Notification.objects.filter(kind="TEMP_PERMISSION_EXPIRED").count() == 1
    assert AuditLog.objects.filter(action="TEMP_DUTY_EXPIRED").count() == 2
    grant_a.refresh_from_db()
    grant_b.refresh_from_db()
    assert grant_a.is_active is False
    assert grant_b.is_active is False
    assert {g.pk for g in result["expired"]} == {grant_a.pk, grant_b.pk}
