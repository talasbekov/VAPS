"""Probe cleanup removes its request links without changing notification history."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.db.models.signals import pre_delete

from organization_management.apps.operations.audit_service import SECURITY_EVENT_DELETED
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.tests.test_status_participation_event_names import (
    make_event,
)
from organization_management.apps.ops.security_events import delete_event

pytestmark = pytest.mark.django_db

MARKER = "Основная проходка unique-run (e2e)"


def request_notification(event, *, key="eventId", numeric=False, kind=None):
    row = notify(
        "probe-recipient",
        kind or OpsNotification.Kind.FORCES_REQUEST_SENT,
        event.business_date,
        {
            key: event.pk if numeric else str(event.pk),
            "eventTitle": event.title,
            "allocationId": "probe-force-allocation",
        },
        dedupe_key=None,
    )
    assert row is not None
    return row


def purge(*extra):
    output = StringIO()
    call_command("purge_probe_events", "--marker", MARKER, *extra, stdout=output)
    return output.getvalue()


@pytest.mark.parametrize("key", ["eventId", "event_id"])
@pytest.mark.parametrize("numeric", [False, True])
def test_purge_removes_request_links_to_its_deleted_probe(key, numeric):
    event = make_event("OM-PROBE-1", MARKER)
    event.stage = OpsSecurityEvent.Stage.CLOSED
    event.save(update_fields=["stage"])
    notification = request_notification(event, key=key, numeric=numeric)
    event_id = event.pk

    output = purge("--yes", "--force")

    assert not OpsSecurityEvent.objects.filter(pk=event_id).exists()
    assert not OpsNotification.objects.filter(pk=notification.pk).exists(), (
        "the probe left an actionable request link to its deleted event"
    )
    assert "Удалено уведомлений запросов сил: 1" in output
    audit = OpsAuditLog.objects.get(action=SECURITY_EVENT_DELETED, entity_id=event_id)
    assert audit.old_value["title"] == MARKER
    assert audit.old_value["forced"] is True


def test_purge_keeps_other_events_daily_notifications_and_response_history():
    doomed = make_event("OM-PROBE-1", MARKER)
    other_probe = make_event("OM-PROBE-2", "Another run (e2e)")
    live = make_event("OM-LIVE-1", "Визит делегации")
    own = request_notification(doomed)
    retained = [request_notification(other_probe), request_notification(live)]
    for kind in (
        OpsNotification.Kind.SUBMISSION_LAGGING,
        OpsNotification.Kind.SUMMARY_SENT,
        OpsNotification.Kind.FORCES_RESPONSE,
    ):
        retained.append(request_notification(doomed, kind=kind))
    unrelated = request_notification(live)
    unrelated.payload["eventTitle"] = MARKER
    unrelated.save(update_fields=["payload"])
    retained.append(unrelated)

    purge("--yes")

    assert not OpsNotification.objects.filter(pk=own.pk).exists()
    assert set(OpsNotification.objects.values_list("pk", flat=True)) == {
        row.pk for row in retained
    }
    assert OpsSecurityEvent.objects.filter(pk=other_probe.pk).exists()
    assert OpsSecurityEvent.objects.filter(pk=live.pk).exists()


@pytest.mark.parametrize("extra", [(), ("--orphans-only", "--yes")])
def test_dry_run_and_participation_only_cleanup_keep_request_links(extra):
    event = make_event("OM-PROBE-1", MARKER)
    notification = request_notification(event)

    purge(*extra)

    assert OpsSecurityEvent.objects.filter(pk=event.pk).exists()
    assert OpsNotification.objects.filter(pk=notification.pk).exists()
    assert not OpsAuditLog.objects.filter(action=SECURITY_EVENT_DELETED).exists()


def test_purge_keeps_request_links_when_the_event_deletion_is_refused():
    refused = make_event("OM-PROBE-1", MARKER)
    refused.stage = OpsSecurityEvent.Stage.CLOSED
    refused.save(update_fields=["stage"])
    removable = make_event("OM-PROBE-2", f"{MARKER} another event")
    kept_notification = request_notification(refused)
    removed_notification = request_notification(removable)

    output = purge("--yes")

    assert "Оставлено (сервер отказал): 1" in output
    assert OpsSecurityEvent.objects.filter(pk=refused.pk).exists()
    assert OpsNotification.objects.filter(pk=kept_notification.pk).exists()
    assert not OpsSecurityEvent.objects.filter(pk=removable.pk).exists()
    assert not OpsNotification.objects.filter(pk=removed_notification.pk).exists()


def test_regular_event_deletion_preserves_notification_history():
    event = make_event("OM-LIVE-1", "Визит делегации")
    notification = request_notification(event)

    delete_event(event.pk, actor="test")

    assert not OpsSecurityEvent.objects.filter(pk=event.pk).exists()
    assert OpsNotification.objects.filter(pk=notification.pk).exists()


def test_notification_cleanup_failure_rolls_back_probe_deletion_and_audit():
    event = make_event("OM-PROBE-1", MARKER)
    notification = request_notification(event)

    def refuse_notification_delete(sender, instance, **kwargs):
        if instance.pk == notification.pk:
            raise RuntimeError("notification cleanup failed")

    pre_delete.connect(refuse_notification_delete, sender=OpsNotification, weak=False)
    try:
        with pytest.raises(RuntimeError, match="notification cleanup failed"):
            purge("--yes")
    finally:
        pre_delete.disconnect(refuse_notification_delete, sender=OpsNotification)

    assert OpsSecurityEvent.objects.filter(pk=event.pk).exists()
    assert OpsNotification.objects.filter(pk=notification.pk).exists()
    assert not OpsAuditLog.objects.filter(
        action=SECURITY_EVENT_DELETED, entity_id=event.pk
    ).exists()
