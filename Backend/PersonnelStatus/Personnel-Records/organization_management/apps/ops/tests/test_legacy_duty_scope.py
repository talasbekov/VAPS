"""The retired planner must enforce the live employee's duty grant scope."""
from datetime import date, datetime, timezone

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import override
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy, OpsDutyMonthlyPlan, OpsDutyShift, OpsDutyType,
)
from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops import duties
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db
SHIFTS = "/api/ops/duty-shifts/"
MONTH = "/api/ops/duty-monthly-plan/"
DAY = date(2026, 10, 15)


@pytest.fixture
def duty_scope_scene():
    own = Division.objects.create(name="Legacy own", division_type="department")
    child = Division.objects.create(name="Legacy child", division_type="directorate", parent=own)
    foreign = Division.objects.create(name="Legacy foreign", division_type="department")
    OpsDutyType.objects.update_or_create(duty_type_code="SCOPE_DUTY", defaults={
        "safe_label": "Scope duty", "target_type": "OWN_OBJECT",
        "default_duration_minutes": 60, "requires_senior": False,
        "rest_after_minutes": 0, "requires_current_passport": False,
    })
    OpsDutyConflictPolicy.objects.update_or_create(singleton_key=1, defaults={
        "version": "scope-policy", "rest_after_duty_mode": "HARD_BLOCK",
    })
    obj = make_object(code="SCOPE-OBJ", name="Scope object", with_passport=True)
    people, shifts = [], []
    for index, division in enumerate((own, child, foreign), 1):
        person = Employee.objects.create(
            id=9007199254740990 + index, personnel_number=f"legacy-scope-{index}",
            first_name="Scope", last_name=f"Person{index}", birth_date=None, hire_date=None,
        )
        StaffUnit.objects.create(index=index, employee=person, division=division)
        people.append(person)
        shifts.append(OpsDutyShift.objects.create(
            business_date=DAY, duty_type_code="SCOPE_DUTY", employee_id=str(person.pk),
            employee_name=f"Scope Person{index}", state_code="PLANNED",
            target={"targetType": "OWN_OBJECT", "objectId": str(obj.pk), "safeLabel": "Scope object"},
        ))
    with override(datetime(2026, 10, 15, 7, 0, tzinfo=timezone.utc)):
        yield {"own": own, "child": child, "foreign": foreign, "people": people,
               "shifts": shifts, "object": obj}


