"""Recorded dates are context; only exact, readable intervals become minutes."""
from datetime import date, datetime, timedelta
import json

import pytest
from django.core.management import call_command

from organization_management.apps.operations.models import RolePermission, UserRole
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_status import OpsEmployeeStatus, OpsStatusParticipation
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops.tests.service_duty_support import duty_log_scene
from organization_management.apps.ops.tests.test_status_duty_records import source as personnel_source
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
LOAD = "/api/ops/load-analytics/"
DAY = date(2026, 10, 13)


def instant(value):
    return datetime.fromisoformat(value)


@pytest.fixture
def scene(duty_log_scene):
    call_command("seed_status_types", verbosity=0)
    scene = duty_log_scene
    api, user = client_for("workload-reader", "WORKLOAD_READER",
        ("analytics.view", "analytics.personal_detail", "status.view"), scene["first"].pk)
    scene.update(api=api, coverage_user=user)
    return scene


def coverage(scene, **params):
    response = scene["api"].get(LOAD, {"coverage_from": "2026-10-13", "coverage_to": "2026-10-13", **params})
    assert response.status_code == 200, response.data
    assert "coverage" in response.data, "The load report must include factual source coverage"
    return response.data["coverage"]


def log(scene, start="2026-10-13T08:00:00+05:00", end="2026-10-13T10:00:00+05:00", **extra):
    person = scene["people"][0]
    return OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник1 Учётный",
        division_id=scene["first"].pk, division_name=scene["first"].name,
        service_duty_code="GBR", service_duty_label="Группа", planned_start=instant(start), planned_end=instant(end),
        created_by="fixture", **extra)


def status(scene, *, person=None, **extra):
    return OpsEmployeeStatus.objects.create(employee_id=(person or scene["people"][0]).pk,
        status_type_code="DUTY", date_start=DAY, date_end=DAY + timedelta(days=1), **extra)


def test_overlapping_sources_are_unioned_without_inventing_actual_hours(scene):
    log(scene)
    log(scene, "2026-10-13T09:00:00+05:00", "2026-10-13T11:00:00+05:00")
    data = coverage(scene)
    row = data["employees"][0]
    assert row["knownPlannedMinutes"] == 180
    assert row["confirmedActualMinutes"] is None
    assert row["unknownActualRecords"] == 2
    assert len(row["records"]) == 2


def test_period_uses_local_midnight_and_only_completed_actual_facts(scene):
    log(scene, "2026-10-12T23:00:00+05:00", "2026-10-13T02:00:00+05:00",
        actual_start=instant("2026-10-12T23:30:00+05:00"), actual_end=instant("2026-10-13T01:30:00+05:00"))
    log(scene, "2026-10-13T01:00:00+05:00", "2026-10-13T03:00:00+05:00",
        actual_start=instant("2026-10-13T01:00:00+05:00"))
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] == 180
    assert row["confirmedActualMinutes"] == 90
    assert row["unknownActualRecords"] == 1
    assert row["records"][0]["dateFrom"] == "2026-10-12"


def test_known_completed_interval_outside_window_is_zero_not_unknown(scene):
    log(scene, actual_start=instant("2026-10-12T08:00:00+05:00"), actual_end=instant("2026-10-12T10:00:00+05:00"))
    row = coverage(scene)["employees"][0]
    assert row["confirmedActualMinutes"] == 0
    assert row["unknownActualRecords"] == 0
    assert row["records"][0]["actualMinutes"] == 0


def test_known_plan_outside_window_is_zero_when_actual_fact_overlaps(scene):
    log(scene, "2026-10-12T08:00:00+05:00", "2026-10-12T10:00:00+05:00",
        actual_start=instant("2026-10-13T08:00:00+05:00"), actual_end=instant("2026-10-13T10:00:00+05:00"))
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] == 0
    assert row["unknownPlannedRecords"] == 0
    assert row["confirmedActualMinutes"] == 120


def test_overlapping_completed_facts_are_unioned_separately_from_plan(scene):
    log(scene, actual_start=instant("2026-10-13T08:00:00+05:00"), actual_end=instant("2026-10-13T10:00:00+05:00"))
    log(scene, "2026-10-13T10:00:00+05:00", "2026-10-13T12:00:00+05:00",
        actual_start=instant("2026-10-13T09:00:00+05:00"), actual_end=instant("2026-10-13T11:00:00+05:00"))
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] == 240
    assert row["confirmedActualMinutes"] == 180


