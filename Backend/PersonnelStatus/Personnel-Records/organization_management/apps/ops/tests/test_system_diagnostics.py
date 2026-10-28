from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.apps import apps
from django.db import connection
from django.db.models.query import QuerySet
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
URL = "/api/ops/system-diagnostics/"


def test_diagnostics_requires_global_admin_not_scoped_settings():
    division = Division.objects.create(name="Scoped settings")
    scoped, _ = client_for("scoped_diag", "SCOPED_DIAG", ("settings.manage",), scope_division_id=division.pk)
    scoped_wildcard, _ = client_for("scoped_wildcard_diag", "SCOPED_WILDCARD_DIAG", ("*",), scope_division_id=division.pk)
    reader, _ = client_for("reader_diag", "READER_DIAG", ("settings.view",))
    for api in (scoped, scoped_wildcard, reader):
        assert api.get(URL).status_code == 403
    assert APIClient().get(URL).status_code in (401, 403)


@override_settings(OPS_ASSISTANT_PROVIDER="disabled")
def test_diagnostics_is_read_only_and_does_not_guess_integration_health():
    api, _ = client_for("admin_diag", "ADMIN_DIAG", ("settings.manage",))
    before = OpsAssistantConnection.objects.count()
    with patch("organization_management.apps.ops.assistant.provider.check_connection") as call:
        response = api.get(URL)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["application"]["state"] == "available"
    assert body["database"]["state"] == "available"
    assert body["ai"]["state"] == "disabled"
    assert body["ai"]["connectivity"] == "not_checked"
    assert body["ai"]["last_check"] is None
    assert body["ai_queue"]["worker_connection"] == "not_checked"
    assert body["ai_queue"]["counts"] == {"queued": 0, "running": 0, "failed": 0}
    assert body["ai_queue"]["pending"]["inspected"] == 0
    assert body["digital_twin"]["state"] == "unknown"
    assert body["backup"]["state"] == "unknown"
    assert body["release"]["state"] == "unknown"
    assert body["checked_at"]
    assert body["time_zone"]
    assert OpsAssistantConnection.objects.count() == before
    call.assert_not_called()
    assert response["Cache-Control"] == "private, no-store"


def test_diagnostics_redacts_credentials_and_reports_saved_configuration():
    api, _ = client_for("admin_diag_secret", "ADMIN_DIAG_SECRET", ("settings.manage",))
    OpsAssistantConnection.objects.create(id=1, provider="openai", model="local-model", base_url="http://model.test:8002", api_key="very-private-key", updated_by="admin")
    response = api.get(URL)
    assert response.status_code == 200
    body = response.json()
    assert body["ai"]["state"] == "configured"
    assert body["ai"]["model"] == "local-model"
    assert body["ai"]["updated_at"]
    assert b"very-private-key" not in response.content
    assert b"model.test" not in response.content
    assert api.post(URL, {}, format="json").status_code == 405


def make_task(actor, state, **processing):
    return OpsAssistantTask.objects.create(
        initiated_by=str(actor.pk), request_key=str(uuid4()), request_hash="0" * 64,
        message="PRIVATE TASK TEXT", plan={"personnel": "PRIVATE PERSONNEL"},
        processing={"state": state, "error": "PRIVATE ERROR", **processing},
    )


