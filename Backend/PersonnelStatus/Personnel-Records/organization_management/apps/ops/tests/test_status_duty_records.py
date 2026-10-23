"""Personnel exits share journal facts without moving or inventing the source."""
from datetime import date, datetime

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment, OpsDutyDispatchConfig
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsObjectSector, OpsSecurityPost
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene
from organization_management.apps.statuses.application.services import StatusApplicationService

pytestmark = pytest.mark.django_db
SELF = "/api/ops/personal-duty/"
EXITS = [
    {"start_at": "2026-10-13T08:00:00+05:00", "end_at": "2026-10-13T10:00:00+05:00"},
    {"start_at": "2026-10-13T23:00:00+05:00", "end_at": "2026-10-14T01:00:00+05:00"},
]


@pytest.fixture(autouse=True)
def status_catalog():
    call_command("seed_status_types", verbosity=0)


def source(scene, *, intervals=EXITS, person=None):
    obj = OpsSecurityObject.objects.create(name="Объект", code=f"EXITS-{OpsSecurityObject.objects.count()+1}", object_type="BUILDING",
        region="Регион", address="Адрес", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Сектор", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Пост", position=1)
    placement = {"kind": "POST", "object_id": str(obj.pk), "post_id": str(post.pk)}
    if intervals is not None:
        placement.update(intervals=intervals, time_zone="Asia/Almaty")
    return StatusApplicationService().create_status(employee_id=(person or scene["people"][0]).pk,
        status_type="on_duty", start_date=date(2026, 10, 13), end_date=date(2026, 10, 14), duty_assignment=placement)


def rows(scene, **query):
    response = scene["manager"].get(REGISTER, {"from": "2026-10-13", "to": "2026-10-14", "source": "STATUS", **query})
    assert response.status_code == 200, response.data
    return response.data


def path(row, action=""):
    return REGISTER + row["id"] + "/" + (action + "/" if action else "")


def own_client(scene):
    api, user = client_for("exit-self", "EXIT_SELF", (), None)
    person = scene["people"][0]
    person.user = user
    person.save(update_fields=["user"])
    return api


def first_exit(scene):
    return next(row for row in rows(scene)["rows"] if datetime.fromisoformat(row["planned_start"]) == datetime.fromisoformat("2026-10-13T08:00:00+05:00"))


