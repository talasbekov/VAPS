"""Audit proofs: run only against the separately provisioned PostgreSQL test DB.

Expected contract: a scoped grant admits its division subtree; an unscoped
grant admits both subtrees. The new duty register already enforces this rule
for these same PLAN rows. The legacy planner and analytics must not expose or
mutate rows that this grant cannot read through the register.

These tests intentionally fail on the audited implementation. They are not
part of the production test suite and do not change application files.
"""
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from urllib.parse import urlsplit

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock, override
from organization_management.apps.operations.models_analytics import (
    OpsAnalyticsMetricDefinition,
    OpsAnalyticsPeriodPreset,
)
from organization_management.apps.operations.models_duty import OpsDutyConflictPolicy, OpsDutyShift, OpsDutyType
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.reports.tests.integration.test_report_files import debug_media_urls
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.ops import duties


pytestmark = pytest.mark.django_db
SHIFTS = "/api/ops/duty-shifts/"
REGISTER = "/api/ops/duty-register/"
SNAPSHOT = "/api/ops/service-analytics/"
DRILLDOWN = "/api/ops/service-analytics-drilldown/"


@pytest.fixture
def scope_scene():
    first = Division.objects.create(name="Audit own department", division_type="department")
    other = Division.objects.create(name="Audit foreign department", division_type="department")
    OpsDutyType.objects.update_or_create(
        duty_type_code="AUDIT_DUTY", defaults={
            "safe_label": "Audit duty", "target_type": "OWN_OBJECT",
            "default_duration_minutes": 60, "requires_senior": False,
            "rest_after_minutes": 0, "requires_current_passport": False,
        },
    )
    OpsDutyConflictPolicy.objects.update_or_create(
        singleton_key=1,
        defaults={"version": "audit-conflict-policy", "rest_after_duty_mode": "HARD_BLOCK"},
    )
    OpsAnalyticsPeriodPreset.objects.update_or_create(
        preset_code="AUDIT_TODAY", defaults={
            "safe_label": "Audit today", "offset_days": 0,
            "length_days": 1, "position": 0,
        },
    )
    OpsAnalyticsMetricDefinition.objects.update_or_create(
        metric_code="DUTY_PLANNED", defaults={
            "safe_label": "Audit planned duties", "unit": "COUNT",
            "warning_from": None, "critical_from": None,
            "drilldown_available": True, "position": 0,
        },
    )
    with override(datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)):
        shifts = []
        for index, division in enumerate((first, other), 1):
            person = Employee.objects.create(
                personnel_number=f"audit-scope-{index}",
                first_name="Audit", last_name=f"Employee{index}",
                birth_date=None, hire_date=None,
            )
            StaffUnit.objects.create(index=index, employee=person, division=division)
            shifts.append(OpsDutyShift.objects.create(
                business_date=Clock.today_local(), duty_type_code="AUDIT_DUTY",
                target={"targetType": "OWN_OBJECT", "objectId": None,
                        "safeLabel": f"Confidential location {index}"},
                employee_name=f"Audit Employee{index}", employee_id=str(person.pk),
                state_code="PLANNED", acknowledged_at=None, actual_start=None,
                actual_end=None, passport_binding=None, note=None,
                cancellation=None, override_reason=None,
            ))
        yield {"first": first, "other": other, "own": shifts[0], "foreign": shifts[1]}


