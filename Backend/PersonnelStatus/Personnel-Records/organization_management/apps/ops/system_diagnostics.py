"""Bounded, redacted observations; no probes, repairs or business mutations."""
import re
from datetime import timedelta, timezone as dt_timezone
from uuid import UUID

from django.db.models import Count, Max, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from organization_management.apps.operations.models_assistant_connection_check import OpsAssistantConnectionCheck
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.ops.assistant.access import visible_tasks
from organization_management.apps.ops.assistant.dialogue import LEASE_SECONDS

PENDING_SCAN_LIMIT = 1000


def connection_check(saved_revision):
    check = OpsAssistantConnectionCheck.objects.first()
    if check is None:
        return None
    match = ("draft" if check.checked_saved_revision is None else
             "current" if check.checked_saved_revision == saved_revision else "previous")
    return {"checked_at": check.checked_at.isoformat(), "succeeded": check.succeeded,
            "provider": check.provider, "model": check.model, "configuration_match": match}


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = parse_datetime(value)
        if parsed is None or timezone.is_naive(parsed):
            return None
        return parsed.astimezone(dt_timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def assistant_queue(request, *, now):
    # settings.manage grants diagnostics, not access to other people's tasks.
    # The same owner / delegated headquarters policy as the assistant applies.
    tasks = visible_tasks(request)
    active = Q(processing__state__in=("queued", "running", "failed"))
    summary = tasks.aggregate(
        **{state: Count("pk", filter=Q(processing__state=state)) for state in ("queued", "running", "failed")},
        latest_task_update_at=Max("updated_at", filter=active),
    )
    counts = {state: summary[state] for state in ("queued", "running", "failed")}
    pending = {
        "total": counts["queued"] + counts["running"], "inspected": 0,
        "limit": PENDING_SCAN_LIMIT, "truncated": False,
        "stale_queued": 0, "stale_running": 0,
        "invalid_timestamps": 0, "future_timestamps": 0,
        "oldest_queued_at": None, "oldest_started_at": None,
    }
    # Extract only the required scalar JSON keys. Do not read the message,
    # plan, error, actor or the patch inside the processing document.
    rows = tasks.filter(processing__state__in=("queued", "running")).order_by("updated_at", "pk").values(
        "processing__state", "processing__queuedAt", "processing__startedAt",
    )[:PENDING_SCAN_LIMIT]
    oldest = {"queued": None, "running": None}
    for row in rows:
        pending["inspected"] += 1
        state = row["processing__state"]
        value = row["processing__startedAt"] if state == "running" else row["processing__queuedAt"]
        stamp = _timestamp(value)
        if stamp is None:
            pending["invalid_timestamps"] += 1
            continue
        if stamp > now:
            pending["future_timestamps"] += 1
            continue
        if oldest[state] is None or stamp < oldest[state]:
            oldest[state] = stamp
        if stamp < now - timedelta(seconds=LEASE_SECONDS):
            pending["stale_" + state] += 1
    pending["truncated"] = pending["total"] > pending["inspected"]
    pending["oldest_queued_at"] = oldest["queued"].isoformat() if oldest["queued"] else None
    pending["oldest_started_at"] = oldest["running"].isoformat() if oldest["running"] else None
    latest = summary["latest_task_update_at"]
    return {"scope": "visible_tasks", "snapshot": "sequential_reads", "observed_at": now.isoformat(), "worker_connection": "not_checked",
            "counts": counts, "lease_seconds": LEASE_SECONDS, "pending": pending,
            # This is a task-row update, not a completion or heartbeat time.
            "latest_task_update_at": latest.isoformat() if latest else None}


def digital_twin_evidence():
    # Catalog receipts are durable local evidence. The snapshot GET has no
    # export ledger or client acknowledgement, so its currentness is unknown.
    evidence = {"state": "not_recorded", "recorded_at": None, "export_id": None, "bundle_sha256": None}
    prefix = "new_value__receipt__"
    row = OpsAuditLog.objects.filter(action="SECURITY_OBJECT_CATALOG_IMPORTED", entity_type="security_object").order_by(
        "-created_at", "-pk",
    ).values("created_at", *(prefix + key for key in ("format", "applied", "exportId", "bundleSha256"))).first()
    if row:
        evidence.update(state="invalid", recorded_at=row["created_at"].isoformat())
        export_id, digest = row[prefix + "exportId"], row[prefix + "bundleSha256"]
        try:
            valid_id = isinstance(export_id, str) and str(UUID(export_id)) == export_id.lower()
        except (ValueError, TypeError, AttributeError):
            valid_id = False
        if (row[prefix + "format"] == "smart-object-transfer-receipt/v1" and row[prefix + "applied"] is True
                and valid_id and isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)):
            evidence.update(state="recorded", export_id=export_id.lower(), bundle_sha256=digest)
    return {"state": "unknown", "last_success_at": None, "last_export_at": None,
            "acknowledgement": "not_recorded", "catalog_import": evidence}