def test_each_exact_exit_has_independent_journal_identity_and_get_creates_no_facts(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    result = rows(scene)
    assert result["summary"]["record_count"] == 2
    assert result["summary"]["planned_minutes"] == 240
    assert result["summary"]["actual_minutes"] == 0
    assert len({r["id"] for r in result["rows"]}) == 2
    for row in result["rows"]:
        assert row["id"].startswith(f"STATUS:{saved.pk}:")
        assert len(row["id"].rsplit(":", 1)[1]) == 64
        assert row["source_id"] == saved.pk
        assert row["state"] == "PLANNED"
        assert row["actual_start"] is row["actual_end"] is row["acknowledged_at"] is None
        assert "acknowledge" in row["actions"] and "cancel" not in row["actions"]
    assert not OpsDutyRecordSupplement.objects.exists()
    assert not OpsDutyLogEntry.objects.exists()
    clipped = rows(scene, **{"from": "2026-10-14", "to": "2026-10-14"})
    assert len(clipped["rows"]) == 1
    assert clipped["summary"]["planned_minutes"] == 60


@pytest.mark.parametrize("intervals,count", [(None, 1), ([], 0)])
def test_unknown_hours_stay_unknown_and_explicit_empty_schedule_has_no_exit(duty_log_scene, intervals, count):
    scene = duty_log_scene
    source(scene, intervals=intervals)
    data = rows(scene)
    assert len(data["rows"]) == count
    if count:
        row = data["rows"][0]
        assert row["planned_start"] is row["planned_end"] is row["planned_minutes"] is None
        assert row["actions"] == []
        assert scene["manager"].post(path(row, "acknowledge"), {}, format="json").status_code == 409


def test_explicit_facts_follow_existing_stages_and_do_not_start_another_exit(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    original = dict(saved.duty_assignment)
    row = first_exit(scene)
    assert scene["manager"].post(path(row, "start"), {}, format="json").status_code == 422
    acknowledged = scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    assert acknowledged.status_code == 200, acknowledged.data
    assert acknowledged.data["state"] == "ACKNOWLEDGED" and acknowledged.data["actual_start"] is None
    future = scene["manager"].post(path(row, "start"), {"at": "2026-10-14T08:00:00+05:00"}, format="json")
    assert future.status_code == 422
    started = scene["manager"].post(path(row, "start"), {"at": "2026-10-13T08:05:00+05:00"}, format="json")
    assert started.status_code == 200, started.data
    finished = scene["manager"].post(path(row, "complete"), {"at": "2026-10-13T09:55:00+05:00"}, format="json")
    assert finished.status_code == 200, finished.data
    assert finished.data["actual_minutes"] == 110
    assert finished.data["state"] == "COMPLETED"
    assert next(r for r in rows(scene)["rows"] if r["id"] != row["id"])["state"] == "PLANNED"
    assert OpsDutyRecordSupplement.objects.count() == 1
    saved.refresh_from_db()
    assert saved.duty_assignment == original
    assert not OpsDutyLogEntry.objects.exists()
    detail = scene["manager"].get(path(row))
    assert detail.status_code == 200 and len(detail.data["history"]) == 3


def test_changed_post_retains_original_facts_as_history_without_rebinding(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    scene["manager"].post(path(row, "start"), {"at": "2026-10-13T08:05:00+05:00"}, format="json")
    original_post = OpsSecurityPost.objects.get(pk=int(saved.duty_assignment["post_id"]))
    other = OpsSecurityPost.objects.create(sector=original_post.sector, name="Другой пост", position=2)
    saved.duty_assignment = {**saved.duty_assignment, "post_id": str(other.pk), "post_name": other.name}
    saved.save()
    data = rows(scene)
    historical = next(r for r in data["rows"] if r["id"] == row["id"])
    assert historical["state"] == "CANCELLED" and historical["actual_start"] is not None
    assert "SOURCE_CHANGED" in historical["attention_codes"] and historical["actions"] == []
    current = [r for r in data["rows"] if r["id"] != row["id"]]
    assert len(current) == 2 and all(r["actual_start"] is None for r in current)
    assert scene["manager"].post(path(row, "complete"), {}, format="json").status_code == 409
    historical_detail = scene["manager"].get(path(row))
    assert historical_detail.status_code == 200
    assert historical_detail.data["location_label"] == "Объект · Пост"
    assert historical_detail.data["actions"] == []


def test_canonical_override_removes_unconfirmed_exit_and_guards_started_history(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="SICK_LEAVE",
        date_start=date(2026, 10, 13), date_end=date(2026, 10, 15))
    data = rows(scene)
    assert len(data["rows"]) == 1
    assert data["rows"][0]["id"] == row["id"]
    assert data["rows"][0]["state"] == "CANCELLED"
    assert scene["manager"].post(path(row, "start"), {}, format="json").status_code == 409


def test_reordering_exits_preserves_fact_identity_but_changed_time_does_not(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    saved.duty_assignment = {**saved.duty_assignment, "intervals": list(reversed(EXITS))}
    saved.save()
    assert next(r for r in rows(scene)["rows"] if r["id"] == row["id"])["state"] == "ACKNOWLEDGED"
    saved.duty_assignment = {**saved.duty_assignment, "intervals": [
        {"start_at": "2026-10-13T08:30:00+05:00", "end_at": "2026-10-13T10:00:00+05:00"}, EXITS[1]]}
    saved.save()
    data = rows(scene)
    assert next(r for r in data["rows"] if r["id"] == row["id"])["state"] == "CANCELLED"
    changed = next(r for r in data["rows"] if datetime.fromisoformat(r["planned_start"]) == datetime.fromisoformat("2026-10-13T08:30:00+05:00"))
    assert changed["id"] != row["id"] and changed["acknowledged_at"] is None


def test_exit_ending_at_midnight_is_not_repeated_on_next_day(duty_log_scene):
    scene = duty_log_scene
    source(scene, intervals=[{"start_at": "2026-10-13T23:00:00+05:00", "end_at": "2026-10-14T00:00:00+05:00"}])
    assert rows(scene, **{"from": "2026-10-14", "to": "2026-10-14"})["rows"] == []


def test_source_cancellation_does_not_show_an_active_exit_or_erase_existing_fact(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    saved.state = "cancelled"
    saved.save()
    data = rows(scene)
    assert len(data["rows"]) == 1 and data["rows"][0]["state"] == "CANCELLED"
    assert data["rows"][0]["acknowledged_at"] is not None
    assert data["summary"]["active_count"] == 0
    assert data["summary"]["planned_minutes"] == 0


def test_historical_scope_does_not_grant_write_to_transferred_employee(duty_log_scene):
    scene = duty_log_scene
    source(scene)
    row = first_exit(scene)
    assert scene["reader"].post(path(row, "acknowledge"), {}, format="json").status_code == 403
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    unit = scene["people"][0].staff_unit
    unit.division = scene["other"]
    unit.save(update_fields=["division"])
    assert scene["manager"].get(path(row)).status_code == 200
    assert scene["manager"].post(path(row, "start"), {}, format="json").status_code == 403
    assert scene["wrong"].get(path(row)).status_code == 403


def test_personal_endpoint_is_strict_self_read_only_and_keeps_future_night_exit(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    source(scene, person=scene["people"][1])
    api = own_client(scene)
    response = api.get(SELF)
    assert response.status_code == 200, getattr(response, "data", None)
    assert response.data["employeeId"] == str(scene["people"][0].pk)
    assert response.data["unlinkedReason"] is None
    assert len(response.data["results"]) == 1
    row = response.data["results"][0]
    assert row["source_id"] == saved.pk and row["source_state"] == "PLANNED"
    assert row["planned_start"] == "2026-10-13T23:00:00+05:00"
    assert row["planned_end"] == "2026-10-14T01:00:00+05:00"
    assert row["senior"] is row["instruction"] is None and row["readOnly"] is True
    assert api.get(SELF, {"employee_id": scene["people"][1].pk}).status_code == 400
    assert api.post(SELF, {}, format="json").status_code == 405
    assert not OpsDutyRecordSupplement.objects.exists()
    assert api.get(path({"id": row["id"]})).status_code == 403
    assert APIClient().get(SELF).status_code in (401, 403)


def test_personal_endpoint_preserves_unknown_current_period_and_missing_link_reason(duty_log_scene):
    scene = duty_log_scene
    source(scene, intervals=None)
    response = own_client(scene).get(SELF)
    assert response.status_code == 200, getattr(response, "data", None)
    row = response.data["results"][0]
    assert row["planned_start"] is row["planned_end"] is None
    assert row["date_start"] == "2026-10-13" and row["date_end"] == "2026-10-14"
    unlinked = scene["wrong"].get(SELF)
    assert unlinked.status_code == 200
    assert unlinked.data["employeeId"] is None and unlinked.data["results"] == []
    assert unlinked.data["unlinkedReason"]


def test_today_preset_uses_server_business_date_and_rejects_ambiguous_period(duty_log_scene):
    scene = duty_log_scene
    source(scene)
    response = scene["manager"].get(REGISTER, {"preset": "TODAY", "page_size": 5})
    assert response.status_code == 200, response.data
    assert response.data["period"] == {"from": "2026-10-13", "to": "2026-10-13"}
    assert len(response.data["rows"]) == 2
    assert scene["manager"].get(REGISTER, {"preset": "TODAY", "from": "2026-10-13", "to": "2026-10-13"}).status_code == 400


def test_control_counts_separate_assignments_acknowledgements_and_explicit_late_start(duty_log_scene):
    scene = duty_log_scene
    source(scene)
    row = first_exit(scene)
    initial = rows(scene)
    assert initial["control"] == {"assigned": 2, "acknowledged": 0, "started": 0,
        "missing_start": 1, "late_start": 0, "missing_end": 0}
    scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    scene["manager"].post(path(row, "start"), {"at": "2026-10-13T08:05:00+05:00"}, format="json")
    result = rows(scene)
    late = next(r for r in result["rows"] if r["id"] == row["id"])
    assert "LATE_START" in late["attention_codes"]
    assert result["control"] == {"assigned": 2, "acknowledged": 1, "started": 1,
        "missing_start": 0, "late_start": 1, "missing_end": 1}


def test_future_imported_timestamps_are_not_counted_as_confirmed_presence(duty_log_scene):
    scene = duty_log_scene
    person = scene["people"][0]
    future = datetime.fromisoformat("2026-10-14T08:00:00+05:00")
    OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник",
        division_id=scene["first"].pk, division_name=scene["first"].name,
        service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
        planned_start=datetime.fromisoformat("2026-10-13T08:00:00+05:00"),
        planned_end=datetime.fromisoformat("2026-10-13T18:00:00+05:00"),
        acknowledged_at=future, actual_start=future)
    response = scene["manager"].get(REGISTER, {"preset": "TODAY"})
    assert response.status_code == 200, response.data
    assert response.data["control"]["acknowledged"] == response.data["control"]["started"] == 0
    assert response.data["control"]["late_start"] == 0


def test_self_dispatch_context_queries_only_the_requested_person(duty_log_scene):
    from organization_management.apps.ops.duty_dispatch import DutyContext
    scene = duty_log_scene
    source(scene)
    source(scene, person=scene["people"][1])
    own, other = scene["people"]
    context = DutyContext(date(2026, 10, 13), date(2026, 10, 14), employee_ids={own.pk})
    assert set(context.people) == {own.pk}
    assert set(context.legacy) == {own.pk}
    assert set(context.statuses) == {own.pk}
    assert context.winner(own.pk, date(2026, 10, 13))["source_ref"].startswith("personnel:")
    assert context.winner(other.pk, date(2026, 10, 13)) is None


def test_personal_reader_keeps_own_plan_and_log_sources_without_duty_permission(duty_log_scene):
    scene = duty_log_scene
    for index, person in enumerate(scene["people"]):
        OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник",
            division_id=person.staff_unit.division_id, division_name=person.staff_unit.division.name,
            service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
            planned_start=datetime.fromisoformat("2026-10-13T22:00:00+05:00"),
            planned_end=datetime.fromisoformat("2026-10-14T02:00:00+05:00"), location_label=f"Личный журнал {index}")
        OpsDutyShift.objects.create(employee_id=str(person.pk), employee_name="Сотрудник",
            business_date=date(2026, 10, 14), duty_type_code="DAY_OWN", target={"safeLabel": f"План {index}"}, state_code="PLANNED")
    response = own_client(scene).get(SELF)
    assert response.status_code == 200, response.data
    assert {row["source"] for row in response.data["results"]} == {"LOG", "PLAN"}
    assert {row["object_label"] for row in response.data["results"]} == {"Личный журнал 0", "План 0"}
    assert next(row for row in response.data["results"] if row["source"] == "PLAN")["planned_start"] is None


def test_personal_dispatch_requires_the_current_receiver_and_available_post(duty_log_scene):
    scene = duty_log_scene
    legacy = source(scene)
    legacy.state = "cancelled"
    legacy.save()
    allocation = OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="DUTY",
        date_start=date(2026, 10, 13), date_end=date(2026, 10, 15))
    config = OpsDutyDispatchConfig.objects.create(singleton_key=1, receiver_department_id=scene["other"].pk)
    OpsDutyDispatchAssignment.objects.create(employee_id=scene["people"][0].pk, employee_name="Сотрудник",
        source_status=allocation, receiver_department_id=scene["other"].pk, placement=legacy.duty_assignment,
        start_at=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), end_at=datetime.fromisoformat("2026-10-14T02:00:00+05:00"), created_by="test")
    api = own_client(scene)
    response = api.get(SELF)
    assert response.status_code == 200, response.data
    assert [row["source"] for row in response.data["results"]] == ["DISPATCH"]
    config.receiver_department_id = scene["first"].pk
    config.save(update_fields=["receiver_department_id"])
    assert api.get(SELF).data["results"] == []
    config.receiver_department_id = scene["other"].pk
    config.save(update_fields=["receiver_department_id"])
    OpsSecurityObject.objects.filter(pk=int(legacy.duty_assignment["object_id"])).update(object_state="ARCHIVED")
    assert api.get(SELF).data["results"] == []


def test_status_read_never_joins_new_fact_from_a_transferred_employee(duty_log_scene, monkeypatch):
    from organization_management.apps.ops import duty_register
    from organization_management.apps.staff_unit.models import StaffUnit
    scene = duty_log_scene
    source(scene)
    row = first_exit(scene)
    original = duty_register.register_cte

    def capture_then_transfer(actor, query):
        captured = original(actor, query)
        StaffUnit.objects.filter(employee_id=scene["people"][0].pk).update(division_id=scene["other"].pk)
        result = scene["wrong"].post(path(row, "acknowledge"), {}, format="json")
        assert result.status_code == 200, result.data
        return captured

    monkeypatch.setattr(duty_register, "register_cte", capture_then_transfer)
    captured = next(r for r in rows(scene)["rows"] if r["id"] == row["id"])
    assert captured["state"] == "PLANNED" and captured["acknowledged_at"] is None


def test_completed_hours_survive_a_changed_source_without_becoming_current(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    for action, payload in [("acknowledge", {}), ("start", {"at": "2026-10-13T08:05:00+05:00"}), ("complete", {"at": "2026-10-13T09:55:00+05:00"})]:
        assert scene["manager"].post(path(row, action), payload, format="json").status_code == 200
    post = OpsSecurityPost.objects.get(pk=int(saved.duty_assignment["post_id"]))
    other = OpsSecurityPost.objects.create(sector=post.sector, name="Новый пост", position=2)
    saved.duty_assignment = {**saved.duty_assignment, "post_id": str(other.pk), "post_name": other.name}
    saved.save()
    data = rows(scene)
    history = next(r for r in data["rows"] if r["id"] == row["id"])
    assert history["state"] == "CANCELLED" and history["actions"] == []
    assert history["actual_minutes"] == 110
    assert data["summary"]["actual_minutes"] == data["summary"]["actual_record_minutes"] == 110
    assert data["summary"]["confirmed_actual_count"] == 1
    assert data["control"]["assigned"] == 2 and data["control"]["started"] == 0
    assert scene["manager"].get(path(row)).data["actual_minutes"] == 110


def test_current_page_ignores_invalid_active_rows_before_pagination(duty_log_scene):
    scene = duty_log_scene
    person = scene["people"][0]
    for index in range(7):
        OpsDutyShift.objects.create(employee_id=str(person.pk), employee_name=f"Строка {index}",
            business_date=date(2026, 10, 13), duty_type_code="DAY_OWN", target={}, state_code="ACTIVE",
            actual_start=(datetime.fromisoformat("2026-10-13T08:00:00+05:00") if index == 0 else
                datetime.fromisoformat("2026-10-14T08:00:00+05:00") if index % 2 else None))
    response = scene["manager"].get(REGISTER, {"preset": "TODAY", "state": "ACTIVE", "page_size": 5})
    assert response.status_code == 200, response.data
    assert response.data["pagination"]["count"] == response.data["summary"]["active_count"] == 1
    assert [row["employee_name"] for row in response.data["rows"]] == ["Строка 0"]
    all_rows = scene["manager"].get(REGISTER, {"preset": "TODAY"}).data
    assert all_rows["summary"]["active_count"] == 1
    assert all_rows["summary"]["record_count"] == 7
    assert sum("INVALID_ACTUAL_FACTS" in row["attention_codes"] for row in all_rows["rows"]) == 6


@pytest.mark.django_db(transaction=True)
def test_outer_register_read_keeps_one_canonical_snapshot_during_override(duty_log_scene, monkeypatch):
    from threading import Thread
    from django.db import close_old_connections
    from organization_management.apps.ops import personnel_duty_records
    from organization_management.apps.statuses.models import EmployeeStatus
    scene = duty_log_scene
    source(scene)
    original = personnel_duty_records._bounded
    changed, errors = [], []

    def override():
        close_old_connections()
        try:
            OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="SICK_LEAVE",
                date_start=date(2026, 10, 13), date_end=date(2026, 10, 15))
        except Exception as error:
            errors.append(error)
        finally:
            close_old_connections()

    def interleave(query):
        values = original(query)
        if query.model is EmployeeStatus and not changed:
            changed.append(True)
            worker = Thread(target=override)
            worker.start()
            worker.join(5)
            assert not worker.is_alive() and not errors
        return values

    monkeypatch.setattr(personnel_duty_records, "_bounded", interleave)
    assert len(rows(scene)["rows"]) == 2
    monkeypatch.setattr(personnel_duty_records, "_bounded", original)
    assert rows(scene)["rows"] == []


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("writer", ["status", "transfer"])
def test_fact_write_serializes_with_priority_status_and_transfer(duty_log_scene, monkeypatch, writer):
    from threading import Event, Thread
    from django.db import close_old_connections
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations.status_types import StatusType
    from organization_management.apps.ops import duty_log
    from organization_management.apps.staff_unit.models import StaffUnit
    scene = duty_log_scene
    source(scene)
    StatusType.objects.create(code="DUTY_REVIEW_OVERRIDE", name="Приоритетная проверка", priority=5, report_column_code="OTHER")
    row = first_exit(scene)
    started, acquired = Event(), Event()
    errors, observed, workers = [], [], []
    original = duty_log.ensure_supplement
    employee_lock = status_service._lock_employee

    def observed_lock(employee_id):
        started.set()
        result = employee_lock(employee_id)
        acquired.set()
        return result

    def concurrent_change():
        close_old_connections()
        try:
            if writer == "status":
                status_service.create_status(employee_id=scene["people"][0].pk, status_type_code="DUTY_REVIEW_OVERRIDE",
                    date_start=date(2026, 10, 13), date_end=date(2026, 10, 15), actor="test",
                    override=True, override_reason="Проверка гонки")
            else:
                started.set()
                StaffUnit.objects.filter(employee_id=scene["people"][0].pk).update(division_id=scene["other"].pk)
                acquired.set()
        except Exception as error:
            errors.append(error)
            started.set()
        finally:
            close_old_connections()

    def interleave(*args):
        worker = Thread(target=concurrent_change)
        workers.append(worker)
        worker.start()
        assert started.wait(5)
        observed.append(acquired.wait(1))
        return original(*args)

    monkeypatch.setattr(status_service, "_lock_employee", observed_lock)
    monkeypatch.setattr(duty_log, "ensure_supplement", interleave)
    response = scene["manager"].post(path(row, "acknowledge"), {}, format="json")
    for worker in workers:
        worker.join(5)
        assert not worker.is_alive()
    assert response.status_code == 200, response.data
    assert not errors
    assert observed == [False]
    assert acquired.is_set()


def personal_ack_path(row):
    return SELF + row["id"] + "/acknowledge/"


def personal_ack_body(row):
    return {"token": row.get("acknowledgementToken", "0" * 64)}


def test_self_acknowledgement_is_idempotent_intent_without_start_or_allocation_write(duty_log_scene):
    from organization_management.apps.operations.models_audit import OpsAuditLog
    scene = duty_log_scene
    saved = source(scene)
    original = dict(saved.duty_assignment)
    api = own_client(scene)
    row = api.get(SELF).data["results"][0]
    assert "canAcknowledge" in row and row["canAcknowledge"] is True
    assert isinstance(row.get("acknowledgementToken"), str) and len(row["acknowledgementToken"]) == 64
    audit_before = OpsAuditLog.objects.count()
    response = api.post(personal_ack_path(row), personal_ack_body(row), format="json")
    assert response.status_code == 200, getattr(response, "data", None)
    acknowledged = response.data["record"]
    assert acknowledged["source_state"] == "ACKNOWLEDGED" and acknowledged["acknowledged_at"]
    assert acknowledged["actual_start"] is acknowledged["actual_end"] is None
    assert acknowledged["canAcknowledge"] is False and acknowledged["readOnly"] is True
    repeated = api.post(personal_ack_path(row), personal_ack_body(row), format="json")
    assert repeated.status_code == 200
    assert repeated.data["record"]["acknowledged_at"] == acknowledged["acknowledged_at"]
    assert OpsAuditLog.objects.count() == audit_before + 1
    saved.refresh_from_db()
    assert saved.duty_assignment == original
    assert not OpsDutyLogEntry.objects.exists()
    assert api.post(path(row, "start"), {}, format="json").status_code == 403
    assert api.post(SELF + row["id"] + "/start/", {}, format="json").status_code in (403, 404, 405)


@pytest.mark.parametrize("body", [
    {"at": "2026-10-14T08:00:00+05:00"}, {"employee_id": "1"},
    {"actual_start": "2026-10-14T08:00:00+05:00"}, {"actual_end": None},
    {"service_duty_code": "GBR"}, {"source": "LOG"}, [],
])
def test_self_acknowledgement_rejects_body_overrides(duty_log_scene, body):
    scene = duty_log_scene
    source(scene)
    api = own_client(scene)
    row = api.get(SELF).data["results"][0]
    submitted = {**personal_ack_body(row), **body} if isinstance(body, dict) else body
    response = api.post(personal_ack_path(row), submitted, format="json")
    assert response.status_code == 400, getattr(response, "data", None)
    assert not OpsDutyRecordSupplement.objects.exists()


def test_self_acknowledgement_denies_foreign_unlinked_and_dismissed_users(duty_log_scene):
    scene = duty_log_scene
    source(scene)
    source(scene, person=scene["people"][1])
    api = own_client(scene)
    foreign = scene["wrong"].get(REGISTER, {"preset": "TODAY", "source": "STATUS"}).data["rows"][0]
    assert api.post(personal_ack_path(foreign), personal_ack_body(foreign), format="json").status_code == 403
    own = api.get(SELF).data["results"][0]
    assert scene["wrong"].post(personal_ack_path(own), personal_ack_body(own), format="json").status_code == 403
    assert api.post(personal_ack_path(own), personal_ack_body(own), format="json", QUERY_STRING="employee_id=1").status_code == 400
    type(scene["people"][0]).objects.filter(pk=scene["people"][0].pk).update(is_active=False)
    assert api.post(personal_ack_path(own), personal_ack_body(own), format="json").status_code == 403
    assert not OpsDutyRecordSupplement.objects.exists()


@pytest.mark.parametrize("change", ["cancel", "post", "time", "override"])
def test_self_acknowledgement_rejects_changed_cancelled_or_overridden_exit(duty_log_scene, change):
    scene = duty_log_scene
    saved = source(scene)
    api = own_client(scene)
    row = api.get(SELF).data["results"][0]
    if change == "cancel":
        saved.state = "cancelled"
    elif change == "post":
        post = OpsSecurityPost.objects.get(pk=int(saved.duty_assignment["post_id"]))
        replacement = OpsSecurityPost.objects.create(sector=post.sector, name="Замена", position=2)
        saved.duty_assignment = {**saved.duty_assignment, "post_id": str(replacement.pk), "post_name": replacement.name}
    elif change == "time":
        saved.duty_assignment = {**saved.duty_assignment, "intervals": [EXITS[0],
            {"start_at": "2026-10-13T22:30:00+05:00", "end_at": "2026-10-14T01:00:00+05:00"}]}
    else:
        OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="SICK_LEAVE",
            date_start=date(2026, 10, 13), date_end=date(2026, 10, 15))
    if change != "override":
        saved.save()
    response = api.post(personal_ack_path(row), personal_ack_body(row), format="json")
    assert response.status_code == 409, getattr(response, "data", None)
    assert not OpsDutyRecordSupplement.objects.exists()


def test_self_acknowledgement_denies_expired_and_completed_exit(duty_log_scene):
    from organization_management.apps.operations.clock import override
    scene = duty_log_scene
    source(scene)
    api = own_client(scene)
    expired = api.get(SELF).data["results"][0]
    with override(datetime.fromisoformat("2026-10-14T02:00:00+05:00")):
        assert api.post(personal_ack_path(expired), personal_ack_body(expired), format="json").status_code == 409
    shift = OpsDutyShift.objects.create(employee_id=str(scene["people"][0].pk), employee_name="Сотрудник",
        business_date=date(2026, 10, 14), duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    cached = next(row for row in api.get(SELF).data["results"] if row["source"] == "PLAN")
    shift.state_code = "COMPLETED"
    shift.save(update_fields=["state_code"])
    assert api.post(personal_ack_path(cached), personal_ack_body(cached), format="json").status_code == 409


@pytest.mark.parametrize("kind", ["LOG", "PLAN", "DISPATCH"])
def test_self_acknowledgement_uses_existing_other_journal_sources(duty_log_scene, kind):
    scene = duty_log_scene
    person = scene["people"][0]
    if kind == "PLAN":
        OpsDutyShift.objects.create(employee_id=str(person.pk), employee_name="Сотрудник", business_date=date(2026, 10, 14),
            duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    elif kind == "LOG":
        OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник", division_id=scene["first"].pk,
            division_name=scene["first"].name, service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
            planned_start=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), planned_end=datetime.fromisoformat("2026-10-14T02:00:00+05:00"))
    else:
        legacy = source(scene)
        legacy.state = "cancelled"
        legacy.save()
        allocation = OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code="DUTY", date_start=date(2026, 10, 13), date_end=date(2026, 10, 15))
        OpsDutyDispatchConfig.objects.create(singleton_key=1, receiver_department_id=scene["other"].pk)
        OpsDutyDispatchAssignment.objects.create(employee_id=person.pk, employee_name="Сотрудник", source_status=allocation,
            receiver_department_id=scene["other"].pk, placement=legacy.duty_assignment, created_by="test",
            start_at=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), end_at=datetime.fromisoformat("2026-10-14T02:00:00+05:00"))
    api = own_client(scene)
    row = api.get(SELF).data["results"][0]
    response = api.post(personal_ack_path(row), personal_ack_body(row), format="json")
    assert response.status_code == 200, getattr(response, "data", None)
    assert response.data["record"]["source_state"] == "ACKNOWLEDGED"
    assert response.data["record"]["actual_start"] is response.data["record"]["actual_end"] is None
    assert api.post(personal_ack_path(row), personal_ack_body(row), format="json").status_code == 200