def test_historical_timezone_change_measures_elapsed_time_not_a_fixed_day(scene):
    # Almaty changed from UTC+06 to UTC+05 at the end of February 2024.
    # Clipping a broader real interval to that local day leaves 25 hours.
    log(scene, "2024-02-28T00:00:00+06:00", "2024-03-02T00:00:00+05:00",
        actual_start=instant("2024-02-28T00:00:00+06:00"), actual_end=instant("2024-03-02T00:00:00+05:00"))
    row = coverage(scene, coverage_from="2024-02-29", coverage_to="2024-02-29")["employees"][0]
    assert row["knownPlannedMinutes"] == 1500
    assert row["confirmedActualMinutes"] == 1500


def test_future_actual_end_stays_unknown_and_cancelled_plan_is_not_counted(scene):
    log(scene, actual_start=instant("2026-10-13T08:00:00+05:00"), actual_end=instant("2026-10-14T09:00:00+05:00"))
    log(scene, "2026-10-13T10:00:00+05:00", "2026-10-13T12:00:00+05:00",
        cancelled_at=instant("2026-10-13T07:00:00+05:00"))
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] == 120
    assert row["confirmedActualMinutes"] is None
    assert row["unknownActualRecords"] == 1


def test_exact_personnel_exit_and_log_overlap_and_mirror_is_not_a_second_record(scene):
    saved = personnel_source(scene, intervals=[{"start_at": "2026-10-13T08:00:00+05:00", "end_at": "2026-10-13T10:00:00+05:00"}])
    log(scene)
    before = OpsDutyRecordSupplement.objects.count()
    data = coverage(scene)
    row = data["employees"][0]
    assert row["knownPlannedMinutes"] == 120
    assert {item["source"] for item in row["records"]} == {"LOG", "STATUS_DUTY"}
    assert row["unknownPlannedRecords"] == 0
    assert len(row["records"]) == 2
    assert OpsDutyRecordSupplement.objects.count() == before
    saved.refresh_from_db()
    assert saved.duty_assignment["intervals"][0]["end_at"] == "2026-10-13T10:00:00+05:00"


def test_explicit_empty_personnel_schedule_does_not_become_a_date_only_exit(scene):
    personnel_source(scene, intervals=[])
    assert coverage(scene)["employees"] == []


@pytest.mark.parametrize("damage", ["object", "interval", "outside_period"])
def test_malformed_legacy_placement_retains_known_status_dates_without_hours(scene, damage):
    saved = personnel_source(scene)
    placement = dict(saved.duty_assignment)
    if damage == "object":
        placement["object_id"] = "unknown-imported-reference"
    elif damage == "interval":
        placement["intervals"] = [{"start_at": "unknown", "end_at": "unknown"}]
    else:
        placement["intervals"] = [{"start_at": "2026-10-12T08:00:00+05:00", "end_at": "2026-10-12T10:00:00+05:00"}]
    # Imported legacy data can predate today's validation. GET must not repair it.
    EmployeeStatus.objects.filter(pk=saved.pk).update(duty_assignment=placement)
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] is None
    assert row["unknownPlannedRecords"] == 1
    assert row["records"][0]["source"] == "STATUS"
    assert row["records"][0]["dateFrom"] == "2026-10-13"
    saved.refresh_from_db()
    assert saved.duty_assignment == placement


def test_legacy_null_interval_already_has_one_unknown_canonical_exit(scene):
    saved = personnel_source(scene)
    EmployeeStatus.objects.filter(pk=saved.pk).update(duty_assignment={**saved.duty_assignment, "intervals": [None]})
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] is None
    assert row["unknownPlannedRecords"] == 1
    assert len(row["records"]) == 1
    assert row["records"][0]["source"] == "STATUS_DUTY"


