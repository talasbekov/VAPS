from datetime import date, datetime, timedelta, timezone

import pytest

from organization_management.apps.operations.models_duty import OpsDutyShift, OpsDutyMonthlyPlan
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene, create_log, detail_path

pytestmark = pytest.mark.django_db


def test_existing_plan_keeps_its_execution_owner_and_classification_is_only_a_supplement(duty_log_scene):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Исходная смена",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    url = REGISTER + f"PLAN:{shift.pk}/"
    classified = scene["manager"].post(url + "classify/", {"service_duty_code": "SAKSHY", "reason": "Уточнён вид"}, format="json")
    assert classified.status_code == 200, classified.data
    assert classified.data["service_duty_label"] == "Смена Сакшы"
    assert classified.data["planned_minutes"] is None
    assert classified.data["execution_mode"] == "SERVER_TIME"
    assert scene["manager"].post(url + "acknowledge/", {}, format="json").status_code == 200
    assert scene["manager"].post(url + "start/", {"at": "2026-10-13T08:00:00+05:00"}, format="json").status_code == 422
    assert scene["manager"].post(url + "start/", {}, format="json").status_code == 200
    assert scene["manager"].post(url + "complete/", {}, format="json").status_code == 200
    shift.refresh_from_db()
    assert shift.state_code == "COMPLETED" and shift.actual_start is not None and shift.actual_end is not None
    supplement = OpsDutyRecordSupplement.objects.get(source_type="PLAN", source_id=shift.pk)
    assert supplement.acknowledged_at is supplement.actual_start is supplement.actual_end is None
    assert scene["manager"].get(url).data["history"][-1]["label"] == "Завершено"


def test_receiver_dispatch_scope_is_distinct_from_supplier_status_management(duty_log_scene):
    scene = duty_log_scene
    source = OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="DUTY",
        date_start=date(2026, 10, 12), date_end=date(2026, 10, 14))
    original = OpsDutyDispatchAssignment.objects.create(employee_id=scene["people"][0].pk,
        employee_name="Исходное имя", source_status=source, receiver_department_id=scene["other"].pk,
        placement={"kind": "GROUP", "object_name": "Объект", "group_name": "Исходная группа"},
        start_at=datetime(2026, 10, 12, 15, tzinfo=timezone.utc),
        end_at=datetime(2026, 10, 13, 3, tzinfo=timezone.utc), created_by="original")
    dispatcher, _ = client_for("register-receiver", "REGISTER_RECEIVER", ("duty.dispatch",), scene["other"].pk)
    supplier_dispatcher, _ = client_for("register-supplier", "REGISTER_SUPPLIER", ("duty.dispatch",), scene["first"].pk)
    url = REGISTER + f"DISPATCH:{original.pk}/"
    assert dispatcher.get(url).status_code == 200
    assert supplier_dispatcher.get(url).status_code == 403
    assert scene["manager"].get(url).status_code == 200
    assert scene["manager"].post(url + "acknowledge/", {}, format="json").status_code == 403
    assert dispatcher.post(url + "classify/", {"service_duty_code": "KUMBEZ", "reason": "Уточнение учёта"}, format="json").status_code == 200
    assert dispatcher.post(url + "acknowledge/", {}, format="json").status_code == 200
    assert dispatcher.post(url + "start/", {"at": "2026-10-12T20:00:00+05:00"}, format="json").status_code == 200
    done = dispatcher.post(url + "complete/", {"at": "2026-10-13T08:00:00+05:00"}, format="json")
    assert done.status_code == 200 and done.data["actual_minutes"] == 720
    original.refresh_from_db()
    assert original.employee_name == "Исходное имя"
    assert original.placement["group_name"] == "Исходная группа"
    assert original.cancelled_at is None
    assert OpsDutyRecordSupplement.objects.filter(source_type="DISPATCH", source_id=original.pk).count() == 1