def test_queue_reports_scoped_stale_evidence_using_real_wall_clock():
    api, actor = client_for("queue_diag", "QUEUE_DIAG", ("settings.manage",))
    _, foreign = client_for("foreign_queue_diag")
    now = datetime(2026, 10, 27, 8, 0, tzinfo=dt_timezone.utc)
    old = (now - timedelta(seconds=181)).isoformat()
    fresh = (now - timedelta(seconds=30)).isoformat()
    make_task(actor, "queued", queuedAt=old)
    make_task(actor, "running", queuedAt=old, startedAt=fresh)
    make_task(actor, "failed", queuedAt=old)
    make_task(foreign, "queued", queuedAt=old)
    with patch.object(timezone, "now", return_value=now), clock.override(datetime(2040, 1, 1, tzinfo=dt_timezone.utc)):
        response = api.get(URL)
    assert response.status_code == 200, response.content
    body = response.json()
    queue = body["ai_queue"]
    assert queue["scope"] == "visible_tasks"
    assert queue["observed_at"] == now.isoformat()
    assert body["checked_at"] == now.isoformat()
    assert queue["snapshot"] == "sequential_reads"
    assert queue["counts"] == {"queued": 1, "running": 1, "failed": 1}
    assert queue["pending"]["stale_queued"] == 1
    assert queue["pending"]["stale_running"] == 0
    assert queue["pending"]["oldest_queued_at"] == old
    assert queue["pending"]["oldest_started_at"] == fresh
    assert queue["worker_connection"] == "not_checked"
    assert b"PRIVATE" not in response.content
    assert b"initiated_by" not in response.content


@pytest.mark.parametrize("permissions,expected", [(("settings.manage", "forces.command"), 1), (("*",), 1), (("settings.manage",), 0)])
def test_queue_delegated_visibility_uses_existing_task_policy(permissions, expected):
    api, _ = client_for("delegated_diag", "DELEGATED_DIAG", permissions)
    _, owner = client_for("delegated_owner")
    task = make_task(owner, "failed")
    task.delegated = True
    task.save(update_fields=["delegated"])
    assert api.get(URL).json()["ai_queue"]["counts"]["failed"] == expected


@pytest.mark.parametrize("stamp", [None, "", "bad date", "2026-10-27T08:00:00", 15, "2026-13-40T00:00:00Z", "9999-12-31T23:59:59-05:00"])
def test_queue_does_not_invent_age_for_invalid_or_naive_timestamps(stamp):
    api, actor = client_for("invalid_stamp_diag", "INVALID_STAMP_DIAG", ("settings.manage",))
    make_task(actor, "running", queuedAt="2020-01-01T00:00:00Z", startedAt=stamp)
    queue = api.get(URL).json()["ai_queue"]
    assert queue["pending"]["invalid_timestamps"] == 1
    assert queue["pending"]["stale_running"] == 0
    assert queue["pending"]["oldest_started_at"] is None


def test_queue_stale_threshold_is_strict_and_uses_timezone_offsets():
    api, actor = client_for("lease_diag", "LEASE_DIAG", ("settings.manage",))
    now = datetime(2026, 10, 27, 8, 0, tzinfo=dt_timezone.utc)
    make_task(actor, "queued", queuedAt="2026-10-27T12:57:00+05:00")
    make_task(actor, "running", startedAt="2026-10-27T12:56:59+05:00")
    with patch.object(timezone, "now", return_value=now):
        pending = api.get(URL).json()["ai_queue"]["pending"]
    assert pending["stale_queued"] == 0
    assert pending["stale_running"] == 1
    assert pending["oldest_started_at"] == "2026-10-27T07:56:59+00:00"