def scope_client(scene, global_grant, *, object_permission=True):
    codes = ["duty.view", "duty.manage", "duty.approve_plan"]
    if object_permission:
        codes.append("object.view")
    return client_for("legacy-scope-user", "LEGACY_SCOPE_ROLE", codes,
                      scope_division_id=None if global_grant else scene["own"].pk)


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_legacy_list_filters_shifts_and_related_passport_rows(duty_scope_scene, global_grant):
    scene = duty_scope_scene
    api, _ = scope_client(scene, global_grant)
    response = api.get(SHIFTS)
    assert response.status_code == 200
    want = {str(row.pk) for row in scene["shifts"][:3 if global_grant else 2]}
    assert {row["id"] for row in response.data["results"]} == want
    assert {row["shiftId"] for row in response.data["passportStatuses"]} == want


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_monthly_read_uses_scope_without_exposing_global_validation_history(duty_scope_scene, global_grant):
    scene = duty_scope_scene
    plan = OpsDutyMonthlyPlan.objects.create(month="2026-10", state_code="DRAFT", revision=1,
        last_validation={"passed": False, "planFingerprint": "foreign-shift-secret", "foreignName": "Foreign person"},
        history=[{"note": "Foreign historical note"}], approved_by="foreign-approver")
    api, _ = scope_client(scene, global_grant)
    response = api.get(MONTH, {"month": "2026-10"})
    assert response.status_code == 200
    assert len(response.data["shifts"]) == (3 if global_grant else 2)
    assert response.data["kpi"]["totalShifts"] == (3 if global_grant else 2)
    if global_grant:
        assert response.data["record"]["lastValidation"] == plan.last_validation
        assert response.data["record"]["history"] == plan.history
        assert response.data["record"]["approvedBy"] == "foreign-approver"
    else:
        assert response.data["record"]["lastValidation"] is None
        assert response.data["record"]["history"] == []
        assert response.data["record"]["approvedBy"] is None
        assert all(not row["enabled"] for row in response.data["actions"] if row["code"] != "ADD_SHIFT")


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
@pytest.mark.parametrize("foreign", [False, True], ids=["own", "foreign"])
def test_legacy_detail_obeys_live_division(duty_scope_scene, global_grant, foreign):
    scene = duty_scope_scene
    row = scene["shifts"][2 if foreign else 0]
    api, _ = scope_client(scene, global_grant)
    response = api.get(f"{SHIFTS}{row.pk}/")
    assert response.status_code == (403 if foreign and not global_grant else 200)


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
@pytest.mark.parametrize("foreign", [False, True], ids=["own", "foreign"])
@pytest.mark.parametrize("action,initial,result", [
    ("cancel", "PLANNED", "CANCELLED"),
    ("acknowledge", "PLANNED", "ACKNOWLEDGED"),
    ("clock-in", "ACKNOWLEDGED", "ACTIVE"),
    ("clock-out", "ACTIVE", "COMPLETED"),
])
def test_each_legacy_mutation_enforces_manage_scope(duty_scope_scene, global_grant, foreign, action, initial, result):
    scene = duty_scope_scene
    row = scene["shifts"][2 if foreign else 0]
    row.state_code = initial
    row.save(update_fields=["state_code"])
    api, _ = scope_client(scene, global_grant)
    response = api.post(f"{SHIFTS}{row.pk}/{action}/", {"reason": "Scoped cancellation"}, format="json")
    allowed = global_grant or not foreign
    assert response.status_code == (200 if allowed else 403), response.data
    row.refresh_from_db()
    assert row.state_code == (result if allowed else initial)


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
@pytest.mark.parametrize("foreign", [False, True], ids=["own", "foreign"])
def test_legacy_create_checks_employee_scope(duty_scope_scene, global_grant, foreign):
    scene = duty_scope_scene
    api, _ = scope_client(scene, global_grant)
    response = api.post(SHIFTS, {"businessDate": "2026-10-20", "dutyTypeCode": "SCOPE_DUTY",
        "objectId": str(scene["object"].pk), "employeeId": str(scene["people"][2 if foreign else 0].pk)}, format="json")
    allowed = global_grant or not foreign
    assert response.status_code == (201 if allowed else 403), response.data
    assert OpsDutyShift.objects.filter(business_date="2026-10-20").count() == int(allowed)


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
def test_candidates_use_manage_scope_with_exact_imported_ids(duty_scope_scene, global_grant):
    scene = duty_scope_scene
    api, _ = scope_client(scene, global_grant)
    response = api.get("/api/ops/duty-candidates/", {"date": DAY.isoformat()})
    assert response.status_code == 200
    assert {row["employeeId"] for row in response.data["results"]} == {
        str(row.pk) for row in scene["people"][:3 if global_grant else 2]}
    assert all(row["busyOnRequestedDate"] for row in response.data["results"])


@pytest.mark.parametrize("global_grant", [False, True], ids=["scoped", "global"])
@pytest.mark.parametrize("object_permission", [False, True], ids=["no-catalog-right", "catalog-right"])
def test_shared_object_catalog_requires_explicit_right_for_scoped_planner(duty_scope_scene, global_grant, object_permission):
    scene = duty_scope_scene
    api, _ = scope_client(scene, global_grant, object_permission=object_permission)
    response = api.get("/api/ops/duty-plan-objects/", {"date": DAY.isoformat()})
    assert response.status_code == (200 if global_grant or object_permission else 403)
    if response.status_code == 200:
        assert [row["objectId"] for row in response.data["results"]] == [str(scene["object"].pk)]


