"""Accepted combat submissions remain visible without a status projection."""
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_combat import OpsCombatDutyType, OpsCombatRoute
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.ops import combat


pytestmark = pytest.mark.django_db
DAY = date(2026, 10, 7)
URL = "/api/ops/service-combat-duty/"


@pytest.fixture(autouse=True)
def registries():
    call_command("seed_status_types", verbosity=0)
    OpsCombatDutyType.objects.create(
        duty_type_code="TEST_SERVICE_COMBAT", safe_label="Боевая группа",
        supports_multiple_routes=True,
    )
    for code, label in [("test-route-1", "Мангилик Ел"), ("test-route-2", "Кабанбай батыр")]:
        OpsCombatRoute.objects.create(route_code=code, safe_label=label)


@pytest.fixture
def branches():
    root = Division.objects.create(name="Служба", division_type="organization")
    result = []
    for number in (1, 2):
        department = Division.objects.create(
            name=f"Департамент {number}", division_type="department", parent=root,
        )
        directorate = Division.objects.create(
            name=f"Управление {number}", division_type="directorate", parent=department,
        )
        section = Division.objects.create(
            name=f"Отдел {number}", division_type="division", parent=directorate,
        )
        result.append((department, section))
    return result


def accepted_shift(unit_name="Неизвестное подразделение", *, unit_id=None, day=DAY, suffix="1", accept=True):
    shift = combat.create_shift(
        business_date=day, duty_type_code="TEST_SERVICE_COMBAT",
        route_ids=["test-route-1", "test-route-2"], coverage_mode="RESERVE",
        required_employees=2, group_name=f"БГ-{suffix}",
    )
    shift = combat.submit_roster(
        shift.pk, group_leader=f"Старший {suffix}", members=[f"Участник {suffix}"],
        reserve=[f"Резерв {suffix}"], submitted_by_unit=unit_name,
        submitted_by_division_id=unit_id,
    )
    if accept:
        shift = combat.review_roster(shift.pk, decision="ACCEPT", return_reason=None)
    return shift


def viewer(scope=None, username="groups-reader"):
    api, _ = client_for(username, f"ROLE_{username}", ["duty.view"], scope)
    return api


def read(api, day=DAY):
    response = api.get(URL, {"business_date": day.isoformat()})
    assert response.status_code == 200, response.data
    return response.json()


def test_real_combat_lifecycle_remains_visible_without_canonical_statuses(branches):
    department, section = branches[0]
    shift = accepted_shift(section.name, unit_id=section.pk)
    api = viewer()
    assert not OpsEmployeeStatus.objects.exists()
    response = read(api)
    assert response["departments"] == []
    assert response["combat_groups"] == [{
        "shift_id": shift.pk, "group_name": "БГ-1", "route_label": "Мангилик Ел, Кабанбай батыр",
        "route_ids": ["test-route-1", "test-route-2"], "division_id": section.pk,
        "division_name": section.name, "department_id": department.pk, "department_name": department.name,
        "leader_name": "Старший 1", "member_names": ["Участник 1"], "reserve_names": ["Резерв 1"],
        "stage_code": "PENDING_ACKNOWLEDGEMENT", "stage_label": "Ожидает ознакомления",
        "actual_member_names": None, "actual_start": None, "actual_end": None,
    }]
    for name in ["Старший 1", "Участник 1"]:
        shift = combat.acknowledge(shift.pk, employee_name=name)
    assert read(api)["combat_groups"][0]["stage_code"] == "READY"
    shift = combat.check_in(shift.pk)
    active = read(api)["combat_groups"][0]
    assert (active["stage_code"], active["stage_label"]) == ("ACTIVE", "На боевом дежурстве")
    assert active["actual_start"] == shift.submission["execution"]["actualStart"]
    combat.submit_handover(shift.pk, unresolved_incidents="", remarks="", confirmed_by="Старший 1")
    shift = combat.complete(shift.pk, actual_member_names=["Старший 1", "Резерв 1"])
    completed = read(api)["combat_groups"][0]
    assert (completed["stage_code"], completed["stage_label"]) == ("COMPLETED", "Дежурство завершено")
    assert completed["actual_member_names"] == ["Старший 1", "Резерв 1"]
    assert completed["member_names"] == ["Участник 1"]
    assert completed["actual_end"] == shift.submission["execution"]["actualEnd"]
    assert not OpsEmployeeStatus.objects.exists()


