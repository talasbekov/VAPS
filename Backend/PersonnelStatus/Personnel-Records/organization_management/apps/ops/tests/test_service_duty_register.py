from datetime import date, datetime, timedelta, timezone
import csv
import io

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from asgiref.sync import async_to_sync

from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene, NOW, log_payload

pytestmark = pytest.mark.django_db


def entry(scene, *, employee=0, kind="GBR", first="2026-10-12T20:00:00+05:00", last="2026-10-13T08:00:00+05:00", completed=False, **extra):
    person = scene["people"][employee]
    begin, end = datetime.fromisoformat(first), datetime.fromisoformat(last)
    facts = dict(acknowledged_at=begin, actual_start=begin, actual_end=end) if completed else {}
    return OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name=f"Учётный сотрудник {employee + 1}",
        division_id=person.staff_unit.division_id, division_name=person.staff_unit.division.name,
        service_duty_code=kind, service_duty_label={"GBR": "ГБР", "KUMBEZ": "Смена Кумбез", "SAKSHY": "Смена Сакшы"}[kind],
        planned_start=begin, planned_end=end, created_by=str(scene["user"].pk), **facts, **extra)


def report(scene, api=None, **query):
    return (api or scene["manager"]).get(REGISTER, {"from": "2026-10-13", "to": "2026-10-13", **query})


def downloaded_content(response):
    assert response.streaming and response.is_async
    async def collect():
        return b"".join([chunk async for chunk in response.streaming_content])
    return async_to_sync(collect)()


def test_night_hours_are_clipped_and_overlapping_facts_are_not_counted_twice(duty_log_scene):
    scene = duty_log_scene
    entry(scene, completed=True)
    entry(scene, kind="KUMBEZ", first="2026-10-13T06:00:00+05:00", last="2026-10-13T12:00:00+05:00", completed=True)
    result = report(scene)
    assert result.status_code == 200, result.data
    data = result.data
    assert data["summary"]["record_count"] == 2
    assert data["summary"]["employee_count"] == 1
    assert data["summary"]["planned_minutes"] == 840
    assert data["summary"]["actual_minutes"] == 720
    assert data["summary"]["actual_record_minutes"] == 840
    assert data["summary"]["overlap_count"] == 2
    assert data["by_employee"][0]["actual_minutes"] == 720
    assert {row["service_duty_code"]: row["actual_record_minutes"] for row in data["by_kind"]} == {"GBR": 480, "KUMBEZ": 360}
    assert {row["period_planned_minutes"] for row in data["rows"]} == {480, 360}


def test_midnight_boundary_does_not_repeat_an_ended_shift(duty_log_scene):
    entry(duty_log_scene, first="2026-10-12T12:00:00+05:00", last="2026-10-13T00:00:00+05:00", completed=True)
    result = report(duty_log_scene)
    assert result.status_code == 200
    assert result.data["rows"] == [] and result.data["summary"]["record_count"] == 0


def test_scope_hides_rows_counts_groups_and_filter_options(duty_log_scene):
    scene = duty_log_scene
    entry(scene, completed=True)
    entry(scene, employee=1, kind="SAKSHY", completed=True)
    data = report(scene, api=scene["analyst"]).data
    assert data["summary"]["record_count"] == 1
    assert {row["employee_id"] for row in data["rows"]} == {scene["people"][0].pk}
    assert {row["id"] for row in data["filters"]["divisions"]} == {scene["first"].pk}
    assert {row["employee_id"] for row in data["filters"]["employees"]} == {scene["people"][0].pk}
    assert report(scene, division_id=scene["other"].pk).data["summary"]["record_count"] == 0


