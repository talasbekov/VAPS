"""Dispatch receives canonical allocations without authority to edit their source."""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.clock import Clock, override
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsObjectSector, OpsSecurityPost
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.status_types import StatusType

pytestmark = pytest.mark.django_db
URL = "/api/ops/duty-dispatch/"
DAY = date(2026, 10, 10)


@pytest.fixture(autouse=True)
def fixed_clock():
    with override(DAY):
        yield


def client(name, role, scope=None):
    user = User.objects.create_user(username=name)
    RoleAdminService.assign_role(str(user.pk), role, scope, actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def scene():
    call_command("seed_operations", verbosity=0)
    call_command("seed_status_types", verbosity=0)
    departments = [Division.objects.create(name=name, division_type="department") for name in ("Receiver", "Sender", "Other")]
    admin = client("dispatch-admin", "ADMIN")
    dispatcher = client("dispatcher", "DUTY_OFFICER", departments[0].pk)
    wrong = client("wrong-dispatcher", "DUTY_OFFICER", departments[2].pk)
    people, sources = [], []
    StatusType.objects.update_or_create(code="DUTY", defaults={"name": "Duty", "priority": 30, "report_column_code": "ON_DUTY"})
    for index, department in enumerate(departments[1:], 1):
        person = Employee.objects.create(first_name="Name", last_name=f"Person{index}", personnel_number=f"dispatch{index}", iin=f"{index:012d}", hire_date=date(2020, 1, 1))
        StaffUnit.objects.create(employee=person, division=department, index=index)
        people.append(person)
        sources.append(OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code="DUTY", date_start=DAY, date_end=DAY + timedelta(days=3)))
    obj = OpsSecurityObject.objects.create(name="Object", code="dispatch-object", object_type="building", region="R", address="A", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Sector", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Post", position=1)
    return dict(admin=admin, api=dispatcher, wrong=wrong, departments=departments, people=people, sources=sources, obj=obj, post=post)


def configure(s):
    response = s["admin"].post(URL + "configure/", {"department_id": s["departments"][0].pk}, format="json")
    assert response.status_code == 200, getattr(response, "data", response.content)


def payload(s, **extra):
    return {"employee_id": s["people"][0].pk, "status_id": s["sources"][0].pk, "business_date": DAY.isoformat(), "start_time": "08:00", "end_time": "20:00", "placement": {"kind": "POST", "object_id": str(s["obj"].pk), "post_id": str(s["post"].pk)}, **extra}


def create(s, **extra):
    return s["api"].post(URL, payload(s, **extra), format="json")


def queue(s, api=None, day=DAY):
    return (api or s["api"]).get(URL, {"business_date": day.isoformat()})


def test_unconfigured_returns_capabilities_without_identities(scene):
    response = queue(scene)
    assert response.status_code == 200
    assert response.data["receiver"] is None
    assert response.data["can_assign"] is False
    assert response.data["people"] == []


def test_all_departments_received_only_in_receiver_scope(scene):
    configure(scene)
    data = queue(scene).data
    assert data["can_assign"] is True
    assert {p["employee_id"] for p in data["people"]} == {p.pk for p in scene["people"]}
    denied = queue(scene, scene["wrong"]).data
    assert denied["can_assign"] is False
    assert denied["people"] == denied["assignments"] == []
    assert scene["wrong"].post(URL, payload(scene), format="json").status_code == 403


def test_configure_requires_global_admin_and_department(scene):
    assert scene["api"].post(URL + "configure/", {"department_id": scene["departments"][0].pk}, format="json").status_code == 403
    directorate = Division.objects.create(name="Not a department", division_type="directorate", parent=scene["departments"][0])
    assert scene["admin"].post(URL + "configure/", {"department_id": directorate.pk}, format="json").status_code == 400