@pytest.mark.parametrize("kind", ["LOG", "PLAN"])
def test_self_acknowledgement_token_rejects_unseen_changed_plan(duty_log_scene, kind):
    scene = duty_log_scene
    person = scene["people"][0]
    if kind == "PLAN":
        original = OpsDutyShift.objects.create(employee_id=str(person.pk), employee_name="Сотрудник", business_date=date(2026, 10, 14),
            duty_type_code="DAY_OWN", target={"safeLabel": "Первый пост"}, state_code="PLANNED")
    else:
        original = OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник", division_id=scene["first"].pk,
            division_name=scene["first"].name, service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
            planned_start=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), planned_end=datetime.fromisoformat("2026-10-14T02:00:00+05:00"), location_label="Первый пост")
    api = own_client(scene)
    cached = api.get(SELF).data["results"][0]
    if kind == "LOG":
        edited = scene["manager"].patch(path(cached), {"expected_revision": 1, "location_label": "Новый пост",
            "planned_start": "2026-10-13T23:00:00+05:00", "reason": "Перенос"}, format="json")
        assert edited.status_code == 200, edited.data
    else:
        original.target = {"safeLabel": "Новый пост"}
        original.save(update_fields=["target"])
    stale = api.post(personal_ack_path(cached), personal_ack_body(cached), format="json")
    assert stale.status_code == 409, getattr(stale, "data", None)
    latest = api.get(SELF).data["results"][0]
    assert latest["acknowledgementToken"] != cached["acknowledgementToken"]
    accepted = api.post(personal_ack_path(latest), personal_ack_body(latest), format="json")
    assert accepted.status_code == 200, accepted.data
    assert api.post(personal_ack_path(latest), personal_ack_body(latest), format="json").status_code == 200