def audit_client(scene, global_grant, *, analytics=False):
    permissions = ("analytics.view", "analytics.drilldown", "analytics.personal_detail") if analytics else ("duty.view", "duty.manage")
    client, user = client_for(
        "audit-scope-user", "AUDIT_SCOPE_ROLE", permissions,
        scope_division_id=None if global_grant else scene["first"].pk,
    )
    # Verify the precondition through the production permission resolver.
    scope = PermissionService.visible_division_ids(str(user.pk), permissions[0])
    assert scope is None if global_grant else scope == {scene["first"].pk}
    return client


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_legacy_shift_list_obeys_same_scope_as_register(scope_scene, global_grant):
    client = audit_client(scope_scene, global_grant)
    foreign_id = str(scope_scene["foreign"].pk)
    canonical = client.get(f"{REGISTER}PLAN:{foreign_id}/")
    assert canonical.status_code == (200 if global_grant else 403), canonical.data
    response = client.get(SHIFTS)
    assert response.status_code == 200, response.data
    ids = {row["id"] for row in response.data["results"]}
    assert str(scope_scene["own"].pk) in ids
    assert (foreign_id in ids) is global_grant, response.data


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_legacy_shift_detail_obeys_grant_scope(scope_scene, global_grant):
    client = audit_client(scope_scene, global_grant)
    response = client.get(f"{SHIFTS}{scope_scene['foreign'].pk}/")
    if global_grant:
        assert response.status_code == 200, response.data
        assert response.data["shift"]["id"] == str(scope_scene["foreign"].pk)
    else:
        assert response.status_code in (403, 404), response.data


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_legacy_shift_cancel_cannot_bypass_register_scope(scope_scene, global_grant):
    client = audit_client(scope_scene, global_grant)
    foreign = scope_scene["foreign"]
    canonical = client.get(f"{REGISTER}PLAN:{foreign.pk}/")
    assert canonical.status_code == (200 if global_grant else 403), canonical.data
    response = client.post(f"{SHIFTS}{foreign.pk}/cancel/", {"reason": "Audit proof"}, format="json")
    foreign.refresh_from_db()
    assert response.status_code in ((200,) if global_grant else (403, 404)), response.data
    assert foreign.state_code == ("CANCELLED" if global_grant else "PLANNED")


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_service_analytics_counts_only_grant_scope(scope_scene, global_grant):
    client = audit_client(scope_scene, global_grant, analytics=True)
    response = client.get(SNAPSHOT, {"preset": "AUDIT_TODAY"})
    assert response.status_code == 200, response.data
    metrics = {row["metricCode"]: row for row in response.data["data"]["metrics"]}
    assert metrics["DUTY_PLANNED"]["value"] == (2 if global_grant else 1), response.data


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_analytics_personal_drilldown_does_not_reveal_foreign_department(scope_scene, global_grant):
    client = audit_client(scope_scene, global_grant, analytics=True)
    foreign = scope_scene["foreign"]
    canonical = client.get(f"{REGISTER}PLAN:{foreign.pk}/")
    assert canonical.status_code == (200 if global_grant else 403), canonical.data
    snapshot = client.get(SNAPSHOT, {"preset": "AUDIT_TODAY"})
    assert snapshot.status_code == 200, snapshot.data
    response = client.get(DRILLDOWN, {
        "preset": "AUDIT_TODAY", "snapshot_id": snapshot.data["snapshotId"],
        "metric_code": "DUTY_PLANNED",
    })
    assert response.status_code == 200, response.data
    rows = response.data["data"]["rows"]
    foreign_rows = [row for row in rows if row["rowId"] == str(foreign.pk)]
    assert bool(foreign_rows) is global_grant, response.data
    if global_grant:
        assert foreign_rows[0]["employeeLabel"] == foreign.employee_name


def test_load_analytics_does_not_bypass_personal_detail_permission(scope_scene):
    client, user = client_for(
        "audit-aggregate-viewer", "AUDIT_AGGREGATE_VIEWER", ("analytics.view",),
        scope_division_id=scope_scene["first"].pk,
    )
    assert PermissionService.effective_permissions(str(user.pk)) == {"analytics.view"}
    # The canonical drilldown with the same grant suppresses personal fields.
    snapshot = client.get(SNAPSHOT, {"preset": "AUDIT_TODAY"})
    assert snapshot.status_code == 200, snapshot.data
    assert snapshot.data["drilldownAllowed"] is False
    response = client.get("/api/ops/load-analytics/")
    assert response.status_code == 200, response.data
    known_names = {scope_scene["own"].employee_name, scope_scene["foreign"].employee_name}
    identified = [row for row in response.data["view"]["employees"]
                  if row.get("employeeId") is not None or row.get("safeLabel") in known_names]
    assert not identified, response.data