def test_only_canonical_on_duty_winner_is_received(scene):
    configure(scene)
    StatusType.objects.update_or_create(code="DISPATCH_TEST_ABSENCE", defaults={"name": "Absence", "priority": 1, "report_column_code": "OTHER"})
    OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="DISPATCH_TEST_ABSENCE", date_start=DAY, date_end=DAY + timedelta(days=1))
    assert [p["employee_id"] for p in queue(scene).data["people"]] == [scene["people"][1].pk]
    assert create(scene).status_code == 409


def test_create_cancel_history_and_no_source_mutation(scene):
    configure(scene)
    source_before = list(OpsEmployeeStatus.objects.values())
    response = create(scene)
    assert response.status_code == 201, response.data
    row = response.data
    assert row["valid"] is True
    assert row["placement"]["post_name"] == "Post"
    assert row["source_status_id"] == scene["sources"][0].pk
    assert list(OpsEmployeeStatus.objects.values()) == source_before
    assert scene["wrong"].post(f"{URL}{row['id']}/cancel/", {"reason": "x"}, format="json").status_code == 403
    assert scene["api"].post(f"{URL}{row['id']}/cancel/", {"reason": ""}, format="json").status_code == 400
    cancelled = scene["api"].post(f"{URL}{row['id']}/cancel/", {"reason": "Changed shift"}, format="json")
    assert cancelled.status_code == 200
    assert cancelled.data["cancelled_at"]
    assert cancelled.data["cancelled_reason"] == "Changed shift"
    assert len(queue(scene).data["assignments"]) == 1
    assert create(scene).status_code == 201


def test_overlap_rejected_but_adjacent_shifts_allowed(scene):
    configure(scene)
    assert create(scene).status_code == 201
    assert create(scene).status_code == 409
    assert create(scene, start_time="19:59", end_time="23:00").status_code == 409
    assert create(scene, start_time="20:00", end_time="23:00").status_code == 201


def test_overnight_requires_winner_on_both_days_and_end_is_exclusive(scene):
    configure(scene)
    source = scene["sources"][0]
    source.date_end = DAY + timedelta(days=1)
    source.save(update_fields=["date_end"])
    assert create(scene, start_time="20:00", end_time="08:00").status_code == 409
    assert create(scene, start_time="20:00", end_time="00:00").status_code == 201


@pytest.mark.parametrize("change", ["cancelled", "inactive", "replaced"])
def test_stale_source_invalidates_assignment_and_rejects_new_write(scene, change):
    configure(scene)
    assert create(scene).status_code == 201
    source = scene["sources"][0]
    if change in ("cancelled", "replaced"):
        source.cancelled_at = Clock.now()
        source.save(update_fields=["cancelled_at"])
        if change == "replaced":
            OpsEmployeeStatus.objects.create(employee_id=source.employee_id, status_type_code="DUTY", date_start=source.date_start, date_end=source.date_end)
    else:
        Employee.objects.filter(pk=source.employee_id).update(is_active=False)
    data = queue(scene).data
    assert data["assignments"][0]["valid"] is False
    assert data["assignments"][0]["invalid_reason"]
    assert create(scene, start_time="20:00", end_time="23:00").status_code == 409


@pytest.mark.parametrize("times", [("25:00", "08:00"), ("8:00", "09:00"), ("08:00:30", "09:00"), ("", "09:00")])
def test_invalid_times_rejected(scene, times):
    configure(scene)
    assert create(scene, start_time=times[0], end_time=times[1]).status_code == 400


