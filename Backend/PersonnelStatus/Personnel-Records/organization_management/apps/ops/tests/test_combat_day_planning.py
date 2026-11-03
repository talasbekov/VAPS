"""Authoritative day planning, department boundaries and expense projections."""
from datetime import date, timedelta

import pytest
from django.core.management import call_command

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.models_combat import OpsCombatDutyType, OpsCombatGroup
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
DAY = date(2026, 11, 3)
BOARD = "/api/ops/combat-duty-board/"
CATALOG = "/api/ops/combat-catalogs/"
CANDIDATES = "/api/ops/combat-roster-candidates/"


@pytest.fixture
def scene():
    call_command("seed_status_types", verbosity=0)
    own = Division.objects.create(name="Duty A", division_type="department")
    other = Division.objects.create(name="Duty B", division_type="department")
    own_child = Division.objects.create(name="A child", division_type="directorate", parent=own)
    people = []
    for i, division in enumerate((own, own_child, own, other)):
        p = Employee.objects.create(personnel_number=f"cd-{i}", last_name=f"Duty{i}", first_name="Person")
        StaffUnit.objects.create(index=i + 1, division=division, employee=p)
        people.append(p)
    api, user = client_for("day-head", "DAY_HEAD", ["duty.view", "duty.roster", "duty.catalog.manage", "status.view"], own.pk)
    staff, staff_user = client_for("day-staff", "DAY_STAFF", ["duty.view", "duty.combat.manage"], own.pk)
    groups = [OpsCombatGroup.objects.create(name="БГ-1", division=d, max_members=3) for d in (own, other)]
    kind = OpsCombatDutyType.objects.create(division=own, duty_type_code="DAY", safe_label="Дневное", supports_multiple_routes=False)
    return dict(own=own, child=own_child, other=other, people=people, api=api, user=user, staff=staff, staff_user=staff_user, groups=groups, kind=kind)


def payload(s, **extra):
    return {
        "businessDate": DAY.isoformat(), "groupId": s["groups"][0].pk,
        "dutyTypeId": s["kind"].pk,
        "members": [{"employeeId": p.pk, "isLeader": i == 0, "isDriver": i == 1} for i, p in enumerate(s["people"][:2])],
        "location": {"kind": "POINT", "latitude": 51.13, "longitude": 71.43, "label": "Общая точка"},
        "callsign": "БГ-1", "equipment": [{"label": "Автомобиль", "category": "PASSENGER", "quantity": 1}],
        **extra,
    }


def form(s, **extra):
    response = s["api"].post(BOARD, payload(s, **extra), format="json")
    assert response.status_code == 201, response.data
    return response.json()


def test_scoped_catalogs_cannot_read_or_write_foreign_department(scene):
    s = scene
    r = s["api"].get(CATALOG, {"kind": "groups"})
    assert r.status_code == 200
    assert [row["id"] for row in r.json()["results"]] == [str(s["groups"][0].pk)]
    assert s["api"].get(CATALOG, {"kind": "groups", "division_id": s["other"].pk}).status_code == 403
    assert s["api"].post(CATALOG, {"kind": "groups", "divisionId": s["other"].pk, "name": "Foreign", "maxMembers": 4}, format="json").status_code == 403
    assert s["api"].patch(f'{CATALOG}{s["groups"][1].pk}/?kind=groups', {"name": "Stolen"}, format="json").status_code == 403
    s["groups"][1].refresh_from_db()
    assert s["groups"][1].name == "БГ-1"


def test_candidates_are_scoped_and_resolve_status_on_requested_day(scene):
    s = scene
    OpsEmployeeStatus.objects.create(employee_id=s["people"][1].pk, status_type_code="VACATION", date_start=DAY, date_end=DAY + timedelta(days=1))
    response = s["api"].get(CANDIDATES, {"date": DAY.isoformat(), "division_id": s["own"].pk})
    assert response.status_code == 200
    rows = {row["employeeId"]: row for row in response.json()["results"]}
    assert str(s["people"][3].pk) not in rows
    assert rows[str(s["people"][0].pk)]["inService"]
    assert not rows[str(s["people"][1].pk)]["inService"]
    assert rows[str(s["people"][1].pk)]["blockReason"]