@pytest.mark.parametrize("action", ["draft", "check", "approve", "reopen"])
def test_scoped_grant_cannot_mutate_global_month(duty_scope_scene, action):
    api, _ = scope_client(duty_scope_scene, False)
    before = OpsDutyMonthlyPlan.objects.count()
    response = api.post(f"{MONTH}{action}/", {"month": "2026-10"}, format="json")
    assert response.status_code == 403, response.data
    assert OpsDutyMonthlyPlan.objects.count() == before


def test_detail_conflicts_do_not_reveal_same_named_foreign_employee(duty_scope_scene):
    scene = duty_scope_scene
    own, _, foreign = scene["shifts"]
    foreign.employee_name = own.employee_name
    foreign.save(update_fields=["employee_name"])
    api, _ = scope_client(scene, False)
    response = api.get(f"{SHIFTS}{own.pk}/")
    assert response.status_code == 200
    assert response.data["conflicts"] == []


@pytest.mark.parametrize("identifier", [None, "unlinked", "١", "9223372036854775808", "0001"])
def test_name_or_unusable_employee_id_never_grants_live_scope(duty_scope_scene, identifier):
    scene = duty_scope_scene
    orphan = OpsDutyShift.objects.create(business_date=DAY, duty_type_code="SCOPE_DUTY", target={},
        employee_id=identifier, employee_name=scene["shifts"][0].employee_name, state_code="PLANNED")
    api, _ = scope_client(scene, False)
    assert str(orphan.pk) not in {row["id"] for row in api.get(SHIFTS).data["results"]}
    assert api.get(f"{SHIFTS}{orphan.pk}/").status_code == 403
    assert api.post(f"{SHIFTS}{orphan.pk}/cancel/", {"reason": "Try guessing"}, format="json").status_code == 403
    orphan.refresh_from_db()
    assert orphan.state_code == "PLANNED"


def test_frozen_journal_history_does_not_authorize_live_transferred_plan(duty_scope_scene):
    scene = duty_scope_scene
    person, row = scene["people"][0], scene["shifts"][0]
    OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=row.pk,
        employee_id=person.pk, employee_name="Historic own person", division_id=scene["own"].pk,
        division_name=scene["own"].name)
    StaffUnit.objects.filter(employee=person).update(division=scene["foreign"])
    api, _ = scope_client(scene, False)
    assert api.get(f"/api/ops/duty-register/PLAN:{row.pk}/").status_code == 200
    assert api.get(f"{SHIFTS}{row.pk}/").status_code == 403
    assert str(row.pk) not in {item["id"] for item in api.get(SHIFTS).data["results"]}