def test_placement_checks_object_and_post_ownership(scene):
    configure(scene)
    other = OpsSecurityObject.objects.create(name="Other", code="dispatch-other", object_type="building", region="R", address="A", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    assert create(scene, placement={"kind": "POST", "object_id": str(other.pk), "post_id": str(scene["post"].pk)}).status_code == 400
    scene["obj"].object_state = "ARCHIVED"
    scene["obj"].save(update_fields=["object_state"])
    assert create(scene).status_code == 400


def test_receiver_cannot_change_with_live_assignments(scene):
    configure(scene)
    assert create(scene).status_code == 201
    response = scene["admin"].post(URL + "configure/", {"department_id": scene["departments"][2].pk}, format="json")
    assert response.status_code == 409


def test_receiver_object_roster_does_not_expand_employee_read_scope(scene):
    configure(scene)
    assert create(scene).status_code == 201
    url = "/api/statuses/statuses/duty-assignments/"
    object_query = {"object_id": scene["obj"].pk, "date": DAY.isoformat()}
    rows = scene["api"].get(url, object_query).data["results"]
    assert len(rows) == 1
    assert rows[0]["source"] == "dispatch"
    assert rows[0]["dispatch_assignment_id"]
    assert scene["api"].get(url, {"employee_id": scene["people"][0].pk, "date": DAY.isoformat()}).data["results"] == []
    OpsEmployeeStatus.objects.filter(pk=scene["sources"][0].pk).update(cancelled_at=Clock.now())
    assert scene["api"].get(url, object_query).data["results"] == []


def test_existing_daily_shift_blocks_dispatch(scene):
    from organization_management.apps.operations.models_duty import OpsDutyShift
    configure(scene)
    OpsDutyShift.objects.create(business_date=DAY, duty_type_code="TEST", target={}, employee_name="Old name", employee_id=str(scene["people"][0].pk), state_code="PLANNED")
    assert create(scene).status_code == 409
    assert queue(scene).data["people"][0]["unavailable_reason"]


def test_legacy_placement_blocks_dispatch_without_copying_it(scene):
    from organization_management.apps.statuses.models import EmployeeStatus
    configure(scene)
    EmployeeStatus.objects.create(employee=scene["people"][0], status_type="on_duty", start_date=DAY, end_date=DAY + timedelta(days=2), duty_assignment=payload(scene)["placement"])
    assert create(scene).status_code == 409
    assert any(p.get("legacy_assignment") for p in queue(scene).data["people"])


def test_existing_event_participation_blocks_even_if_duty_wins_priority(scene):
    configure(scene)
    OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="IN_EVENT", date_start=DAY, date_end=DAY + timedelta(days=1), source_ref="security-event:123")
    StatusType.objects.filter(code="IN_EVENT").update(priority=100)
    assert create(scene).status_code == 409


def test_accepted_combat_name_collision_requires_review(scene):
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops.security_events import personnel_display_name
    configure(scene)
    OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="TEST", route_set={}, submission={"stateCode": "ACCEPTED", "memberEmployeeNames": [personnel_display_name(scene["people"][0])]})
    assert create(scene).status_code == 409


def test_assignment_and_cancel_have_audit_events(scene):
    from organization_management.apps.operations.models_audit import OpsAuditLog
    configure(scene)
    response = create(scene)
    assert response.status_code == 201
    row_id = response.data["id"]
    scene["api"].post(f"{URL}{row_id}/cancel/", {"reason": "Changed shift"}, format="json")
    assert set(OpsAuditLog.objects.filter(entity_type="duty_dispatch", entity_id=row_id).values_list("action", flat=True)) == {"DUTY_DISPATCH_CREATED", "DUTY_DISPATCH_CANCELLED"}


def test_full_day_and_overnight_appear_on_each_intersecting_day(scene):
    configure(scene)
    response = create(scene, start_time="20:00", end_time="20:00")
    assert response.status_code == 201
    assert len(queue(scene, day=DAY + timedelta(days=1)).data["assignments"]) == 1
    assert queue(scene, day=DAY + timedelta(days=2)).data["assignments"] == []


