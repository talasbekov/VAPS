from datetime import datetime, timezone

import pytest
from django.test import override_settings

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.ops.tests.service_duty_support import (
    REGISTER, NOW, duty_log_scene, log_payload, create_log, detail_path,
)

pytestmark = pytest.mark.django_db


@override_settings(TIME_ZONE="UTC", OPS_LOCAL_TIMEZONE="Asia/Qyzylorda")
def test_local_form_times_use_business_timezone_instead_of_server_default(duty_log_scene):
    scene = duty_log_scene
    payload = log_payload(scene)
    payload.update(planned_start="2026-10-12T20:00", planned_end="2026-10-13T08:00")
    result = scene["manager"].post(REGISTER, payload, format="json")
    assert result.status_code == 201, result.data
    assert result.data["planned_start"] == "2026-10-12T20:00:00+05:00"
    url = detail_path(result.data)
    assert scene["manager"].post(url + "acknowledge/", {}, format="json").status_code == 200
    begun = scene["manager"].post(url + "start/", {"at": "2026-10-12T20:00"}, format="json")
    assert begun.data["actual_start"] == "2026-10-12T20:00:00+05:00"
    done = scene["manager"].post(url + "complete/", {"at": "2026-10-13T08:00"}, format="json")
    assert done.data["actual_end"] == "2026-10-13T08:00:00+05:00"


def test_history_names_the_author_without_replacing_the_stored_identifier(duty_log_scene):
    scene = duty_log_scene
    scene["user"].first_name = "Автор"
    scene["user"].last_name = "Проверки"
    scene["user"].save(update_fields=["first_name", "last_name"])
    row = create_log(scene)
    detail = scene["manager"].get(detail_path(row)).data
    assert detail["created_by"] == str(scene["user"].pk)
    assert detail["history"][0]["actor"] == "Автор Проверки"
    assert detail["history"][0]["actor_id"] == str(scene["user"].pk)


def test_create_administrative_log_keeps_employee_and_kind_snapshots(duty_log_scene):
    scene = duty_log_scene
    old_counts = (OpsEmployeeStatus.objects.count(), EmployeeStatus.objects.count())
    row = create_log(scene)
    assert row["source"] == "LOG" and row["id"].startswith("LOG:")
    assert row["service_duty_label"] == "ГБР"
    assert row["division_id"] == scene["first"].pk
    assert row["state"] == "PLANNED" and row["actual_start"] is None
    assert row["planned_minutes"] == 720
    assert row["actual_minutes"] is None
    assert old_counts == (OpsEmployeeStatus.objects.count(), EmployeeStatus.objects.count())
    OpsDictionaryEntry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="GBR").update(label="Другая подпись")
    scene["people"][0].last_name = "Изменённая"
    scene["people"][0].save(update_fields=["last_name"])
    saved = scene["manager"].get(detail_path(row))
    assert saved.status_code == 200
    assert saved.data["service_duty_label"] == "ГБР"
    assert saved.data["employee_name"] == row["employee_name"]


