from datetime import timedelta

import pytest

from organization_management.apps.operations.api.serializers import OpsEmployeeStatusSerializer
from organization_management.apps.operations.models_combat import OpsCombatPlace, OpsCombatRoute
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsObjectSector, OpsSecurityPost
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import status_calendar
from organization_management.apps.ops.duty_dispatch import DutyContext
from organization_management.apps.ops.tests.test_combat_day_planning import BOARD, DAY, form, payload, scene  # noqa: F401

pytestmark = pytest.mark.django_db


def combat_event(s, code="CD-OPTIONAL"):
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    return OpsSecurityEvent.objects.create(code=code, title="Optional duty event", object_name="Object", business_date=DAY, stage="BULLETIN", readiness_percent=0, force_need=0, conflicts_count=0, owner_name="Head", owner_actor_id=str(s["user"].pk), recon_checklist=[], recon_sector_posts=[], demand_rows=[], demand_approved=False, force_requests=[], placement_assignments=[], approval_status="PENDING", journal_entries=[], closure_direction_summaries=[])


@pytest.mark.parametrize("kind,extra", [("groups", {"maxMembers": 5}), ("routes", {"code": "NEW"}), ("types", {"code": "NEW", "shiftKind": "DAILY", "restDayAfter": True})])
def test_scoped_catalog_create_edit_disable_and_duplicate_are_atomic(scene, kind, extra):
    s = scene
    path = "/api/ops/combat-catalogs/"
    body = {"kind": kind, "divisionId": s["own"].pk, "name": "New entry", **extra}
    r = s["api"].post(path, body, format="json")
    assert r.status_code == 201, r.data
    assert r.json()["divisionId"] == str(s["own"].pk)
    pk = r.json()["id"]
    update = s["api"].patch(f"{path}{pk}/?kind={kind}", {"name": "Edited entry", "isActive": False}, format="json")
    assert update.status_code == 200, update.data
    assert not update.json()["isActive"] and update.json()["name"] == "Edited entry"
    assert s["api"].post(path, {**body, "name": "Edited entry"}, format="json").status_code == 422


def test_permission_migration_seeds_existing_departments_idempotently(scene):
    from importlib import import_module
    from django.apps import apps
    from organization_management.apps.operations.models_combat import OpsCombatDutyType
    seed = import_module("organization_management.apps.operations.migrations.0150_combat_day_permissions").seed
    seed(apps, None)
    seed(apps, None)
    assert OpsCombatDutyType.objects.filter(division=scene["other"]).count() == 3
    daily = OpsCombatDutyType.objects.get(division=scene["other"], duty_type_code="DAILY")
    assert daily.rest_day_after and not daily.supports_multiple_routes


def test_group_details_reach_status_calendar_expense_and_dispatch(scene):
    s = scene
    shift = form(s)
    facts = OpsEmployeeStatus.objects.filter(source_ref=f'combat:{shift["id"]}')
    serialized = OpsEmployeeStatusSerializer(facts, many=True).data
    assert len(serialized) == 2
    assert all(row["combat_assignment"]["group_name"] == "БГ-1" for row in serialized)
    assert all("Групповое" in row["destination"] for row in serialized)
    panel = status_calendar.day_panel(on_date=DAY, scope_division_ids={s["own"].pk, s["child"].pk})
    assert panel["groups"]["on_duty"]["count"] == 2
    assert panel["groups"]["on_duty"]["employees"][0]["combat_assignment"]["shift_id"] == shift["id"]
    context = DutyContext(DAY, DAY)
    assert context.busy_reason(s["people"][0].pk, DAY)
    assert not OpsEmployeeStatus.objects.filter(date_start=DAY - timedelta(days=1)).exists()


def test_legacy_api_cannot_bypass_identity_workflow(scene):
    shift = form(scene)
    legacy_manager, _ = client_for("legacy-full-duty-manager", "LEGACY_FULL_DUTY_MANAGER", ["duty.manage"], scene["own"].pk)
    for action, body in [("review", {"decision": "ACCEPT"}), ("acknowledge", {"employeeName": "Someone"}), ("replace", {}), ("check-in", {})]:
        r = legacy_manager.post(f'/api/ops/combat-duty-shifts/{shift["id"]}/{action}/', body, format="json")
        assert r.status_code == 422, r.data
    assert scene["api"].get(f'{BOARD}{shift["id"]}/').json()["stateCode"] == "SUBMITTED"