def test_missing_plan_times_and_incomplete_completed_facts_stay_unknown(duty_log_scene):
    scene = duty_log_scene
    OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Старая запись",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="COMPLETED", actual_end=NOW)
    result = report(scene)
    assert result.status_code == 200
    row = result.data["rows"][0]
    assert row["source"] == "PLAN" and row["service_duty_code"] is None
    assert row["planned_minutes"] is row["actual_minutes"] is None
    assert result.data["summary"]["unknown_planned_count"] == 1
    assert result.data["summary"]["unknown_actual_count"] == 1
    assert "INVALID_ACTUAL_FACTS" in row["attention_codes"]
    assert result.data["summary"]["planned_minutes"] is None
    for group in (result.data["by_kind"][0], result.data["by_employee"][0]):
        assert group["planned_minutes"] is None
        assert group["unknown_planned_count"] == group["unknown_actual_count"] == 1
        assert group["actual_record_minutes"] is None
    assert result.data["by_employee"][0]["actual_minutes"] is None


def test_control_flags_missing_facts_without_declaring_nonattendance(duty_log_scene):
    scene = duty_log_scene
    overdue = entry(scene, first="2026-10-13T08:00:00+05:00", last="2026-10-13T12:00:00+05:00")
    ongoing = entry(scene, kind="KUMBEZ", first="2026-10-13T08:00:00+05:00", last="2026-10-13T12:00:00+05:00",
        acknowledged_at=NOW - timedelta(hours=6), actual_start=NOW - timedelta(hours=6))
    entry(scene, kind="SAKSHY", first="2026-10-14T08:00:00+05:00", last="2026-10-14T12:00:00+05:00")
    data = report(scene).data
    assert data["summary"]["attention_count"] == 2
    codes = {row["source_id"]: row["attention_codes"] for row in data["rows"]}
    assert "MISSING_START" in codes[overdue.pk] and "MISSING_ACKNOWLEDGEMENT" in codes[overdue.pk]
    assert "MISSING_END" in codes[ongoing.pk]
    assert report(scene, attention="MISSING_END").data["summary"]["record_count"] == 1


def test_all_filters_and_pagination_use_the_same_complete_slice(duty_log_scene):
    scene = duty_log_scene
    entry(scene, completed=True, note="Архивный рапорт")
    entry(scene, kind="SAKSHY", completed=True)
    entry(scene, completed=True)
    data = report(scene, kind="GBR", state="COMPLETED", source="LOG", employee_id=scene["people"][0].pk, page_size=1).data
    assert data["summary"]["record_count"] == 2
    assert data["pagination"]["count"] == 2 and len(data["rows"]) == 1
    assert data["by_kind"][0]["record_count"] == 2
    second = report(scene, kind="GBR", page=2, page_size=1).data
    assert data["rows"][0]["id"] != second["rows"][0]["id"]
    assert report(scene, search="архивный РАПОРТ").data["summary"]["record_count"] == 1
    assert report(scene, search="%_'").data["summary"]["record_count"] == 0


def test_cancelled_records_keep_history_but_not_work_hours(duty_log_scene):
    entry(duty_log_scene, cancelled_at=NOW, cancelled_reason="Ошибочная запись")
    data = report(duty_log_scene).data
    assert data["summary"]["record_count"] == data["summary"]["cancelled_count"] == 1
    assert data["summary"]["planned_minutes"] == data["summary"]["actual_minutes"] == 0
    assert data["summary"]["attention_count"] == 0


@pytest.mark.parametrize("query", [
    {"from": "2026-10-14", "to": "2026-10-13"},
    {"from": "2025-01-01", "to": "2026-10-13"},
    {"from": "bad"}, {"to": "9999-12-31"},
    {"state": "UNKNOWN"}, {"source": "UNKNOWN"}, {"page_size": 1001},
])
def test_invalid_filter_is_a_controlled_validation_error(duty_log_scene, query):
    assert report(duty_log_scene, **query).status_code in (400, 422)


def test_csv_exports_the_filtered_slice_and_escapes_formula_text(duty_log_scene):
    scene = duty_log_scene
    entry(scene, note=" =HYPERLINK(\"bad\")", location_label="@FORMULA")
    entry(scene, kind="SAKSHY")
    response = scene["manager"].get(REGISTER + "export/", {"from": "2026-10-13", "to": "2026-10-13", "kind": "GBR"})
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(downloaded_content(response).decode("utf-8-sig")), delimiter=";"))
    assert len(rows) == 2
    assert any(cell.startswith("'") and "HYPERLINK" in cell for cell in rows[1])
    assert "text/csv" in response["Content-Type"] and "filename*=" in response["Content-Disposition"]
    denied = scene["reader"].get(REGISTER + "export/", {"from": "2026-10-13", "to": "2026-10-13", "division_id": scene["other"].pk})
    assert len(list(csv.reader(io.StringIO(downloaded_content(denied).decode("utf-8-sig")), delimiter=";"))) == 1