def test_forming_reserves_identities_and_projects_duty_once(scene):
    s = scene
    data = form(s)
    assert data["stateCode"] == "SUBMITTED"
    assert data["location"]["kind"] == "POINT"
    assert data["event"] is None
    rows = list(OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True))
    assert len(rows) == 2 and {r.employee_id for r in rows} == {p.pk for p in s["people"][:2]}
    assert all(r.status_type_code == "DUTY" and r.source == "OM_AUTO" and r.date_start == DAY and r.date_end == DAY + timedelta(days=1) for r in rows)
    board = s["api"].get(BOARD, {"date": DAY.isoformat(), "division_id": s["own"].pk}).json()
    assert board["summary"]["people"] == 2 and board["summary"]["formedGroups"] == 1
    duplicate = s["api"].post(BOARD, payload(s), format="json")
    assert duplicate.status_code == 422 and duplicate.json()["error_code"] == "GROUP_ALREADY_FORMED"
    assert OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True).count() == 2


def test_double_assignment_blocks_submitted_groups(scene):
    s = scene
    form(s)
    group = OpsCombatGroup.objects.create(name="БГ-2", division=s["own"], max_members=4)
    r = s["api"].post(BOARD, payload(s, groupId=group.pk), format="json")
    assert r.status_code == 422 and r.json()["error_code"] == "DOUBLE_ASSIGNMENT"


@pytest.mark.parametrize("change,code", [
    ({"members": []}, "EMPTY_GROUP"),
    ({"members": [{"employeeId": "foreign", "isLeader": True}]}, "VALIDATION_ERROR"),
    ({"location": {"kind": "POINT", "latitude": 91, "longitude": 10}}, "INVALID_LOCATION"),
])
def test_invalid_form_is_atomic(scene, change, code):
    s = scene
    r = s["api"].post(BOARD, payload(s, **change), format="json")
    assert r.status_code == 422 and r.json()["error_code"] == code
    assert not s["groups"][0].shifts.exists()


def test_foreign_employee_and_catalog_id_are_rejected(scene):
    s = scene
    r = s["api"].post(BOARD, payload(s, members=[{"employeeId": s["people"][3].pk, "isLeader": True}]), format="json")
    assert r.status_code == 403
    r = s["api"].post(BOARD, payload(s, groupId=s["groups"][1].pk), format="json")
    assert r.status_code == 403
    assert not OpsEmployeeStatus.objects.filter(source="OM_AUTO").exists()


def test_absence_cannot_be_bypassed_in_payload(scene):
    s = scene
    OpsEmployeeStatus.objects.create(employee_id=s["people"][0].pk, status_type_code="VACATION", date_start=DAY, date_end=DAY + timedelta(days=1))
    r = s["api"].post(BOARD, payload(s, override=True), format="json")
    assert r.status_code == 422
    assert not s["groups"][0].shifts.exists()


def test_daily_shift_projects_following_day_rest(scene):
    s = scene
    s["kind"].shift_kind, s["kind"].rest_day_after = "DAILY", True
    s["kind"].save()
    data = form(s)
    rest = OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', status_type_code="REST_AFTER_DUTY", cancelled_at__isnull=True)
    assert rest.count() == 2
    assert all(r.date_start == DAY + timedelta(days=1) and r.date_end == DAY + timedelta(days=2) for r in rest)


def test_return_and_cancel_release_only_this_groups_projections(scene):
    s = scene
    data = form(s)
    path = f'{BOARD}{data["id"]}/'
    assert s["api"].post(path + "review/", {"decision": "RETURN", "reason": "Change roster"}, format="json").status_code == 403
    r = s["staff"].post(path + "review/", {"decision": "RETURN", "reason": "Change roster"}, format="json")
    assert r.status_code == 200, r.data
    assert not OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True).exists()
    r = s["api"].post(path + "resubmit/", payload(s), format="json")
    assert r.status_code == 200, r.data
    r = s["api"].post(path + "cancel/", {"reason": "Plan changed"}, format="json")
    assert r.status_code == 200, r.data
    assert not OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True).exists()