def test_combat_manager_has_scoped_candidates_and_review_without_legacy_management(scene):
    s = scene
    choices = s["staff"].get(BOARD + "choices/", {"date": DAY.isoformat(), "division_id": s["own"].pk})
    assert choices.status_code == 200, choices.data
    assert choices.json()["permissions"]["review"]
    assert choices.json()["permissions"]["roster"]
    candidates = s["staff"].get("/api/ops/combat-roster-candidates/", {"date": DAY.isoformat(), "division_id": s["own"].pk})
    assert candidates.status_code == 200, candidates.data
    assert str(s["people"][3].pk) not in {p["employeeId"] for p in candidates.json()["results"]}
    assert s["staff"].get("/api/ops/combat-roster-candidates/", {"date": DAY.isoformat(), "division_id": s["other"].pk}).status_code == 403
    shift = form(s)
    assert s["staff"].post(f'/api/ops/combat-duty-shifts/{shift["id"]}/review/', {"decision": "ACCEPT"}, format="json").status_code == 403
    accepted = s["staff"].post(f'{BOARD}{shift["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert accepted.status_code == 200, accepted.data


def test_seeded_duty_officer_gets_combat_management_without_legacy_write_rights(scene):
    from django.core.management import call_command
    from organization_management.apps.operations.services import PermissionService
    call_command("seed_operations", verbosity=0)
    api, user = client_for("native-combat-duty-officer", "DUTY_OFFICER", [], scene["own"].pk)
    rights = PermissionService.effective_permissions(str(user.pk))
    assert "duty.combat.manage" in rights
    assert not rights & {"duty.manage", "status.manage", "status.workspace"}
    shift = form(scene)
    response = api.post(f'{BOARD}{shift["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert response.status_code == 200, response.data
    assert api.post('/api/ops/combat-duty-shifts/', {}, format='json').status_code == 403


@pytest.mark.parametrize('permission', ['duty.roster', 'duty.combat.manage'])
@pytest.mark.parametrize('status_scope', [None, 'other', 'own'])
def test_candidate_availability_does_not_disclose_status_details_from_another_scope(scene, permission, status_scope):
    from organization_management.apps.operations.models import Role, RolePermission, UserRole
    s = scene
    api, user = client_for('availability-only', 'AVAILABILITY_ONLY', [permission], s['own'].pk)
    if status_scope:
        role = Role.objects.create(code='CANDIDATE_STATUS_VIEW', name='Candidate status view')
        RolePermission.objects.create(role_code=role, permission_code_id='status.view')
        UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=s[status_scope].pk)
    for person, code in zip(s['people'][:2], ['VACATION', 'IN_EVENT']):
        OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code=code, date_start=DAY, date_end=DAY + timedelta(days=1))
    response = api.get('/api/ops/combat-roster-candidates/', {'date': DAY.isoformat(), 'division_id': s['own'].pk})
    assert response.status_code == 200, response.data
    rows = {p['employeeId']: p for p in response.json()['results']}
    absent, assigned = (rows[str(p.pk)] for p in s['people'][:2])
    assert not absent['inService'] and assigned['inService']
    if status_scope == 'own':
        assert absent['statusCode'] == 'VACATION'
        assert assigned['statusCode'] == 'IN_EVENT' and assigned['eventWarning']
    else:
        assert absent['statusCode'] == 'UNAVAILABLE'
        assert absent['blockReason'] == 'Сотрудник недоступен на выбранную дату.'
        assert assigned['statusCode'] == 'IN_SERVICE' and not assigned['eventWarning']
        rejected = api.post(BOARD, payload(s), format='json')
        assert rejected.status_code == 422, rejected.data
        assert rejected.json()['message'] == 'Сотрудник недоступен на выбранную дату.'


def test_owned_object_and_post_and_route_selection(scene):
    s = scene
    obj = OpsSecurityObject.objects.create(name="Duty object", code="CD-OBJ", object_type="BUILDING", region="Test", address="Test", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Sector", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Post", position=1)
    OpsCombatPlace.objects.create(division=s["other"], security_object=obj)
    location = {"kind": "POST", "objectId": obj.pk, "postId": post.pk}
    assert s["api"].post(BOARD, payload(s, location=location), format="json").status_code == 403
    OpsCombatPlace.objects.create(division=s["own"], security_object=obj)
    assert form(s, location=location)["location"]["label"] == "Duty object · Post"


