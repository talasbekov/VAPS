"""Representative live fixtures must preserve unrelated work and survive a rerun."""
import json
from datetime import date, timedelta
from io import StringIO

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock, override
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.models_document import OpsIssuedDocument
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject
from organization_management.apps.operations.models_gvo import OpsForeignVisit, OpsProtectedPerson
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.models_submission import OpsDailySubmission
from organization_management.apps.operations.status_destination import destinations_for
from organization_management.apps.ops import combat, documents_summary, gvo
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def stand(monkeypatch):
    monkeypatch.setenv("ALLOWED_VALIDATION_SEED", "1")
    actor = User.objects.create_user(username="acc_admin")
    call_command("seed_status_types", stdout=StringIO())
    call_command("seed_operations", reference_only=True, stdout=StringIO())
    root = Division.objects.create(name="Validation organization", division_type="organization")
    units = []
    for index in range(1, 4):
        department = Division.objects.create(
            code=f"SEED-D{index}", name=f"Department {index}",
            parent=root, division_type="department",
        )
        units.append(Division.objects.create(
            code=f"SEED-D{index}-U1", name=f"Directorate {index}",
            parent=department, division_type="directorate",
        ))
    return actor, units


def seed(tmp_path, **options):
    manifest = tmp_path / "validation-manifest.json"
    call_command("seed_validation_fixtures", manifest=str(manifest), stdout=StringIO(), **options)
    return json.loads(manifest.read_text(encoding="utf-8"))


def test_requires_explicit_isolated_stand_flag_before_any_write(stand, monkeypatch, tmp_path):
    monkeypatch.delenv("ALLOWED_VALIDATION_SEED")
    before = Employee.objects.count()
    with pytest.raises(CommandError, match="ALLOWED_VALIDATION_SEED"):
        seed(tmp_path)
    assert Employee.objects.count() == before


def test_unknown_actor_is_refused_before_creating_fixtures(stand, tmp_path):
    with pytest.raises(CommandError, match="actor"):
        seed(tmp_path, actor="missing-validation-user")
    assert not Employee.objects.filter(personnel_number__startswith="VLD").exists()


def test_all_absence_types_have_real_personnel_sources_and_destinations(stand, tmp_path):
    manifest = seed(tmp_path)
    statuses = OpsEmployeeStatus.objects.filter(pk__in=manifest["absence_status_ids"])
    assert set(statuses.values_list("status_type_code", flat=True)) == {
        "SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND", "STUDY",
        "COMPETITION", "CONFERENCE", "OTHER_ABSENCE", "DETACHED", "ATTACHED",
    }
    assert set(statuses.values_list("source", flat=True)) == {"PERSONNEL"}
    destinations = destinations_for(statuses)
    assert all(destinations.values())
    assert any("Алматы" in value for value in destinations.values())
    assert any("Астана" in value for value in destinations.values())
    assert all(row.state == "ACTIVE" for row in statuses)


def test_lifecycle_examples_and_duty_states_are_available(stand, tmp_path):
    manifest = seed(tmp_path)
    examples = OpsEmployeeStatus.objects.filter(pk__in=manifest["lifecycle_status_ids"])
    assert {row.state for row in examples} == {"PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"}
    assert set(OpsDutyShift.objects.filter(pk__in=manifest["duty_shift_ids"]).values_list(
        "state_code", flat=True,
    )) == {"PLANNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CANCELLED"}
    assert Secondment.objects.filter(pk=manifest["secondment_id"]).exists()