@pytest.mark.parametrize("action,initial,result", [
    ("cancel", "PLANNED", "CANCELLED"),
    ("acknowledge", "PLANNED", "ACKNOWLEDGED"),
    ("start", "ACKNOWLEDGED", "ACTIVE"),
    ("complete", "ACTIVE", "COMPLETED"),
])
@pytest.mark.parametrize("global_grant,transferred", [
    (False, False), (False, True), (True, True),
], ids=["own", "historical-only", "global"])
def test_journal_plan_mutations_require_live_scope_as_well_as_frozen_history(
        duty_scope_scene, action, initial, result, global_grant, transferred):
    scene = duty_scope_scene
    person, row = scene["people"][0], scene["shifts"][0]
    OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=row.pk,
        employee_id=person.pk, employee_name="Historic own person", division_id=scene["own"].pk,
        division_name=scene["own"].name)
    if transferred:
        StaffUnit.objects.filter(employee=person).update(division=scene["foreign"])
    row.state_code = initial
    row.acknowledged_at = datetime(2026, 10, 15, 5, tzinfo=timezone.utc) if initial != "PLANNED" else None
    row.actual_start = datetime(2026, 10, 15, 6, tzinfo=timezone.utc) if initial == "ACTIVE" else None
    row.save()
    before = (row.updated_at, row.acknowledged_at, row.actual_start, row.actual_end, row.cancellation)
    api, _ = scope_client(scene, global_grant)
    path = f"/api/ops/duty-register/PLAN:{row.pk}/"
    detail = api.get(path)
    assert detail.status_code == 200
    assert detail.data["employee_name"] == "Historic own person"
    assert detail.data["division_id"] == scene["own"].pk
    listing = api.get("/api/ops/duty-register/", {"from": DAY.isoformat(), "to": DAY.isoformat()})
    listed = next(item for item in listing.data["rows"] if item["id"] == f"PLAN:{row.pk}")
    response = api.post(path + action + "/", {"reason": "Frozen transfer test"}, format="json")
    allowed = global_grant or not transferred
    assert response.status_code == (200 if allowed else 403), response.data
    row.refresh_from_db()
    assert row.state_code == (result if allowed else initial)
    if allowed:
        assert action in detail.data["actions"]
        assert action in listed["actions"]
    else:
        assert detail.data["actions"] == []
        assert listed["actions"] == []
        assert (row.updated_at, row.acknowledged_at, row.actual_start, row.actual_end, row.cancellation) == before
        assert api.get(path).status_code == 200


@pytest.mark.parametrize("action,initial", [
    ("cancel", "PLANNED"), ("acknowledge", "PLANNED"),
    ("start", "ACKNOWLEDGED"), ("complete", "ACTIVE"), ("classify", "PLANNED"),
])
def test_current_division_cannot_use_a_mutation_to_read_foreign_frozen_history(duty_scope_scene, action, initial):
    scene = duty_scope_scene
    person, row = scene["people"][0], scene["shifts"][0]
    OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=row.pk,
        employee_id=person.pk, employee_name="Historic own person", division_id=scene["own"].pk,
        division_name=scene["own"].name)
    StaffUnit.objects.filter(employee=person).update(division=scene["foreign"])
    row.state_code = initial
    row.actual_start = datetime(2026, 10, 15, 6, tzinfo=timezone.utc) if initial == "ACTIVE" else None
    row.save()
    api, _ = client_for("current-division-user", "CURRENT_DIVISION_ROLE", ("duty.view", "duty.manage"), scene["foreign"].pk)
    path = f"/api/ops/duty-register/PLAN:{row.pk}/"
    assert api.get(path).status_code == 403
    response = api.post(path + action + "/", {"reason": "Frozen transfer test", "service_duty_code": "SAKSHY"}, format="json")
    assert response.status_code == 403, response.data
    row.refresh_from_db()
    assert row.state_code == initial


@pytest.mark.parametrize("global_grant", [False, True], ids=["historical-only", "global"])
def test_transferred_plan_classification_requires_global_or_both_scopes(duty_scope_scene, global_grant):
    scene = duty_scope_scene
    person, row = scene["people"][0], scene["shifts"][0]
    supplement = OpsDutyRecordSupplement.objects.create(source_type="PLAN", source_id=row.pk,
        employee_id=person.pk, employee_name="Historic own person", division_id=scene["own"].pk,
        division_name=scene["own"].name)
    StaffUnit.objects.filter(employee=person).update(division=scene["foreign"])
    OpsDictionaryEntry.objects.update_or_create(dictionary_code="SERVICE_DUTY_KINDS", code="SCOPE_KIND",
        defaults={"label": "Scope classification", "description": "", "is_active": True})
    api, _ = scope_client(scene, global_grant)
    path = f"/api/ops/duty-register/PLAN:{row.pk}/"
    before = api.get(path)
    assert before.status_code == 200
    assert ("classify" in before.data["actions"]) is global_grant
    response = api.post(path + "classify/", {"reason": "Historical classification", "service_duty_code": "SCOPE_KIND"}, format="json")
    assert response.status_code == (200 if global_grant else 403), response.data
    supplement.refresh_from_db()
    assert supplement.service_duty_code == ("SCOPE_KIND" if global_grant else "")
    row.refresh_from_db()
    assert row.state_code == "PLANNED"
    assert api.get(path).status_code == 200