def source_rows(scene):
    employee = scene["people"][0]
    shift = OpsDutyShift.objects.create(employee_id=str(employee.pk), employee_name="Имя в исходном плане",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    source = OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code="DUTY",
        date_start=date(2026, 10, 12), date_end=date(2026, 10, 14))
    dispatch = OpsDutyDispatchAssignment.objects.create(employee_id=employee.pk, employee_name="Имя в расстановке",
        source_status=source, receiver_department_id=scene["other"].pk,
        placement={"kind": "GROUP", "object_name": "Объект", "group_name": "Группа"},
        start_at=datetime.fromisoformat("2026-10-12T20:00:00+05:00"),
        end_at=datetime.fromisoformat("2026-10-13T08:00:00+05:00"), created_by="source")
    return shift, dispatch, source


def test_three_sources_keep_one_row_each_and_receiver_access_does_not_open_other_rows(duty_log_scene):
    scene = duty_log_scene
    manual = entry(scene)
    shift, dispatch, _ = source_rows(scene)
    OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=shift.pk,
        employee_id=scene["people"][0].pk, employee_name="Сохранённое имя", division_id=scene["first"].pk,
        division_name=scene["first"].name, service_duty_code="SAKSHY", service_duty_label="Смена Сакшы")
    data = report(scene).data
    assert data["summary"]["record_count"] == 3
    assert {row["id"] for row in data["rows"]} == {f"LOG:{manual.pk}", f"PLAN:{shift.pk}", f"DISPATCH:{dispatch.pk}"}
    dispatcher, _ = client_for("report-receiver", "REPORT_RECEIVER", ("duty.dispatch",), scene["other"].pk)
    received = report(scene, api=dispatcher).data
    assert received["summary"]["record_count"] == 1
    assert received["rows"][0]["id"] == f"DISPATCH:{dispatch.pk}"
    assert {row["employee_id"] for row in received["filters"]["employees"]} == {scene["people"][0].pk}
    assert scene["manager"].get(REGISTER + f"DISPATCH:{dispatch.pk}/").data["actions"] == []
    assert next(row for row in data["rows"] if row["source"] == "DISPATCH")["actions"] == []


def test_source_change_is_visible_but_does_not_rewrite_the_original(duty_log_scene):
    scene = duty_log_scene
    _, dispatch, status = source_rows(scene)
    status.cancelled_at = NOW
    status.save(update_fields=["cancelled_at"])
    before = list(OpsDutyDispatchAssignment.objects.values())
    data = report(scene, source="DISPATCH").data
    assert data["summary"]["record_count"] == 1
    assert "SOURCE_CHANGED" in data["rows"][0]["attention_codes"]
    assert list(OpsDutyDispatchAssignment.objects.values()) == before


def test_unsupplemented_zero_dispatch_identity_does_not_borrow_an_employee_scope(duty_log_scene):
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit
    scene = duty_log_scene
    person = Employee.objects.create(id=0, first_name="Нулевой", last_name="Сотрудник",
        personnel_number="zero-dispatch", iin="130000000002", hire_date=date(2020, 1, 1))
    StaffUnit.objects.create(employee=person, division=scene["first"], index=90)
    status = OpsEmployeeStatus.objects.create(employee_id=0, status_type_code="DUTY", date_start=date(2026, 10, 12), date_end=date(2026, 10, 14))
    dispatch = OpsDutyDispatchAssignment.objects.create(employee_id=0, employee_name="Нулевой исходный ID", source_status=status,
        receiver_department_id=scene["other"].pk, placement={}, start_at=NOW-timedelta(hours=4), end_at=NOW, created_by="source")
    assert scene["manager"].get(REGISTER + f"DISPATCH:{dispatch.pk}/").status_code == 403
    assert report(scene, source="DISPATCH").data["summary"]["record_count"] == 0