def test_plain_employee_can_read_only_own_personal_group(scene):
    s = scene
    api, user = client_for("plain-combat-member", "PLAIN_COMBAT", [])
    person = s["people"][0]
    person.user = user
    person.save(update_fields=["user"])
    shift = form(s)
    assert api.get(f'{BOARD}{shift["id"]}/').status_code == 200
    assert api.get(BOARD, {"date": DAY.isoformat()}).status_code == 403
    assert api.post(f'{BOARD}{shift["id"]}/cancel/', {"reason": "No"}, format="json").status_code == 403


def test_choices_optional_event_is_scoped_to_duty_department(scene):
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    s = scene
    event = OpsSecurityEvent.objects.create(code="CD-EVENT", title="Scoped event", object_name="Object", business_date=DAY, stage="BULLETIN", readiness_percent=0, force_need=0, conflicts_count=0, owner_name="Head", owner_actor_id=str(s["user"].pk), recon_checklist=[], recon_sector_posts=[], demand_rows=[], demand_approved=False, force_requests=[], placement_assignments=[], approval_status="PENDING", journal_entries=[], closure_direction_summaries=[])
    response = s["api"].get(BOARD + "choices/", {"date": DAY.isoformat(), "division_id": s["own"].pk})
    assert response.status_code == 200, response.data
    assert response.json()["events"] == [{"id": str(event.pk), "title": "Scoped event", "businessDate": DAY.isoformat()}]
    assert form(s, eventId=event.pk)["event"]["title"] == "Scoped event"
    foreign, _ = client_for("foreign-event", "FOREIGN_EVENT", ["duty.view", "duty.roster"], s["other"].pk)
    assert foreign.get(BOARD + "choices/", {"date": DAY.isoformat()}).json()["events"] == []
    # A centrally owned event becomes available through its actual sent request.
    event.owner_actor_id = "central-headquarters"
    event.force_allocation = [{"departmentId": str(s["own"].pk), "need": 2}]
    event.save(update_fields=["owner_actor_id", "force_allocation"])
    assert s["api"].get(BOARD + "choices/", {"date": DAY.isoformat()}).json()["events"] == []
    event.force_allocation[0].update(sentAt="2026-11-03T06:00:00Z", directorates=[{"directorateId": str(s["child"].pk), "requestedAt": "2026-11-03T06:10:00Z"}])
    event.save(update_fields=["force_allocation"])
    assert s["api"].get(BOARD + "choices/", {"date": DAY.isoformat()}).json()["events"][0]["id"] == str(event.pk)
    unit, _ = client_for("combat-event-unit", "COMBAT_EVENT_UNIT", ["duty.view", "duty.roster"], s["child"].pk)
    assert unit.get(BOARD + "choices/", {"date": DAY.isoformat()}).json()["events"][0]["id"] == str(event.pk)
    assert foreign.get(BOARD + "choices/", {"date": DAY.isoformat()}).json()["events"] == []


def test_modern_assignment_blocks_legacy_abbreviated_name(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops import combat
    from organization_management.apps.ops.security_events import personnel_display_name
    form(scene)
    old = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="legacy", group_name="Old", route_set={}, required_employees=2)
    with pytest.raises(DomainError) as caught:
        combat.submit_roster(old.pk, group_leader=personnel_display_name(scene["people"][0]), members=["Legacy member"], reserve=[], submitted_by_unit="Own", submitted_by_division_id=scene["own"].pk)
    assert caught.value.code == "DOUBLE_ASSIGNMENT"


def test_personal_active_group_survives_midnight(scene, monkeypatch):
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    s = scene
    person = s["people"][0]
    person.user = s["user"]
    person.save(update_fields=["user"])
    data = form(s)
    OpsCombatDutyShift.objects.filter(pk=data["id"]).update(state_code="ACCEPTED", submission={"execution": {"stateCode": "ACTIVE"}})
    monkeypatch.setattr(Clock, "today_local", staticmethod(lambda: DAY + timedelta(days=1)))
    response = s["api"].get(BOARD + "mine/")
    assert response.status_code == 200
    assert response.json()["results"][0]["id"] == data["id"]