def test_explicit_missing_scope_actor_is_denied_in_service(duty_scope_scene):
    row = duty_scope_scene["shifts"][0]
    with pytest.raises(DomainError) as caught:
        duties.cancel_shift(row.pk, reason="Missing actor", actor="audit-only", scope_actor=None)
    assert caught.value.http_status == 403
    row.refresh_from_db()
    assert row.state_code == "PLANNED"


@pytest.mark.parametrize("global_permission,read_allowed,write_allowed", [
    ("duty.view", True, False), ("duty.manage", False, True),
])
def test_read_and_manage_grant_scopes_are_independent(duty_scope_scene, global_permission, read_allowed, write_allowed):
    scene = duty_scope_scene
    api, user = scope_client(scene, False)
    role = Role.objects.create(code="LEGACY_EXTRA_GLOBAL", name="Extra global grant")
    permission, _ = Permission.objects.get_or_create(code=global_permission, defaults={"name": global_permission})
    RolePermission.objects.create(role_code=role, permission_code=permission)
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=None)
    foreign = scene["shifts"][2]
    assert (str(foreign.pk) in {row["id"] for row in api.get(SHIFTS).data["results"]}) is read_allowed
    assert api.get(f"{SHIFTS}{foreign.pk}/").status_code == (200 if read_allowed else 403)
    response = api.post(f"{SHIFTS}{foreign.pk}/cancel/", {"reason": "Separate grant scopes"}, format="json")
    assert response.status_code == (200 if write_allowed else 403)
    foreign.refresh_from_db()
    assert foreign.state_code == ("CANCELLED" if write_allowed else "PLANNED")


def test_padding_a_known_employee_id_does_not_create_live_scope(duty_scope_scene):
    scene = duty_scope_scene
    row = scene["shifts"][0]
    row.employee_id = "0" + row.employee_id
    row.save(update_fields=["employee_id"])
    api, _ = scope_client(scene, False)
    assert api.get(f"{SHIFTS}{row.pk}/").status_code == 403
    assert str(row.pk) not in {item["id"] for item in api.get(SHIFTS).data["results"]}


def test_scoped_create_cannot_bypass_shared_catalog_permission(duty_scope_scene):
    scene = duty_scope_scene
    api, _ = scope_client(scene, False, object_permission=False)
    response = api.post(SHIFTS, {"businessDate": "2026-10-20", "dutyTypeCode": "SCOPE_DUTY",
        "objectId": str(scene["object"].pk), "employeeId": str(scene["people"][0].pk)}, format="json")
    assert response.status_code == 403
    assert not OpsDutyShift.objects.filter(business_date="2026-10-20").exists()


@pytest.mark.parametrize("identifier", ["9223372036854775808", "١", "0001"])
def test_unusable_shift_identifier_returns_controlled_not_found(duty_scope_scene, identifier):
    api, _ = scope_client(duty_scope_scene, True)
    assert api.get(f"{SHIFTS}{identifier}/").status_code == 404
    assert api.post(f"{SHIFTS}{identifier}/cancel/", {"reason": "Invalid key"}, format="json").status_code == 404


@pytest.mark.parametrize("operation,month", [
    ("month_shifts", "2026-1０"), ("create_draft", "2026-13"),
])
def test_month_cannot_address_one_calendar_period_with_an_alternate_lock_key(duty_scope_scene, operation, month):
    # Calendar filters must use exactly the same canonical month as locks.
    with pytest.raises(DomainError) as caught:
        getattr(duties, operation)(month)
    assert caught.value.http_status == 400