def test_combat_scope_cases_have_submitted_units_and_legacy_missing_scope(stand, tmp_path):
    _, units = stand
    manifest = seed(tmp_path)
    rows = {row.group_name: row for row in OpsCombatDutyShift.objects.filter(
        pk__in=manifest["combat_shift_ids"],
    )}
    day = manifest["business_date"]
    accepted_a = rows[f"VLD {day} accepted-a"]
    accepted_b = rows[f"VLD {day} accepted-b"]
    assert accepted_a.submission["stateCode"] == "ACCEPTED"
    assert accepted_a.submission["submittedByDivisionId"] == units[0].pk
    assert accepted_b.submission["submittedByDivisionId"] == units[1].pk
    assert rows[f"VLD {day} legacy"].submission["submittedByDivisionId"] is None
    assert rows[f"VLD {day} draft"].submission is None
    assert rows[f"VLD {day} submitted"].submission["stateCode"] == "SUBMITTED"
    assert rows[f"VLD {day} returned"].submission["stateCode"] == "RETURNED"


def test_api_workflow_employee_is_free_and_historical_export_expectations_are_frozen(stand, tmp_path):
    _, units = stand
    manifest = seed(tmp_path)
    workflow = manifest["api_workflows"]
    person = Employee.objects.get(pk=workflow["workflow_employee_id"])
    assert person.staff_unit.division_id == units[1].pk
    assert not OpsEmployeeStatus.objects.filter(employee_id=person.pk).exists()
    submission = OpsDailySubmission.objects.get(pk=manifest["historical_submission_id"])
    assert workflow["snapshot_date"] == submission.business_date.isoformat()
    historical_person = Employee.objects.get(pk=manifest["employees"]["historical-duty"])
    assert f"{historical_person.last_name} {historical_person.first_name}" in workflow["snapshot_expected_text"]


def test_historical_expense_is_issued_without_clearing_current_day_submission(stand, tmp_path):
    actor, units = stand
    today = Clock.today_local()
    existing = submit_day(division_id=units[2].pk, business_date=today, actor=str(actor.pk))
    manifest = seed(tmp_path)
    existing.refresh_from_db()
    assert existing.is_current
    historical = OpsDailySubmission.objects.get(pk=manifest["historical_submission_id"])
    assert historical.business_date < today
    assert historical.snapshot["roster"]
    issued = OpsIssuedDocument.objects.get(pk=manifest["historical_document_id"])
    assert issued.status == "ISSUED"
    assert not OpsDailySubmission.objects.filter(division_id=units[0].pk, business_date=today).exists()


def test_repeat_preserves_ids_row_counts_and_operator_metadata(stand, tmp_path):
    manifest = seed(tmp_path)
    status = OpsEmployeeStatus.objects.get(pk=manifest["lifecycle_status_ids"][0])
    status.comment = "Operator annotation must survive"
    status.save(update_fields=["comment"])
    models = [Employee, StaffUnit, EmployeeStatus, OpsEmployeeStatus, OpsDutyShift,
              OpsCombatDutyShift, OpsDailySubmission, OpsIssuedDocument, Secondment]
    counts = [model.objects.count() for model in models]
    repeated = seed(tmp_path)
    assert repeated == manifest
    assert [model.objects.count() for model in models] == counts
    status.refresh_from_db()
    assert status.comment == "Operator annotation must survive"


def test_repeat_preserves_duty_with_an_operator_edited_note(stand, tmp_path):
    manifest = seed(tmp_path)
    shift = OpsDutyShift.objects.get(pk=manifest["duty_shift_ids"][0])
    shift.note = "Operator changed duty note"
    shift.save(update_fields=["note"])
    repeated = seed(tmp_path)
    assert repeated["duty_shift_ids"] == manifest["duty_shift_ids"]
    shift.refresh_from_db()
    assert shift.note == "Operator changed duty note"


def test_repeat_preserves_renamed_object_and_existing_duty_targets(stand, tmp_path):
    manifest = seed(tmp_path)
    security_object = OpsSecurityObject.objects.get(pk=manifest["object_id"])
    security_object.name = "Operator renamed the validation object"
    security_object.save(update_fields=["name"])
    object_count = OpsSecurityObject.objects.count()

    repeated = seed(tmp_path)

    assert repeated["object_id"] == manifest["object_id"]
    assert OpsSecurityObject.objects.count() == object_count
    assert {str(row.target["objectId"]) for row in OpsDutyShift.objects.filter(
        pk__in=repeated["duty_shift_ids"],
    )} == {str(manifest["object_id"])}
    security_object.refresh_from_db()
    assert security_object.name == "Operator renamed the validation object"