def test_old_daily_planner_cannot_double_book_dispatch(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.models_duty import OpsDutyType
    from organization_management.apps.ops import duties
    configure(scene)
    assert create(scene).status_code == 201
    kind = OpsDutyType.objects.create(duty_type_code="DISPATCH_TEST", safe_label="Test", target_type="OWN_OBJECT", default_duration_minutes=480, requires_senior=False, rest_after_minutes=0, requires_current_passport=False)
    with pytest.raises(DomainError) as error:
        duties.create_shift(business_date=DAY.isoformat(), duty_type_code=kind.duty_type_code, object_id=str(scene["obj"].pk), sector_id=None, post_id=None, employee_id=str(scene["people"][0].pk), note=None, override=False, override_reason="", actor="test")
    assert error.value.code == "DUTY_DISPATCH_CONFLICT"


def test_om_status_cannot_override_dispatch_placement(scene):
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations.exceptions import DomainError
    configure(scene)
    assert create(scene).status_code == 201
    with pytest.raises(DomainError) as error:
        status_service.create_status(employee_id=scene["people"][0].pk, status_type_code="IN_EVENT", date_start=DAY, date_end=DAY + timedelta(days=1), actor="test", source_ref="security-event:1", system_participations=True, override=True, override_reason="Test")
    assert error.value.code == "DUTY_DISPATCH_CONFLICT"


def test_legacy_new_placement_cannot_close_dispatched_source(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.statuses.application.services import StatusApplicationService
    configure(scene)
    assert create(scene).status_code == 201
    with pytest.raises(DomainError) as error:
        StatusApplicationService().create_status(employee_id=scene["people"][0].pk, status_type="on_duty", start_date=DAY, end_date=DAY, duty_assignment=payload(scene)["placement"])
    assert error.value.code == "DUTY_DISPATCH_CONFLICT"


def test_combat_acceptance_cannot_double_book_dispatch(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops import combat
    from organization_management.apps.ops.security_events import personnel_display_name
    configure(scene)
    assert create(scene).status_code == 201
    shift = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="TEST", route_set={}, submission={"stateCode": "SUBMITTED", "memberEmployeeNames": [personnel_display_name(scene["people"][0])]})
    with pytest.raises(DomainError) as error:
        combat.review_roster(shift.pk, decision="ACCEPT", return_reason="")
    assert error.value.code == "DUTY_DISPATCH_CONFLICT"


def test_receiver_options_only_global_administrator(scene):
    assert queue(scene).data["receiver_options"] == []
    data = queue(scene, scene["admin"]).data
    assert {d["id"] for d in data["receiver_options"]} == {d.pk for d in scene["departments"]}
    assert data["time_zone"]


def test_scoped_access_admin_cannot_configure_or_read_people(scene):
    from organization_management.apps.statuses.tests.test_status_writes_require_status_manage import _client
    configure(scene)
    api = _client("dispatch-scoped-admin", ("admin.roles",), scene["departments"][0].pk)
    data = queue(scene, api).data
    assert data["can_configure"] is False
    assert data["can_assign"] is False
    assert data["people"] == data["assignments"] == data["receiver_options"] == []
    assert api.post(URL + "configure/", {"department_id": scene["departments"][0].pk}, format="json").status_code == 403


def test_permission_does_not_grant_general_status_management(scene):
    from organization_management.apps.operations.models import RolePermission
    permissions = set(RolePermission.objects.filter(role_code_id="DUTY_OFFICER").values_list("permission_code_id", flat=True))
    assert "duty.dispatch" in permissions
    assert "status.manage" not in permissions


def test_repeat_cancellation_keeps_original_audit_reason(scene):
    from organization_management.apps.operations.models_audit import OpsAuditLog
    configure(scene)
    row = create(scene).data
    first = scene["api"].post(f"{URL}{row['id']}/cancel/", {"reason": "First reason"}, format="json")
    second = scene["api"].post(f"{URL}{row['id']}/cancel/", {"reason": "Second reason"}, format="json")
    assert first.status_code == second.status_code == 200
    assert second.data["cancelled_reason"] == "First reason"
    assert second.data["cancelled_at"] == first.data["cancelled_at"]
    assert OpsAuditLog.objects.filter(entity_type="duty_dispatch", entity_id=row["id"], action="DUTY_DISPATCH_CANCELLED").count() == 1


def test_source_of_another_employee_cannot_be_used(scene):
    configure(scene)
    assert create(scene, status_id=scene["sources"][1].pk).status_code == 409


def test_foreign_scoped_reader_cannot_read_dispatch_through_object_roster(scene):
    configure(scene)
    assert create(scene).status_code == 201
    response = scene["wrong"].get("/api/statuses/statuses/duty-assignments/", {"object_id": scene["obj"].pk, "date": DAY.isoformat()})
    assert response.status_code == 200
    assert response.data["results"] == []


@pytest.mark.parametrize("own_scope", [True, False])
def test_object_reader_retains_personnel_scope(scene, own_scope):
    from organization_management.apps.statuses.tests.test_status_writes_require_status_manage import _client
    configure(scene)
    assert create(scene).status_code == 201
    scope = scene["departments"][1 if own_scope else 2].pk
    reader = _client("dispatch-object-reader", ("status.view", "object.view"), scope)
    response = reader.get("/api/statuses/statuses/duty-assignments/", {"object_id": scene["obj"].pk, "date": DAY.isoformat()})
    assert response.status_code == 200
    assert len(response.data["results"]) == (1 if own_scope else 0)


def test_inactive_receiver_can_cancel_and_reconfigure_without_new_placements(scene):
    configure(scene)
    row = create(scene).data
    Division.objects.filter(pk=scene["departments"][0].pk).update(is_active=False)
    data = queue(scene).data
    assert data["can_assign"] is False
    assert data["can_cancel"] is True
    assert data["people"] == []
    assert data["assignments"][0]["valid"] is False
    assert create(scene, start_time="21:00", end_time="23:00").status_code == 403
    response = scene["api"].post(f"{URL}{row['id']}/cancel/", {"reason": "Receiver closed"}, format="json")
    assert response.status_code == 200
    assert response.data["cancelled_at"]
    response = scene["admin"].post(URL + "configure/", {"department_id": scene["departments"][2].pk}, format="json")
    assert response.status_code == 200


def test_combat_replacement_cannot_add_dispatched_employee(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops import combat
    from organization_management.apps.ops.security_events import personnel_display_name
    configure(scene)
    assert create(scene).status_code == 201
    shift = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="TEST", route_set={}, submission={"stateCode": "ACCEPTED", "groupLeaderEmployeeName": "Leader", "memberEmployeeNames": ["Member"], "reserveEmployeeNames": [], "execution": {"stateCode": "READY", "acknowledgedMemberNames": ["Leader", "Member"]}})
    with pytest.raises(DomainError) as error:
        combat.replace_member(shift.pk, outgoing="Member", incoming=personnel_display_name(scene["people"][0]), reason_code="TEST", safe_comment="Test")
    assert error.value.code == "DUTY_DISPATCH_CONFLICT"


def test_group_assignment_uses_server_labels(scene):
    configure(scene)
    response = create(scene, placement={"kind": "GROUP", "object_id": str(scene["obj"].pk), "group_id": "duty-group-2", "group_name": "Forged"})
    assert response.status_code == 201
    assert response.data["placement"]["group_name"] == "Группа №2"
    assert response.data["placement"]["post_id"] is None


def test_overnight_loses_canonical_source_on_next_day(scene):
    configure(scene)
    OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="VACATION", date_start=DAY + timedelta(days=1), date_end=DAY + timedelta(days=2))
    assert create(scene, start_time="20:00", end_time="08:00").status_code == 409


@pytest.mark.django_db(transaction=True)
def test_concurrent_assignment_has_one_winner(scene):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    configure(scene)
    barrier = Barrier(2)
    body = payload(scene)
    user_id = User.objects.get(username="dispatcher").pk

    def submit():
        close_old_connections()
        try:
            api = APIClient()
            api.force_authenticate(User.objects.get(pk=user_id))
            barrier.wait(timeout=20)
            return api.post(URL, body, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert sorted(results) == [201, 409]