def test_reclassification_preserves_reason_in_history_and_does_not_rewrite_same_kind(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    url = detail_path(row)
    assert scene["manager"].post(url + "classify/", {"service_duty_code": "SAKSHY", "reason": " "}, format="json").status_code == 400
    response = scene["manager"].post(url + "classify/", {"service_duty_code": "SAKSHY", "reason": "Ошибка классификации"}, format="json")
    assert response.status_code == 200
    detail = scene["manager"].get(url).data
    assert detail["history"][-1]["reason"] == "Ошибка классификации"
    count = len(detail["history"])
    assert scene["manager"].post(url + "classify/", {"service_duty_code": "SAKSHY", "reason": "Повтор запроса"}, format="json").status_code == 200
    assert len(scene["manager"].get(url).data["history"]) == count


def test_historical_affiliation_remains_after_employee_transfer(duty_log_scene):
    scene = duty_log_scene
    row = create_log(scene)
    staff = scene["people"][0].staff_unit
    staff.division = scene["other"]
    staff.save(update_fields=["division"])
    assert scene["manager"].get(detail_path(row)).data["division_id"] == scene["first"].pk
    assert scene["wrong"].get(detail_path(row)).status_code == 403
    assert scene["manager"].get(REGISTER + "choices/").data["results"] == []


def test_future_plan_cannot_be_started_as_a_current_fact(duty_log_scene):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Будущая смена",
        business_date=date(2026, 10, 14), duty_type_code="DAY_OWN", target={}, state_code="ACKNOWLEDGED")
    response = scene["manager"].post(REGISTER + f"PLAN:{shift.pk}/start/", {}, format="json")
    assert response.status_code == 422
    shift.refresh_from_db()
    assert shift.state_code == "ACKNOWLEDGED" and shift.actual_start is None


@pytest.mark.parametrize("start", [None, datetime(2026, 10, 14, 9, tzinfo=timezone.utc)])
def test_legacy_active_plan_requires_a_valid_start_before_completion(duty_log_scene, start):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Старая смена",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="ACTIVE", actual_start=start)
    result = scene["manager"].post(REGISTER + f"PLAN:{shift.pk}/complete/", {}, format="json")
    assert result.status_code == 422
    shift.refresh_from_db()
    assert shift.state_code == "ACTIVE" and shift.actual_end is None


def test_plan_cancellation_timestamp_is_preserved_from_its_original_source(duty_log_scene):
    scene = duty_log_scene
    stamp = "2026-10-12T12:00:00+05:00"
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Отменённая смена",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="CANCELLED",
        cancellation={"cancelledAt": stamp, "reason": "Отмена источника"})
    result = scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/")
    assert result.status_code == 200 and result.data["cancelled_at"] == stamp


@pytest.mark.parametrize("state,day,start,action", [
    ("ACKNOWLEDGED", date(2026, 10, 14), None, "start"),
    ("ACTIVE", date(2026, 10, 13), None, "complete"),
    ("ACTIVE", date(2026, 10, 13), datetime(2026, 10, 14, 9, tzinfo=timezone.utc), "complete"),
    ("ACTIVE", date(2026, 10, 14), datetime(2026, 10, 13, 8, tzinfo=timezone.utc), "complete"),
])
def test_detail_actions_match_the_guards_and_list_actions(duty_log_scene, state, day, start, action):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Проверка действий",
        business_date=day, duty_type_code="DAY_OWN", target={}, state_code=state, actual_start=start)
    detail = scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/")
    assert detail.status_code == 200, detail.data
    assert action not in detail.data["actions"]
    listing = scene["manager"].get(REGISTER, {"from": "2026-10-13", "to": "2026-10-14"})
    row = next(row for row in listing.data["rows"] if row["id"] == detail.data["id"])
    assert set(detail.data["actions"]) == set(row["actions"])


def test_completed_future_facts_remain_unknown_in_detail_as_in_the_report(duty_log_scene):
    scene = duty_log_scene
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Будущее окончание",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="COMPLETED",
        actual_start=datetime(2026, 10, 13, 8, tzinfo=timezone.utc), actual_end=datetime(2026, 10, 14, 8, tzinfo=timezone.utc))
    detail = scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/")
    assert detail.status_code == 200, detail.data
    assert detail.data["actual_minutes"] is None


def test_approved_plan_does_not_offer_a_cancellation_that_the_source_forbids(duty_log_scene):
    scene = duty_log_scene
    OpsDutyMonthlyPlan.objects.create(month="2026-10", state_code="APPROVED", revision=1, history=[])
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Утверждённая смена",
        business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    detail = scene["manager"].get(REGISTER + f"PLAN:{shift.pk}/")
    assert detail.status_code == 200, detail.data
    assert "cancel" not in detail.data["actions"]
    listing = scene["manager"].get(REGISTER, {"from": "2026-10-13", "to": "2026-10-14"})
    row = next(row for row in listing.data["rows"] if row["id"] == detail.data["id"])
    assert "cancel" not in row["actions"]