def test_status_document_bytes_must_not_bypass_status_scope(scope_scene, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    employee = Employee.objects.get(pk=scope_scene["own"].employee_id)
    status = employee.statuses.first()
    if status is None:
        status = EmployeeStatus.objects.create(
            employee=employee, status_type="in_service", state="active",
            start_date=Clock.today_local(), end_date=None,
        )
    manager, _ = client_for(
        "audit-status-manager", "AUDIT_STATUS_MANAGER", ("status.manage", "status.view"),
        scope_division_id=scope_scene["first"].pk,
    )
    outsider, _ = client_for(
        "audit-status-outsider", "AUDIT_STATUS_OUTSIDER", ("status.view",),
        scope_division_id=scope_scene["other"].pk,
    )
    path = f"/api/statuses/statuses/{status.pk}/"
    upload = manager.post(path + "upload_document/", {
        "title": "Confidential personnel document",
        "file": SimpleUploadedFile("audit-personnel-note.pdf", b"audit private status bytes", content_type="application/pdf"),
    }, format="multipart")
    assert upload.status_code == 201, upload.data
    assert outsider.get(path).status_code == 404
    media_path = urlsplit(upload.data["file_url"]).path
    assert media_path.startswith("/media/status_documents/")
    # Same storage path is public in LAN/contour nginx; no live server or
    # working files are needed to demonstrate Django's development route.
    with debug_media_urls(tmp_path):
        anonymous = APIClient().get(media_path)
        assert anonymous.status_code in (401, 403, 404), (
            "A scoped personnel document has an anonymous media URL", media_path,
            anonymous.status_code,
        )


@pytest.mark.parametrize("entity", ["role", "permission"])
def test_deactivation_through_admin_api_revokes_existing_access(scope_scene, entity):
    client = audit_client(scope_scene, False)
    admin, _ = client_for("audit-access-admin", "AUDIT_ACCESS_ADMIN", ("admin.roles",))
    assert client.get(SHIFTS).status_code == 200
    target = "roles/AUDIT_SCOPE_ROLE" if entity == "role" else "permissions/duty.view"
    response = admin.patch(f"/api/operations/{target}/", {"is_active": False}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["is_active"] is False
    after = client.get(SHIFTS)
    assert after.status_code == 403, after.data


@pytest.mark.django_db(transaction=True)
def test_approval_serializes_with_shift_cancellation(scope_scene, monkeypatch):
    """A real second PostgreSQL connection pauses after reading the DRAFT flag.

    Approval must either wait for cancellation and reject stale validation, or
    cancellation must detect APPROVED and refuse. Both writes cannot succeed.
    """
    foreign = scope_scene["foreign"]
    month = foreign.business_date.isoformat()[:7]
    duties.create_draft(month)
    checked = duties.check_plan(month)
    assert checked.last_validation["passed"] is True
    observed_draft, release_cancel = Event(), Event()
    original = duties._plan_locked

    def pause_after_flag_read(day):
        locked = original(day)
        assert locked is False
        observed_draft.set()
        assert release_cancel.wait(15), "Audit cancellation pause timed out"
        return locked

    def cancel_on_other_connection():
        close_old_connections()
        try:
            return duties.cancel_shift(foreign.pk, reason="Audit concurrent cancellation", actor="audit-planner")
        finally:
            close_old_connections()

    monkeypatch.setattr(duties, "_plan_locked", pause_after_flag_read)
    with ThreadPoolExecutor(max_workers=1) as executor:
        cancellation = executor.submit(cancel_on_other_connection)
        try:
            assert observed_draft.wait(15), "Cancellation did not reach DRAFT check"
            approved = duties.approve_plan(month, actor="audit-approver")
            assert approved.state_code == "APPROVED"
        finally:
            release_cancel.set()
        cancellation.result(timeout=15)
    foreign.refresh_from_db()
    approved.refresh_from_db()
    assert approved.state_code == "APPROVED"
    assert foreign.state_code == "PLANNED", "A cancellation committed after the month was approved"