@pytest.mark.parametrize("key", ["accepted-a", "draft"])
def test_repeat_preserves_combat_group_and_renamed_roster_person(stand, tmp_path, key):
    manifest = seed(tmp_path)
    shift = OpsCombatDutyShift.objects.get(group_name=f"VLD {manifest['business_date']} {key}")
    shift.group_name = "Operator renamed the combat group"
    shift.save(update_fields=["group_name"])
    person = Employee.objects.get(pk=manifest["employees"][f"combat-{key}-0"])
    person.last_name = "Operator corrected the roster name"
    person.save(update_fields=["last_name"])
    shift_count = OpsCombatDutyShift.objects.count()
    original_submission = shift.submission

    repeated = seed(tmp_path)

    assert repeated["combat_shift_ids"] == manifest["combat_shift_ids"]
    assert OpsCombatDutyShift.objects.count() == shift_count
    shift.refresh_from_db()
    assert shift.group_name == "Operator renamed the combat group"
    assert shift.submission == original_submission


@pytest.mark.parametrize("correct_name", [False, True], ids=["group-rename", "group-and-person-rename"])
def test_repeat_adopts_legacy_combat_keys_and_preserves_renamed_accepted_group(stand, tmp_path, correct_name):
    manifest = seed(tmp_path)
    accepted = None
    for shift in OpsCombatDutyShift.objects.filter(pk__in=manifest["combat_shift_ids"]):
        shift.route_set["routeSetId"] = (
            f"route-set-{shift.route_set['routeIds'][0]}-{shift.business_date.isoformat()}"
        )
        if shift.group_name.endswith("accepted-a"):
            shift.group_name = "Operator renamed the pre-existing accepted group"
            accepted = shift
        shift.save(update_fields=["route_set", "group_name"])
    count = OpsCombatDutyShift.objects.count()
    original_submission = accepted.submission
    if correct_name:
        person = Employee.objects.get(pk=manifest["employees"]["combat-accepted-a-0"])
        person.last_name = "Operator corrected the old cohort leader"
        person.save(update_fields=["last_name"])

    assert seed(tmp_path) == manifest
    assert OpsCombatDutyShift.objects.count() == count
    accepted.refresh_from_db()
    assert accepted.group_name == "Operator renamed the pre-existing accepted group"
    assert accepted.submission == original_submission


def test_new_cohort_does_not_adopt_operator_group_with_same_display_label(stand, tmp_path):
    day = Clock.today_local()
    operator_shift = combat.create_shift(
        business_date=day, duty_type_code="COMBAT_GROUP_MULTI_ROUTE",
        route_ids=["route-3"], coverage_mode="SIMULTANEOUS", required_employees=3,
        group_name=f"VLD {day.isoformat()} accepted-a",
    )
    original_routes = operator_shift.route_set.copy()

    manifest = seed(tmp_path)

    assert operator_shift.pk not in manifest["combat_shift_ids"]
    operator_shift.refresh_from_db()
    assert operator_shift.route_set == original_routes
    assert operator_shift.submission is None


@pytest.mark.parametrize("offset", [-7, 7], ids=["past-cohort", "future-cohort"])
def test_explicit_business_date_controls_lifecycles_and_restores_clock(stand, tmp_path, offset):
    wall_day = date(2026, 10, 7)
    cohort_day = wall_day + timedelta(days=offset)
    with override(wall_day):
        manifest = seed(tmp_path, business_date=cohort_day)
        assert Clock.today_local() == wall_day
        assert seed(tmp_path, business_date=cohort_day) == manifest

    assert manifest["business_date"] == cohort_day.isoformat()
    examples = OpsEmployeeStatus.objects.filter(pk__in=manifest["lifecycle_status_ids"])
    assert {row.state_on(cohort_day) for row in examples} == {
        "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED",
    }
    assert set(OpsDutyShift.objects.filter(pk__in=manifest["duty_shift_ids"]).values_list(
        "state_code", flat=True,
    )) == {"PLANNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CANCELLED"}