def test_selected_date_excludes_other_combat_shifts():
    before = accepted_shift(day=DAY - timedelta(days=1), suffix="before")
    today = accepted_shift(suffix="today")
    after = accepted_shift(day=DAY + timedelta(days=1), suffix="after")
    api = viewer()
    assert [group["shift_id"] for group in read(api)["combat_groups"]] == [today.pk]
    assert [group["shift_id"] for group in read(api, before.business_date)["combat_groups"]] == [before.pk]
    assert [group["shift_id"] for group in read(api, after.business_date)["combat_groups"]] == [after.pk]


def test_submitted_returned_and_unsubmitted_groups_are_excluded():
    accepted_shift(suffix="submitted", accept=False)
    returned = accepted_shift(suffix="returned", accept=False)
    combat.review_roster(returned.pk, decision="RETURN", return_reason="Уточнить состав")
    combat.create_shift(
        business_date=DAY, duty_type_code="TEST_SERVICE_COMBAT", route_ids=["test-route-1"],
        coverage_mode="RESERVE", required_employees=2,
    )
    assert read(viewer())["combat_groups"] == []


def test_scoped_reader_sees_only_frozen_submission_divisions_inside_subtree(branches):
    own_department, own = branches[0]
    _, outside = branches[1]
    own_shift = accepted_shift(own.name, unit_id=own.pk, suffix="own")
    outside_shift = accepted_shift(outside.name, unit_id=outside.pk, suffix="foreign")
    unknown = accepted_shift(suffix="unknown")
    scoped = read(viewer(own_department.pk))["combat_groups"]
    assert [group["shift_id"] for group in scoped] == [own_shift.pk]
    global_groups = read(viewer(username="global-reader"))["combat_groups"]
    assert [group["shift_id"] for group in global_groups] == [own_shift.pk, outside_shift.pk, unknown.pk]
    assert global_groups[-1]["division_id"] is None
    assert global_groups[-1]["division_name"] == "Неизвестное подразделение"
    assert global_groups[-1]["department_id"] is None


@pytest.mark.parametrize("both_inside_scope", [False, True])
def test_ambiguous_unit_name_is_not_resolved_from_only_allowed_candidates(branches, both_inside_scope):
    own_department, own = branches[0]
    _, foreign = branches[1]
    Division.objects.create(name="Одинаковый отдел", division_type="division", parent=own)
    Division.objects.create(
        name="Одинаковый отдел", division_type="division", parent=own.parent if both_inside_scope else foreign,
    )
    shift = accepted_shift("Одинаковый отдел")
    assert read(viewer(own_department.pk))["combat_groups"] == []
    group = read(viewer(username="global-reader"))["combat_groups"][0]
    assert group["shift_id"] == shift.pk
    assert group["division_id"] is group["department_id"] is None
    assert group["division_name"] == "Одинаковый отдел"
    assert group["department_name"] == ""


def test_names_are_snapshots_even_when_employees_share_the_same_name(branches):
    own_department, section = branches[0]
    make_employee(section)
    make_employee(branches[1][1])
    shift = combat.create_shift(
        business_date=DAY, duty_type_code="TEST_SERVICE_COMBAT", route_ids=["test-route-1"],
        coverage_mode="RESERVE", required_employees=2, group_name="БГ-однофамильцы",
    )
    combat.submit_roster(
        shift.pk, group_leader="Иванов Иван", members=["Другой сотрудник"], reserve=[],
        submitted_by_unit=section.name,
        submitted_by_division_id=section.pk,
    )
    combat.review_roster(shift.pk, decision="ACCEPT", return_reason=None)
    group = read(viewer(own_department.pk))["combat_groups"][0]
    assert group["leader_name"] == "Иванов Иван"
    assert group["member_names"] == ["Другой сотрудник"]
    assert not any("employee_id" in field for field in group)
    assert group["division_id"] == section.pk


def test_canonical_department_rows_are_preserved_alongside_combat_groups(branches):
    department, section = branches[0]
    person = make_employee(section)
    OpsEmployeeStatus.objects.create(
        employee_id=person.pk, status_type_code="DUTY", date_start=DAY,
        date_end=DAY + timedelta(days=1), created_by="test",
    )
    accepted_shift(section.name, unit_id=section.pk)
    response = read(viewer())
    assert len(response["combat_groups"]) == 1
    assert response["departments"][0]["id"] == department.pk
    assert [row["employee_id"] for row in response["departments"][0]["employees"]] == [person.pk]


def test_accepted_legacy_group_without_execution_has_an_accepted_stage():
    shift = accepted_shift()
    shift.submission["execution"] = None
    shift.save(update_fields=["submission"])
    group = read(viewer())["combat_groups"][0]
    assert (group["stage_code"], group["stage_label"]) == ("ACCEPTED", "Состав принят")