def test_historical_scope_is_identical_for_list_and_detail_after_transfer(duty_log_scene):
    scene = duty_log_scene
    manual = entry(scene)
    shift, _, _ = source_rows(scene)
    supplement = OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=shift.pk,
        employee_id=scene["people"][0].pk, employee_name="Снимок", division_id=scene["first"].pk,
        division_name=scene["first"].name, service_duty_code="GBR", service_duty_label="ГБР")
    staff = scene["people"][0].staff_unit
    staff.division = scene["other"]
    staff.save(update_fields=["division"])
    original = report(scene).data
    assert {row["id"] for row in original["rows"]} == {f"LOG:{manual.pk}", f"PLAN:{shift.pk}"}
    foreign = report(scene, api=scene["wrong"]).data
    assert f"LOG:{manual.pk}" not in {row["id"] for row in foreign["rows"]}
    assert f"PLAN:{shift.pk}" not in {row["id"] for row in foreign["rows"]}
    assert scene["wrong"].get(REGISTER + f"PLAN:{shift.pk}/").status_code == 403


def test_numeric_legacy_id_with_leading_zeroes_uses_the_same_scope_as_detail(duty_log_scene):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id="000000000000" + str(scene["people"][0].pk),
        employee_name="Имя исходной записи", business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    assert scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/").status_code == 200
    assert report(scene, source="PLAN").data["summary"]["record_count"] == 1