def test_foreign_visit_is_real_passport_bound_and_preserves_operator_changes(stand, tmp_path):
    actor, _ = stand
    manifest = seed(tmp_path)
    event = OpsSecurityEvent.objects.get(pk=manifest["foreign_event_id"])
    person = OpsProtectedPerson.objects.get(pk=manifest["foreign_person_id"])
    visit = OpsForeignVisit.objects.get(pk=manifest["foreign_visit_id"], event=event)
    visit_object = OpsSecurityEventVisitObject.objects.get(
        pk=manifest["foreign_visit_object_id"], event=event,
    )
    assert OpsSecurityEvent.objects.filter(kind="FOREIGN").first() == event
    assert event.code.startswith(f"ОМ-{event.business_date.year}-")
    assert person.code == f"OL-{person.pk}"
    assert event.kind == "FOREIGN" and event.stage != "CLOSED"
    assert person.category == "FOREIGN" and person.country == "Черногория"
    assert person.position and person.facts
    assert event.protected_person_id == person.pk and event.protected_persons.filter(pk=person.pk).exists()
    assert visit.protected_person_id == person.pk and visit.status == "DRAFT"
    assert visit_object.security_object_id == manifest["object_id"]
    assert visit_object.protected_person_id == person.pk
    assert visit_object.passport_binding["versionId"] == event.passport_binding["versionId"]
    assert visit_object.chief_employee_id == event.chief_employee_id
    assert event.chief_employee_id is not None and event.owner_actor_id == str(actor.pk)
    summary = documents_summary.summary_row(event)
    assert summary["visit"]["version"] == 1
    assert summary["summary"]["country"] == "Черногория"
    assert summary["summary"]["persons"][0]["personId"] == str(person.pk)

    person.name = "Operator corrected the foreign person's name"
    person.save(update_fields=["name"])
    event.title = "Operator renamed the foreign visit"
    event.save(update_fields=["title"])
    gvo.apply_patch(event.code, {"values": {"radio": "Operator radio channel"}}, actor, actor=str(actor.pk))
    counts = [model.objects.count() for model in (OpsSecurityEvent, OpsProtectedPerson, OpsForeignVisit)]
    assert seed(tmp_path) == manifest
    assert [model.objects.count() for model in (OpsSecurityEvent, OpsProtectedPerson, OpsForeignVisit)] == counts
    event.refresh_from_db()
    person.refresh_from_db()
    visit.refresh_from_db()
    assert event.title == "Operator renamed the foreign visit"
    assert person.name == "Operator corrected the foreign person's name"
    assert visit.data["radio"] == "Operator radio channel" and visit.version == 2


def test_unique_division_has_two_active_staffed_people_and_preserves_renames(stand, tmp_path):
    _, units = stand
    manifest = seed(tmp_path)
    division = Division.objects.get(pk=manifest["unique_division_id"])
    assert division.parent_id == units[2].pk and division.division_type == "division"
    assert division.is_active and Division.objects.filter(name=division.name).count() == 1
    slots = StaffUnit.objects.filter(division=division).select_related("employee", "position")
    assert slots.count() == 2
    assert all(slot.employee.employment_status == Employee.EmploymentStatus.WORKING for slot in slots)
    assert all(slot.position.is_active for slot in slots)
    assert len({slot.position.level for slot in slots}) == 2
    assert set(slots.values_list("employee_id", flat=True)) == set(manifest["unique_division_employee_ids"])
    division.name = "Operator renamed the unique validation division"
    division.save(update_fields=["name"])
    counts = (Division.objects.count(), StaffUnit.objects.count(), Employee.objects.count())
    assert seed(tmp_path) == manifest
    assert counts == (Division.objects.count(), StaffUnit.objects.count(), Employee.objects.count())
    division.refresh_from_db()
    assert division.name == "Operator renamed the unique validation division"