def test_group_queries_do_not_grow_per_shift(branches):
    _, section = branches[0]
    accepted_shift(section.name, unit_id=section.pk)
    api = viewer()
    with CaptureQueriesContext(connection) as small:
        first = read(api)
    for number in range(2, 22):
        accepted_shift(section.name, unit_id=section.pk, suffix=str(number))
    with CaptureQueriesContext(connection) as large:
        many = read(api)
    assert len(first["combat_groups"]) == 1
    assert len(many["combat_groups"]) == 21
    assert len(large) == len(small)


def test_legacy_unique_unit_name_is_global_only(branches):
    department, section = branches[0]
    accepted_shift(section.name)
    assert read(viewer(department.pk))["combat_groups"] == []
    group = read(viewer(username="global-reader"))["combat_groups"][0]
    assert group["division_id"] is group["department_id"] is None


def test_renamed_legacy_unit_name_cannot_leak_to_a_foreign_reusing_department(branches):
    _, original = branches[0]
    foreign_department, foreign = branches[1]
    accepted_shift(original.name)
    old_name = original.name
    original.name = "Переименованный отдел"
    original.save(update_fields=["name"])
    foreign.name = old_name
    foreign.save(update_fields=["name"])
    assert read(viewer(foreign_department.pk))["combat_groups"] == []
    group = read(viewer(username="global-reader"))["combat_groups"][0]
    assert group["division_name"] == old_name
    assert group["division_id"] is group["department_id"] is None


def test_deleted_submission_division_cannot_fall_back_to_a_reused_name(branches):
    _, original = branches[0]
    foreign_department, foreign = branches[1]
    old_name = original.name
    accepted_shift(old_name, unit_id=original.pk)
    original.delete()
    foreign.name = old_name
    foreign.save(update_fields=["name"])
    assert read(viewer(foreign_department.pk))["combat_groups"] == []
    group = read(viewer(username="global-reader"))["combat_groups"][0]
    assert group["division_name"] == old_name
    assert group["division_id"] is group["department_id"] is None


def test_frozen_identity_keeps_same_named_units_distinct(branches):
    own_department, own = branches[0]
    foreign_department, foreign = branches[1]
    foreign.name = own.name
    foreign.save(update_fields=["name"])
    shift = accepted_shift(own.name, unit_id=own.pk)
    group = read(viewer(own_department.pk))["combat_groups"][0]
    assert (group["shift_id"], group["division_id"]) == (shift.pk, own.pk)
    assert read(viewer(foreign_department.pk, username="foreign-reader"))["combat_groups"] == []


@pytest.mark.parametrize("staffed_actor", [True, False])
def test_submit_api_ignores_forged_division_id_and_freezes_actor_identity(branches, staffed_actor):
    own_department, own = branches[0]
    foreign_department, foreign = branches[1]
    api, actor = client_for("group-submitter", "GROUP_SUBMITTER", ["duty.view", "duty.manage"], own_department.pk)
    if staffed_actor:
        employee = make_employee(own)
        employee.user = actor
        employee.save(update_fields=["user"])
    shift = combat.create_shift(
        business_date=DAY, duty_type_code="TEST_SERVICE_COMBAT", route_ids=["test-route-1"],
        coverage_mode="RESERVE", required_employees=2, group_name="БГ-API",
    )
    base = f"/api/ops/combat-duty-shifts/{shift.pk}/"
    response = api.post(base + "submit/", {
        "groupLeaderEmployeeName": "Старший API", "memberEmployeeNames": ["Участник API"],
        "reserveEmployeeNames": [], "submittedByUnitName": foreign.name,
        "submittedByDivisionId": foreign.pk,
    }, format="json")
    assert response.status_code == 200, response.data
    assert response.json()["submission"]["submittedByDivisionId"] == (own.pk if staffed_actor else None)
    assert response.json()["submission"]["submittedByUnitName"] == (own.name if staffed_actor else "")
    assert api.post(base + "review/", {"decision": "ACCEPT"}, format="json").status_code == 200
    old_name = own.name
    own.name = "Переименованный отдел"
    own.save(update_fields=["name"])
    foreign.name = old_name
    foreign.save(update_fields=["name"])
    assert read(viewer(foreign_department.pk, username="foreign-reader"))["combat_groups"] == []
    owned = read(api)["combat_groups"]
    assert len(owned) == (1 if staffed_actor else 0)
    if staffed_actor:
        assert owned[0]["division_id"] == own.pk
        assert owned[0]["division_name"] == old_name
        assert owned[0]["department_id"] == own_department.pk