def test_read_and_write_are_restricted_to_real_division_scope(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    assert scene["wrong"].get(detail_path(row)).status_code == 403
    assert scene["wrong"].post(detail_path(row) + "acknowledge/", {}, format="json").status_code == 403
    assert scene["wrong"].post(REGISTER, log_payload(scene), format="json").status_code == 403
    assert scene["reader"].post(REGISTER, log_payload(scene), format="json").status_code == 403
    assert scene["analyst"].get(detail_path(row)).status_code == 200
    assert scene["analyst"].post(detail_path(row) + "acknowledge/", {}, format="json").status_code == 403
    assert OpsDutyLogEntry.objects.count() == 1


def test_record_options_do_not_disclose_other_division_or_inactive_employees(duty_log_scene):
    scene = duty_log_scene
    result = scene["manager"].get(REGISTER + "choices/")
    assert result.status_code == 200
    assert [row["employee_id"] for row in result.data["results"]] == [scene["people"][0].pk]
    assert scene["reader"].get(REGISTER + "choices/").status_code == 403
    scene["people"][0].is_active = False
    scene["people"][0].save(update_fields=["is_active"])
    assert scene["manager"].get(REGISTER + "choices/").data["results"] == []


def test_duty_names_can_be_read_without_dictionary_administration(duty_log_scene):
    result = duty_log_scene["manager"].get(REGISTER + "kinds/")
    assert result.status_code == 200
    assert {"GBR", "SAKSHY", "KUMBEZ"} <= {row["code"] for row in result.data["results"]}
    assert all("usage" not in row for row in result.data["results"])


@pytest.mark.parametrize("changes", [
    {"service_duty_code": "UNKNOWN"},
    {"planned_end": "2026-10-12T20:00:00+05:00"},
    {"planned_start": "2026-10-14T20:00:00+05:00"},
])
def test_invalid_record_is_not_saved(duty_log_scene, changes):
    payload = log_payload(duty_log_scene)
    payload.update(changes)
    result = duty_log_scene["manager"].post(REGISTER, payload, format="json")
    assert result.status_code in (400, 422), result.data
    assert OpsDutyLogEntry.objects.count() == 0


def test_inactive_kind_is_retained_for_history_but_cannot_be_chosen(duty_log_scene):
    row = create_log(duty_log_scene)
    OpsDictionaryEntry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="GBR").update(is_active=False)
    result = duty_log_scene["manager"].post(REGISTER, log_payload(duty_log_scene), format="json")
    assert result.status_code == 422
    assert duty_log_scene["manager"].get(detail_path(row)).data["service_duty_label"] == "ГБР"