@pytest.mark.parametrize("legacy_id", [0, 9223372036854775808])
def test_legacy_identity_outside_supported_bounds_is_not_joined_into_scoped_rows(duty_log_scene, legacy_id):
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit
    scene = duty_log_scene
    if legacy_id <= 9223372036854775807:
        person = Employee.objects.create(id=legacy_id, first_name="Граничный", last_name="Сотрудник",
            personnel_number="legacy-edge", iin="130000000000", hire_date=date(2020, 1, 1))
        StaffUnit.objects.create(employee=person, division=scene["first"], index=83)
    shift = OpsDutyShift.objects.create(employee_id="000" + str(legacy_id), employee_name="Граничная запись",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    assert scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/").status_code == 403
    assert report(scene, source="PLAN").data["summary"]["record_count"] == 0


@pytest.mark.parametrize("identifier", [2147483648, 9007199254740993])
def test_imported_big_identifiers_keep_exact_identity_in_choices_create_detail_and_report(duty_log_scene, identifier):
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit
    scene = duty_log_scene
    division = Division.objects.create(id=identifier, name="Дочернее подразделение", division_type="directorate", parent=scene["first"])
    person = Employee.objects.create(id=identifier, first_name="Большой", last_name="Идентификатор",
        personnel_number="big-imported-id", iin="130000000001", hire_date=date(2020, 1, 1))
    StaffUnit.objects.create(employee=person, division=division, index=84)
    wire_id = str(identifier) if identifier > 9007199254740991 else identifier
    choices = scene["manager"].get(REGISTER + "choices/", {"search": "Идентификатор"})
    assert choices.data["results"][0]["employee_id"] == wire_id
    assert choices.data["results"][0]["division_id"] == wire_id
    plan = OpsDutyShift.objects.create(employee_id=str(identifier), employee_name="Исходный импорт",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    assert scene["manager"].get(REGISTER + f"PLAN:{plan.pk}/").status_code == 200
    classified = scene["manager"].post(REGISTER + f"PLAN:{plan.pk}/classify/", {"service_duty_code": "GBR", "reason": "Уточнение вида"}, format="json")
    assert classified.status_code == 200, classified.data
    payload = log_payload(scene)
    payload["employee_id"] = str(identifier)
    created = scene["manager"].post(REGISTER, payload, format="json")
    assert created.status_code == 201, created.data
    assert created.data["employee_id"] == created.data["division_id"] == wire_id
    detail = scene["manager"].get(REGISTER + created.data["id"] + "/")
    assert detail.data["employee_id"] == detail.data["division_id"] == wire_id
    data = report(scene, employee_id=str(identifier), division_id=str(identifier)).data
    assert data["summary"]["record_count"] == 2
    assert {row["employee_id"] for row in data["rows"]} == {wire_id}
    assert data["by_employee"][0]["employee_id"] == wire_id
    assert data["filters"]["employees"][0]["employee_id"] == wire_id
    assert data["filters"]["divisions"][0]["id"] == wire_id


def test_big_source_id_stays_exact_in_the_compound_key_and_outbound_dto(duty_log_scene):
    scene = duty_log_scene
    identifier = 9007199254740993
    OpsDutyShift.objects.create(id=identifier, employee_id=str(scene["people"][0].pk), employee_name="Большой ID источника",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    detail = scene["manager"].get(REGISTER + f"PLAN:{identifier}/").data
    assert detail["id"] == f"PLAN:{identifier}" and detail["source_id"] == str(identifier)
    row = report(scene, source="PLAN").data["rows"][0]
    assert row["id"] == detail["id"] and row["source_id"] == str(identifier)


def test_unknown_legacy_identity_is_not_guessed_from_an_equal_name(duty_log_scene):
    scene = duty_log_scene
    entry(scene, completed=True)
    OpsDutyShift.objects.create(employee_id="legacy-foreign-id", employee_name="Учётный сотрудник 1",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="COMPLETED",
        actual_start=NOW-timedelta(hours=1), actual_end=NOW)
    global_reader, _ = client_for("report-global-reader", "REPORT_GLOBAL_READER", ("duty.view",))
    data = report(scene, api=global_reader).data
    assert data["summary"]["employee_count"] == 1 and len(data["by_employee"]) == 2
    unknown = next(row for row in data["rows"] if row["source"] == "PLAN")
    assert unknown["employee_id"] is None and "EMPLOYEE_UNKNOWN" in unknown["attention_codes"]
    assert report(scene).data["summary"]["record_count"] == 1


def test_pagination_does_not_grow_database_queries_with_record_count(duty_log_scene):
    scene = duty_log_scene
    first = entry(scene, completed=True)
    with CaptureQueriesContext(connection) as initial_queries:
        one = report(scene)
    duplicates = []
    for _ in range(300):
        row = OpsDutyLogEntry(**{field.attname: getattr(first, field.attname) for field in first._meta.concrete_fields if not field.primary_key})
        duplicates.append(row)
    OpsDutyLogEntry.objects.bulk_create(duplicates)
    with CaptureQueriesContext(connection) as larger_queries:
        data = report(scene, page_size=25, page=999).data
    assert data["pagination"] == {"count": 301, "page": 13, "pages": 13, "page_size": 25}
    assert len(data["rows"]) == 1 and data["summary"]["actual_minutes"] == 480
    assert len(larger_queries) <= len(initial_queries) + 2


def test_zero_duration_actual_fact_is_not_an_overlapping_interval(duty_log_scene):
    scene = duty_log_scene
    entry(scene, first="2026-10-13T08:00:00+05:00", last="2026-10-13T12:00:00+05:00", completed=True)
    stamp = datetime.fromisoformat("2026-10-13T10:00:00+05:00")
    OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Нулевая отметка",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="COMPLETED",
        actual_start=stamp, actual_end=stamp)
    data = report(scene).data
    assert data["summary"]["overlap_count"] == 0
    assert data["summary"]["actual_minutes"] == 240


def test_intersections_outside_selected_period_do_not_flag_this_period(duty_log_scene):
    scene = duty_log_scene
    for index in range(2):
        entry(scene, first=f"2026-10-13T{8+index*2:02d}:00:00+05:00", last=f"2026-10-13T{10+index*2:02d}:00:00+05:00",
            actual_start=datetime.fromisoformat(f"2026-10-12T12:{index*30:02d}:00+05:00"),
            actual_end=datetime.fromisoformat(f"2026-10-12T13:{index*30:02d}:00+05:00"))
    data = report(scene).data
    assert data["summary"]["overlap_count"] == 0
    assert data["summary"]["actual_minutes"] == 0