def test_mirror_normalization_is_bounded_by_permitted_overlapping_statuses(scene):
    from organization_management.apps.ops.workload_coverage import _represented_personnel_refs
    old = personnel_source(scene, intervals=None)
    EmployeeStatus.objects.filter(pk=old.pk).update(start_date=date(2026, 10, 1), end_date=date(2026, 10, 2))
    OpsEmployeeStatus.objects.filter(source_ref=f"personnel:{old.pk}").update(date_start=date(2026, 10, 1), date_end=date(2026, 10, 3))
    current = personnel_source(scene, intervals=None)
    permitted = OpsEmployeeStatus.objects.filter(employee_id=scene["people"][0].pk, date_start__lte=DAY, date_end__gt=DAY)
    refs = _represented_personnel_refs({scene["people"][0].pk: scene["people"][0]}, permitted)
    assert refs == {f"personnel:{current.pk}"}


def test_dispatch_log_and_personnel_intervals_union_across_sources(scene):
    saved = personnel_source(scene, intervals=[{"start_at": "2026-10-13T08:00:00+05:00", "end_at": "2026-10-13T10:00:00+05:00"}])
    mirrored = OpsEmployeeStatus.objects.get(source_ref=f"personnel:{saved.pk}", cancelled_at__isnull=True)
    OpsDutyDispatchAssignment.objects.create(employee_id=scene["people"][0].pk, employee_name="Сотрудник1",
        source_status=mirrored, receiver_department_id=scene["other"].pk, placement={},
        start_at=instant("2026-10-13T09:00:00+05:00"), end_at=instant("2026-10-13T11:00:00+05:00"), created_by="fixture")
    log(scene, "2026-10-13T10:00:00+05:00", "2026-10-13T12:00:00+05:00")
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] == 240
    assert len(row["records"]) == 3


def test_date_only_plan_has_unknown_minutes_even_with_type_duration(scene):
    OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Сотрудник1",
        business_date=DAY, duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] is None
    assert row["unknownPlannedRecords"] == 1
    assert row["records"][0]["plannedMinutes"] is None


def test_om_uses_registered_participation_dates_and_never_exposes_event_details(scene):
    api, _ = client_for("global-workload", "GLOBAL_WORKLOAD",
        ("analytics.view", "analytics.personal_detail", "analytics.operations"), None)
    scene["api"] = api
    saved = status(scene, source_ref="security-event:98765", comment="Secret event title")
    OpsStatusParticipation.objects.create(status=saved, event_id=98765, kind_code="PHYSICAL_SQUAD")
    row = coverage(scene)["employees"][0]
    assert row["knownPlannedMinutes"] is None
    assert row["confirmedActualMinutes"] is None
    assert row["records"][0]["source"] == "OM"
    assert row["records"][0]["dateFrom"] == "2026-10-13"
    assert row["records"][0]["dateTo"] == "2026-10-13"
    payload = json.dumps(row)
    assert "98765" not in payload and "Secret event title" not in payload


def test_scoped_om_permission_reports_source_unavailable_without_claiming_zero(scene):
    RolePermission.objects.create(role_code_id="WORKLOAD_READER", permission_code_id="analytics.operations")
    saved = status(scene)
    OpsStatusParticipation.objects.create(status=saved, event_id=98765, kind_code="PHYSICAL_SQUAD")
    data = coverage(scene)
    assert next(item for item in data["sources"] if item["code"] == "OM")["state"] == "UNAVAILABLE"
    assert data["employees"] == []


def test_status_read_permission_is_separate_and_revocation_is_immediate(scene):
    status(scene)
    assert coverage(scene)["employees"][0]["records"][0]["source"] == "STATUS"
    RolePermission.objects.filter(role_code_id="WORKLOAD_READER", permission_code_id="status.view").delete()
    data = coverage(scene)
    assert data["employees"] == []
    assert next(item for item in data["sources"] if item["code"] == "STATUS")["state"] == "UNAVAILABLE"


def test_personal_permission_revocation_hides_all_source_records(scene):
    log(scene)
    assert coverage(scene)["employees"]
    RolePermission.objects.filter(role_code_id="WORKLOAD_READER", permission_code_id="analytics.personal_detail").delete()
    data = coverage(scene)
    assert data["state"] == "PERSONAL_DETAIL_REQUIRED"
    assert data["employees"] == []
    assert "Сотрудник1" not in json.dumps(data, ensure_ascii=False)