@pytest.mark.parametrize("body,status", [({}, 400), ({"token": "bad"}, 400), ({"token": "0" * 64}, 409)])
def test_self_acknowledgement_requires_current_opaque_token(duty_log_scene, body, status):
    scene = duty_log_scene
    source(scene)
    api = own_client(scene)
    row = api.get(SELF).data["results"][0]
    response = api.post(personal_ack_path(row), body, format="json")
    assert response.status_code == status, getattr(response, "data", None)
    assert not OpsDutyRecordSupplement.objects.exists()


def test_log_planned_edit_requires_fresh_intent_but_identical_patch_keeps_acknowledgement(duty_log_scene):
    from organization_management.apps.operations.models_audit import OpsAuditLog
    scene = duty_log_scene
    person = scene["people"][0]
    original = OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник", division_id=scene["first"].pk,
        division_name=scene["first"].name, service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
        planned_start=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), planned_end=datetime.fromisoformat("2026-10-14T02:00:00+05:00"), location_label="Первый пост")
    api = own_client(scene)
    cached = api.get(SELF).data["results"][0]
    confirmed = api.post(personal_ack_path(cached), personal_ack_body(cached), format="json")
    assert confirmed.status_code == 200, confirmed.data
    acknowledged_at = confirmed.data["record"]["acknowledged_at"]
    detail = scene["manager"].get(path(cached)).data
    identical = scene["manager"].patch(path(cached), {"expected_revision": detail["revision"],
        "location_label": "Первый пост", "reason": "Повтор формы"}, format="json")
    assert identical.status_code == 200 and identical.data["acknowledged_at"] == acknowledged_at
    assert api.get(SELF).data["results"][0]["acknowledgementToken"] == cached["acknowledgementToken"]
    changed = scene["manager"].patch(path(cached), {"expected_revision": identical.data["revision"],
        "location_label": "Новый пост", "reason": "Перенос"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["state"] == "PLANNED" and changed.data["acknowledged_at"] is None and changed.data["acknowledged_by"] is None
    latest = api.get(SELF).data["results"][0]
    assert latest["canAcknowledge"] is True and latest["acknowledgementToken"] != cached["acknowledgementToken"]
    assert api.post(personal_ack_path(cached), personal_ack_body(cached), format="json").status_code == 409
    assert api.post(personal_ack_path(latest), personal_ack_body(latest), format="json").status_code == 200
    updated = OpsAuditLog.objects.filter(entity_type="duty_log", entity_id=original.pk, action="DUTY_LOG_UPDATED").latest("pk")
    assert updated.old_value["acknowledged_at"] == acknowledged_at
    assert updated.new_value["acknowledged_at"] is None


def real_duty_officer(scene):
    from organization_management.apps.operations.services import PermissionService
    api, user = client_for("real-duty-officer", "DUTY_OFFICER", (), scene["first"].pk)
    rights = PermissionService.effective_permissions(str(user.pk))
    assert {"duty.view", "duty.dispatch"} <= rights
    assert not rights & {"duty.manage", "status.manage", "status.workspace"}
    return api


def test_real_duty_officer_can_record_status_facts_without_source_or_classification_rights(duty_log_scene):
    scene = duty_log_scene
    saved = source(scene)
    row = first_exit(scene)
    api = real_duty_officer(scene)
    listing = api.get(REGISTER, {"preset": "TODAY", "source": "STATUS"})
    assert listing.status_code == 200, listing.data
    displayed = next(item for item in listing.data["rows"] if item["id"] == row["id"])
    assert displayed["actions"] == ["acknowledge"]
    assert api.get(path(row)).data["actions"] == ["acknowledge"]
    assert api.post(path(row, "classify"), {"service_duty_code": "GBR", "reason": "Проверка"}, format="json").status_code == 403
    assert api.post(path(row, "cancel"), {"reason": "Проверка"}, format="json").status_code == 422
    assert api.patch(path(row), {"expected_revision": 1, "note": "Правка", "reason": "Проверка"}, format="json").status_code == 403
    for action, body in [("acknowledge", {}), ("start", {"at": "2026-10-13T08:05:00+05:00"}), ("complete", {"at": "2026-10-13T09:55:00+05:00"})]:
        result = api.post(path(row, action), body, format="json")
        assert result.status_code == 200, result.data
        assert "classify" not in result.data["actions"]
    saved.refresh_from_db()
    assert saved.duty_assignment["intervals"] == EXITS


def test_real_duty_officer_status_scope_keeps_frozen_and_current_boundaries(duty_log_scene):
    scene = duty_log_scene
    source(scene)
    source(scene, person=scene["people"][1])
    own = first_exit(scene)
    api = real_duty_officer(scene)
    foreign = scene["wrong"].get(REGISTER, {"preset": "TODAY", "source": "STATUS"}).data["rows"][0]
    assert api.post(path(foreign, "acknowledge"), {}, format="json").status_code == 403
    assert api.post(path(own, "acknowledge"), {}, format="json").status_code == 200
    unit = scene["people"][0].staff_unit
    unit.division_id = scene["other"].pk
    unit.save(update_fields=["division"])
    assert api.get(path(own)).status_code == 200
    assert api.get(path(own)).data["actions"] == []
    assert api.post(path(own, "start"), {}, format="json").status_code == 403


@pytest.mark.parametrize("kind", ["LOG", "PLAN"])
def test_real_duty_officer_dispatch_right_never_manages_log_or_plan(duty_log_scene, kind):
    scene = duty_log_scene
    person = scene["people"][0]
    if kind == "PLAN":
        row = OpsDutyShift.objects.create(employee_id=str(person.pk), employee_name="Сотрудник", business_date=date(2026, 10, 14),
            duty_type_code="DAY_OWN", target={}, state_code="PLANNED")
    else:
        row = OpsDutyLogEntry.objects.create(employee_id=person.pk, employee_name="Сотрудник", division_id=scene["first"].pk,
            division_name=scene["first"].name, service_duty_code="GBR", service_duty_label="ГБР", created_by="test",
            planned_start=datetime.fromisoformat("2026-10-13T22:00:00+05:00"), planned_end=datetime.fromisoformat("2026-10-14T02:00:00+05:00"))
    api = real_duty_officer(scene)
    key = {"id": f"{kind}:{row.pk}"}
    assert api.get(path(key)).data["actions"] == []
    assert api.post(path(key, "acknowledge"), {}, format="json").status_code == 403