def test_execution_is_explicit_audited_and_retry_does_not_rewrite_facts(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    assert scene["manager"].post(url + "start/", {}, format="json").status_code == 422
    acknowledged = scene["manager"].post(url + "acknowledge/", {}, format="json")
    assert acknowledged.status_code == 200 and acknowledged.data["state"] == "ACKNOWLEDGED"
    again = scene["manager"].post(url + "acknowledge/", {}, format="json")
    assert again.data["acknowledged_at"] == acknowledged.data["acknowledged_at"]
    started = scene["manager"].post(url + "start/", {"at": "2026-10-12T20:00:00+05:00"}, format="json")
    assert started.status_code == 200 and started.data["state"] == "ACTIVE"
    ended = scene["manager"].post(url + "complete/", {"at": "2026-10-13T08:00:00+05:00"}, format="json")
    assert ended.status_code == 200 and ended.data["state"] == "COMPLETED"
    assert ended.data["actual_minutes"] == 720
    repeated = scene["manager"].post(url + "complete/", {}, format="json")
    assert repeated.status_code == 200
    assert repeated.data["actual_end"] == ended.data["actual_end"]
    assert ended.data["completed_by"] == str(scene["user"].pk)
    assert OpsAuditLog.objects.filter(action__in=("DUTY_LOG_CREATED", "DUTY_LOG_ACKNOWLEDGED", "DUTY_LOG_STARTED", "DUTY_LOG_COMPLETED")).count() == 4


def test_actual_times_cannot_be_in_the_future_or_end_before_start(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    scene["manager"].post(url + "acknowledge/", {}, format="json")
    assert scene["manager"].post(url + "start/", {"at": "2026-10-14T09:00:00+05:00"}, format="json").status_code == 422
    assert scene["manager"].post(url + "start/", {"at": "2026-10-13T08:00:00+05:00"}, format="json").status_code == 200
    assert scene["manager"].post(url + "complete/", {"at": "2026-10-13T07:59:00+05:00"}, format="json").status_code == 422
    assert scene["manager"].post(url + "complete/", {"at": "2026-10-14T09:00:00+05:00"}, format="json").status_code == 422
    assert scene["manager"].get(url).data["state"] == "ACTIVE"


def test_cancel_keeps_record_reason_and_blocks_execution(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    assert scene["manager"].post(url + "cancel/", {"reason": " "}, format="json").status_code == 400
    result = scene["manager"].post(url + "cancel/", {"reason": "Запись внесена ошибочно"}, format="json")
    assert result.status_code == 200 and result.data["state"] == "CANCELLED"
    assert result.data["cancelled_reason"] == "Запись внесена ошибочно"
    assert scene["manager"].post(url + "acknowledge/", {}, format="json").status_code == 422
    assert OpsDutyLogEntry.objects.count() == 1
    assert OpsAuditLog.objects.filter(action="DUTY_LOG_CANCELLED").count() == 1


def test_repeated_creation_request_does_not_create_another_record(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    first = scene["manager"].post(REGISTER, body, format="json")
    assert first.status_code == 201
    repeated = scene["manager"].post(REGISTER, body, format="json")
    assert repeated.status_code == 200 and repeated.data["id"] == first.data["id"]
    body["note"] = "Иная запись"
    assert scene["manager"].post(REGISTER, body, format="json").status_code == 409
    assert OpsDutyLogEntry.objects.count() == 1


def test_status_manager_can_log_only_own_employees_without_changing_statuses(duty_log_scene):
    scene = duty_log_scene
    api, _ = client_for("status-log-manager", "STATUS_LOG_MANAGER", ("status.manage",), scene["first"].pk)
    assert api.post(REGISTER, log_payload(scene), format="json").status_code == 201
    body = log_payload(scene)
    body["employee_id"] = scene["people"][1].pk
    assert api.post(REGISTER, body, format="json").status_code == 403


def test_planned_record_can_be_corrected_with_revision_and_reason(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    result = scene["manager"].patch(url, {"expected_revision": 1, "reason": "Уточнено время",
        "planned_end": "2026-10-13T09:00:00+05:00", "note": "Исправленная запись"}, format="json")
    assert result.status_code == 200, result.data
    assert result.data["planned_minutes"] == 780
    assert result.data["note"] == "Исправленная запись" and result.data["revision"] == 2
    stale = scene["manager"].patch(url, {"expected_revision": 1, "reason": "Другая правка", "note": "Устаревшая форма"}, format="json")
    assert stale.status_code == 409
    detail = scene["manager"].get(url).data
    assert detail["note"] == "Исправленная запись" and detail["history"][-1]["reason"] == "Уточнено время"
    assert scene["wrong"].patch(url, {"expected_revision": 2, "reason": "Чужая правка", "note": "Чужое"}, format="json").status_code == 403


def test_started_record_does_not_allow_planning_edits(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    scene["manager"].post(url + "acknowledge/", {}, format="json")
    scene["manager"].post(url + "start/", {}, format="json")
    revision = scene["manager"].get(url).data.get("revision", 3)
    result = scene["manager"].patch(url, {"expected_revision": revision, "reason": "После начала", "note": "Правка"}, format="json")
    assert result.status_code == 422
    assert scene["manager"].get(url).data["note"] == row["note"]


@pytest.mark.parametrize("first,last", [
    ("0001-01-01T00:00:00+05:00", "0001-01-01T01:00:00+05:00"),
    ("9999-12-31T22:00:00+00:00", "9999-12-31T23:00:00+00:00"),
    ("2026-01-01T00:00:00+05:00", "2027-01-02T01:00:00+05:00"),
])
def test_unsupported_or_overlong_interval_is_a_validation_error(duty_log_scene, first, last):
    body = log_payload(duty_log_scene)
    body.update(planned_start=first, planned_end=last)
    result = duty_log_scene["manager"].post(REGISTER, body, format="json")
    assert result.status_code in (400, 422)
    assert OpsDutyLogEntry.objects.count() == 0


def test_edit_does_not_bypass_interval_length_validation(duty_log_scene):
    row = create_log(duty_log_scene)
    result = duty_log_scene["manager"].patch(detail_path(row), {"expected_revision": 1,
        "reason": "Проверка интервала", "planned_end": "2028-01-01T00:00:00+05:00"}, format="json")
    assert result.status_code == 422
    assert duty_log_scene["manager"].get(detail_path(row)).data["planned_minutes"] == 720


def test_creation_retry_rechecks_historical_record_scope_after_role_change(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    saved = scene["manager"].post(REGISTER, body, format="json")
    assert saved.status_code == 201
    staff = scene["people"][0].staff_unit
    staff.division = scene["other"]
    staff.save(update_fields=["division"])
    UserRole.objects.filter(user_id=str(scene["user"].pk), role_code_id="LOG_MANAGER").update(is_active=False)
    RoleAdminService.assign_role(str(scene["user"].pk), "LOG_MANAGER", scene["other"].pk, actor="test")
    assert scene["manager"].get(detail_path(saved.data)).status_code == 403
    assert scene["manager"].post(REGISTER, body, format="json").status_code == 403
    assert OpsDutyLogEntry.objects.count() == 1