def test_diagnostics_reads_no_task_payload_credentials_or_writes():
    api, actor = client_for("no_mutation_diag", "NO_MUTATION_DIAG", ("settings.manage",))
    make_task(actor, "queued", queuedAt=timezone.now().isoformat())
    OpsAssistantConnection.objects.create(id=1, provider="openai", model="local-model", api_key="PRIVATE KEY")
    checks = apps.get_model("operations", "OpsAssistantConnectionCheck")
    before = (OpsAssistantTask.objects.count(), OpsAuditLog.objects.count(), checks.objects.count())
    with CaptureQueriesContext(connection) as captured:
        response = api.get(URL)
    assert response.status_code == 200
    after = (OpsAssistantTask.objects.count(), OpsAuditLog.objects.count(), checks.objects.count())
    assert before == after
    sql = "\n".join(query["sql"] for query in captured.captured_queries)
    assert not any(query["sql"].lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE ")) for query in captured.captured_queries)
    assert '"api_key"' not in sql
    assert '"ops_assistant_tasks"."message"' not in sql
    assert '"ops_assistant_tasks"."plan"' not in sql
    assert '"ops_assistant_tasks"."processing" FROM' not in sql


def test_queue_marks_future_timestamps_and_discloses_bounded_inspection(monkeypatch):
    from organization_management.apps.ops import system_diagnostics

    api, actor = client_for("bounded_diag", "BOUNDED_DIAG", ("settings.manage",))
    now = timezone.now()
    make_task(actor, "queued", queuedAt=(now + timedelta(days=1)).isoformat())
    make_task(actor, "queued", queuedAt=(now - timedelta(days=1)).isoformat())
    monkeypatch.setattr(system_diagnostics, "PENDING_SCAN_LIMIT", 1)
    with patch.object(timezone, "now", return_value=now):
        queue = api.get(URL).json()["ai_queue"]
    assert queue["counts"]["queued"] == 2
    assert queue["pending"]["inspected"] == 1
    assert queue["pending"]["total"] == 2
    assert queue["pending"]["limit"] == 1
    assert queue["pending"]["truncated"] is True
    assert queue["pending"]["future_timestamps"] == 1
    assert queue["pending"]["stale_queued"] == 0


def test_queue_concurrent_change_preserves_separate_observations_without_clamping(monkeypatch):
    api, actor = client_for("concurrent_queue_diag", "CONCURRENT_QUEUE_DIAG", ("settings.manage",))
    make_task(actor, "queued", queuedAt=timezone.now().isoformat())
    original = QuerySet.aggregate
    def aggregate_then_queue(query, *args, **kwargs):
        result = original(query, *args, **kwargs)
        if query.model is OpsAssistantTask:
            make_task(actor, "queued", queuedAt=timezone.now().isoformat())
        return result
    monkeypatch.setattr(QuerySet, "aggregate", aggregate_then_queue)
    queue = api.get(URL).json()["ai_queue"]
    assert queue["snapshot"] == "sequential_reads"
    assert queue["counts"]["queued"] == queue["pending"]["total"] == 1
    assert queue["pending"]["inspected"] == 2


def record_catalog_receipt(**changes):
    receipt = {"format": "smart-object-transfer-receipt/v1", "applied": True,
               "exportId": "a5625535-8ba8-4ec9-8445-0efde0d04320", "bundleSha256": "a" * 64,
               "target": {"departmentName": "PRIVATE DEPARTMENT"}, "posts": {"99": {"id": "100"}}, **changes}
    return OpsAuditLog.objects.create(actor_user_id="PRIVATE ACTOR", action="SECURITY_OBJECT_CATALOG_IMPORTED",
                                     entity_type="security_object", entity_id=1, new_value={"receipt": receipt},
                                     created_at=timezone.now())


def test_catalog_import_receipt_is_redacted_and_never_claims_twin_currentness():
    api, _ = client_for("catalog_diag", "CATALOG_DIAG", ("settings.manage",))
    receipt = record_catalog_receipt()
    response = api.get(URL)
    twin = response.json()["digital_twin"]
    assert twin["state"] == "unknown"
    assert twin["last_success_at"] is None
    assert twin["last_export_at"] is None
    assert twin["acknowledgement"] == "not_recorded"
    assert twin["catalog_import"] == {"state": "recorded", "recorded_at": receipt.created_at.isoformat(),
                                      "export_id": "a5625535-8ba8-4ec9-8445-0efde0d04320", "bundle_sha256": "a" * 64}
    assert b"PRIVATE" not in response.content
    assert b"posts" not in response.content


@pytest.mark.parametrize("changes", [{"applied": False}, {"format": "unknown"}, {"exportId": "PRIVATE"}, {"bundleSha256": "PRIVATE"}])
def test_malformed_catalog_receipt_is_not_presented_as_confirmed(changes):
    api, _ = client_for("bad_receipt_diag", "BAD_RECEIPT_DIAG", ("settings.manage",))
    record_catalog_receipt(**changes)
    response = api.get(URL)
    assert response.json()["digital_twin"]["catalog_import"]["state"] == "invalid"
    assert b"PRIVATE" not in response.content