def test_global_duty_grant_cannot_expand_scoped_analytics(scene):
    RolePermission.objects.create(role_code_id="LOG_OTHER", permission_code_id="analytics.personal_detail")
    # Grant a wider existing duty reader to the analytics account.
    UserRole.objects.create(user_id=str(scene["coverage_user"].pk), role_code_id="LOG_OTHER", scope_division_id=None)
    foreign = scene["people"][1]
    OpsDutyLogEntry.objects.create(employee_id=foreign.pk, employee_name="Foreign private person",
        division_id=scene["other"].pk, division_name="Foreign private division", service_duty_code="GBR", service_duty_label="Группа",
        planned_start=instant("2026-10-13T08:00:00+05:00"), planned_end=instant("2026-10-13T10:00:00+05:00"), created_by="fixture")
    assert "Foreign private" not in json.dumps(coverage(scene))


def test_broader_duty_grant_does_not_apply_foreign_source_limits_to_workload(scene, monkeypatch):
    from organization_management.apps.ops import personnel_duty_records
    personnel_source(scene, person=scene["people"][1])
    log(scene)
    UserRole.objects.create(user_id=str(scene["coverage_user"].pk), role_code_id="LOG_OTHER", scope_division_id=None)
    monkeypatch.setattr(personnel_duty_records, "MAX_SOURCE_ROWS", 1)
    data = coverage(scene)
    assert data["state"] == "AVAILABLE"
    assert data["employees"][0]["knownPlannedMinutes"] == 120


def test_record_limit_never_returns_a_misleading_partial_total(scene, monkeypatch):
    from organization_management.apps.ops import workload_coverage
    log(scene)
    log(scene, "2026-10-13T09:00:00+05:00", "2026-10-13T11:00:00+05:00")
    monkeypatch.setattr(workload_coverage, "MAX_RECORDS", 1)
    data = coverage(scene)
    assert data["state"] == "LIMIT_EXCEEDED"
    assert data["employees"] == []
    assert data["reason"]


def test_partial_status_scope_cannot_disclose_global_analytics_employees(scene):
    api, user = client_for("workload-global-personal", "WORKLOAD_GLOBAL_PERSONAL",
        ("analytics.view", "analytics.personal_detail"), None)
    UserRole.objects.create(user_id=str(user.pk), role_code_id="WORKLOAD_READER", scope_division_id=scene["first"].pk)
    scene["api"] = api
    status(scene)
    status(scene, person=scene["people"][1])
    data = coverage(scene)
    assert {row["employeeId"] for row in data["employees"]} == {str(scene["people"][0].pk)}


def test_om_duplicate_status_links_and_global_permission_revocation(scene):
    api, _ = client_for("workload-global-om", "WORKLOAD_GLOBAL_OM",
        ("analytics.view", "analytics.personal_detail", "analytics.operations"), None)
    scene["api"] = api
    for _ in range(2):
        saved = status(scene)
        OpsStatusParticipation.objects.create(status=saved, event_id=12345, kind_code="PHYSICAL_SQUAD")
    assert len(coverage(scene)["employees"][0]["records"]) == 1
    RolePermission.objects.filter(role_code_id="WORKLOAD_GLOBAL_OM", permission_code_id="analytics.operations").delete()
    data = coverage(scene)
    assert data["employees"] == []
    assert next(item for item in data["sources"] if item["code"] == "OM")["state"] == "UNAVAILABLE"


@pytest.mark.parametrize("change", ["transfer", "inactive", "delete"])
def test_old_affiliation_cannot_reveal_a_person_outside_current_scope(scene, change):
    log(scene)
    person = scene["people"][0]
    if change == "transfer":
        StaffUnit.objects.filter(employee=person).update(division=scene["other"])
    elif change == "inactive":
        person.is_active = False
        person.save(update_fields=["is_active"])
    else:
        person.delete()
    assert coverage(scene)["employees"] == []


@pytest.mark.parametrize("params", [
    {"coverage_from": "not-a-date"},
    {"coverage_from": "2026-10-14", "coverage_to": "2026-10-13"},
    {"coverage_from": "2026-10-01", "coverage_to": "2026-11-01"},
    {"coverage_from": "9999-12-31", "coverage_to": "9999-12-31"},
])
def test_invalid_or_unbounded_coverage_period_is_rejected(scene, params):
    response = scene["api"].get(LOAD, params)
    assert response.status_code == 422, response.data
    assert response.data["error_code"] == "INVALID_PERIOD"