@pytest.mark.parametrize("linked", [True, False])
def test_legacy_resubmit_cannot_change_owner_outside_grant(scene, linked):
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    s = scene
    api, user = client_for("moved-legacy-head", "MOVED_LEGACY_HEAD", ["duty.manage"], s["own"].pk)
    person = s["people"][3]
    if linked:
        person.user = user
        person.save(update_fields=["user"])
    old = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="legacy", route_set={}, required_employees=2, submission={"stateCode": "RETURNED", "submittedByDivisionId": s["own"].pk})
    response = api.post(f'/api/ops/combat-duty-shifts/{old.pk}/submit/', {"groupLeaderEmployeeName": "Leader", "memberEmployeeNames": ["Member"]}, format="json")
    assert response.status_code == 403
    old.refresh_from_db()
    assert old.submission["submittedByDivisionId"] == s["own"].pk


def test_submitted_expense_is_amended_atomically_with_formation_and_cancel(scene):
    from organization_management.apps.operations.day_submission_service import submit_day
    from organization_management.apps.operations.models_submission import OpsDailySubmission
    from organization_management.apps.operations.strength_report import submitted_expense
    s = scene
    submit_day(division_id=s["own"].pk, business_date=DAY, actor=str(s["user"].pk), window_dates=[DAY])
    baseline = submitted_expense(s["own"].pk, DAY)
    assert baseline.columns["ON_DUTY"] == 0
    data = form(s, amendmentReason="Состав группы уточнён")
    changed = submitted_expense(s["own"].pk, DAY)
    assert changed.columns["ON_DUTY"] == 2
    assert OpsDailySubmission.objects.filter(division_id=s["own"].pk, business_date=DAY, is_current=True).get().version == 2
    r = s["api"].post(f'{BOARD}{data["id"]}/cancel/', {"reason": "Группа отменена"}, format="json")
    assert r.status_code == 200, r.data
    restored = submitted_expense(s["own"].pk, DAY)
    assert restored.columns["ON_DUTY"] == 0 and restored.list_total == baseline.list_total


def test_catalog_capacity_edit_does_not_change_accepted_shift_snapshot(scene):
    s = scene
    data = form(s)
    s["groups"][0].max_members = 1
    s["groups"][0].save(update_fields=["max_members"])
    r = s["staff"].post(f'{BOARD}{data["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert r.status_code == 200, r.data
    assert r.json()["maxMembers"] == 3


def test_daily_rest_cannot_overwrite_tomorrows_group(scene):
    s = scene
    form(s, businessDate=(DAY + timedelta(days=1)).isoformat())
    s["kind"].rest_day_after = True
    s["kind"].shift_kind = "DAILY"
    s["kind"].save()
    r = s["api"].post(BOARD, payload(s), format="json")
    assert r.status_code == 422 and r.json()["error_code"] == "DOUBLE_ASSIGNMENT"


def test_group_reservation_blocks_individual_and_personnel_placement(scene):
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.ops.duty_dispatch import guard_legacy_placement
    form(scene)
    with pytest.raises(DomainError) as caught:
        guard_legacy_placement(scene["people"][0].pk, DAY, DAY)
    assert caught.value.code == "DUTY_DISPATCH_CONFLICT"


def test_global_read_does_not_offer_review_actions_for_foreign_owner(scene):
    from organization_management.apps.operations.tests.test_bulk_status_api import seed_role
    from organization_management.apps.operations.services import RoleAdminService
    s = scene
    api, user = client_for("mixed-duty-rights", "MIXED_DUTY_READ", ["duty.view"])
    seed_role("MIXED_DUTY_REVIEW", ["duty.manage"])
    RoleAdminService.assign_role(str(user.pk), "MIXED_DUTY_REVIEW", s["own"].pk, actor="test")
    choices = api.get(BOARD + "choices/", {"date": DAY.isoformat()})
    assert choices.status_code == 200, choices.data
    assert set(choices.json()["permissions"]["reviewDivisionIds"]) == {str(s["own"].pk), str(s["child"].pk)}
    foreign = api.get(BOARD + "choices/", {"date": DAY.isoformat(), "division_id": s["other"].pk})
    assert foreign.status_code == 200, foreign.data
    assert not foreign.json()["permissions"]["review"]
    assert not foreign.json()["permissions"]["roster"]


def test_legacy_automatic_status_without_reference_still_serializes(scene):
    row = OpsEmployeeStatus.objects.create(employee_id=scene["people"][0].pk, status_type_code="DUTY", source="OM_AUTO", source_ref=None, date_start=DAY, date_end=DAY + timedelta(days=1))
    assert OpsEmployeeStatusSerializer(row).data["combat_assignment"] is None
    assert OpsEmployeeStatusSerializer([row], many=True).data[0]["combat_assignment"] is None


def test_replacement_must_respect_next_day_rest_and_other_roster(scene):
    from organization_management.apps.operations.models_combat import OpsCombatGroup
    from organization_management.apps.ops.duty_dispatch import guard_legacy_placement
    from organization_management.apps.operations.exceptions import DomainError
    s = scene
    s["kind"].shift_kind, s["kind"].rest_day_after = "DAILY", True
    s["kind"].save()
    data = form(s)
    r = s["staff"].post(f'{BOARD}{data["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert r.status_code == 200, r.data
    with pytest.raises(DomainError) as caught:
        guard_legacy_placement(s["people"][0].pk, DAY + timedelta(days=1), DAY + timedelta(days=1))
    assert caught.value.code == "DUTY_DISPATCH_CONFLICT"
    s["kind"].shift_kind, s["kind"].rest_day_after = "DAY", False
    s["kind"].save()
    next_group = OpsCombatGroup.objects.create(name="Tomorrow group", division=s["own"], max_members=2)
    form(s, groupId=next_group.pk, businessDate=(DAY + timedelta(days=1)).isoformat(), members=[{"employeeId": s["people"][2].pk, "isLeader": True}])
    result = s["api"].post(f'{BOARD}{data["id"]}/replace/', {"outgoingEmployeeId": s["people"][1].pk, "incomingEmployeeId": s["people"][2].pk, "reason": "Replacement"}, format="json")
    assert result.status_code == 422 and result.json()["error_code"] == "DOUBLE_ASSIGNMENT"
    assert not OpsEmployeeStatus.objects.filter(employee_id=s["people"][2].pk, source_ref=f'combat:{data["id"]}').exists()


def test_board_warns_when_availability_changes_after_formation(scene):
    s = scene
    data = form(s)
    assert not s["api"].get(BOARD, {"date": DAY.isoformat()}).json()["shifts"][0]["warnings"]
    OpsEmployeeStatus.objects.create(employee_id=s["people"][0].pk, status_type_code="SICK_LEAVE", date_start=DAY, date_end=DAY + timedelta(days=1))
    row = s["api"].get(BOARD, {"date": DAY.isoformat()}).json()["shifts"][0]
    assert row["warnings"][0]["employeeId"] == str(s["people"][0].pk)
    assert "SICK" not in str(row["warnings"])
    rejected = s["staff"].post(f'{BOARD}{data["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert rejected.status_code == 422


def test_retiring_native_post_preserves_group_history_and_refuses_acceptance(scene):
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops import passport
    s = scene
    obj = OpsSecurityObject.objects.create(code="CD-RETIRED", name="Retirement object", object_type="BUILDING", region="Test", address="Test", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Sector", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Retired post", position=1)
    OpsCombatPlace.objects.create(division=s["own"], security_object=obj)
    data = form(s, location={"kind": "POST", "objectId": obj.pk, "postId": post.pk})
    sectors = passport.snapshot_sectors(obj)
    sectors[0]["posts"] = []
    passport.update_passport(obj, sectors)
    shift = OpsCombatDutyShift.objects.get(pk=data["id"])
    assert shift.security_post_id == post.pk
    assert shift.location["label"] == "Retirement object · Retired post"
    warning = s["api"].get(BOARD, {"date": DAY.isoformat()}).json()["shifts"][0]["warnings"]
    assert warning and "Пост" in warning[0]["reason"]
    r = s["staff"].post(f'{BOARD}{data["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert r.status_code == 422 and r.json()["error_code"] == "INVALID_LOCATION"


def test_deleting_optional_event_preserves_daily_group_and_duty_facts(scene):
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    from organization_management.apps.ops import security_events
    s = scene
    event = combat_event(s)
    data = form(s, eventId=event.pk)
    security_events.delete_event(event.pk, actor=s["user"])
    shift = OpsCombatDutyShift.objects.get(pk=data["id"])
    assert shift.event_id is None
    assert shift.assignment_snapshot["eventTitle"] == event.title
    assert OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True).count() == 2
    assert s["api"].get(BOARD, {"date": DAY.isoformat()}).json()["summary"]["people"] == 2
    accepted = s["staff"].post(f'{BOARD}{data["id"]}/review/', {"decision": "ACCEPT"}, format="json")
    assert accepted.status_code == 200, accepted.data
    assert accepted.json()["event"] is None
