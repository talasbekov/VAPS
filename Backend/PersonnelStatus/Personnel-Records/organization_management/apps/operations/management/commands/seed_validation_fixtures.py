"""Representative fixtures for an explicitly isolated live validation stand.

Run after the reference seeders and seed_org_structure. All fixture people and
keys belong to one business-date cohort; rerunning that cohort preserves operator
changes. No existing submissions, accounts, or domain settings are cleared.
"""
import hashlib
import json
import os
from datetime import date, timedelta
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock, override
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.document_release import EXPENSE_DOC_TYPE, issue_expense_document
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.models_document import OpsIssuedDocument
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.models_submission import OpsDailySubmission
from organization_management.apps.operations.secondment_service import initiate_secondment
from organization_management.apps.operations.status_service import cancel_status, create_status
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.ops import combat, duties, gvo, passport, security_events
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus


ABSENCES = (
    ("SICK_LEAVE", "Астана, медицинский центр (тест)"),
    ("LEAVE_BY_REPORT", "Кызылорда, отпуск по рапорту (тест)"),
    ("VACATION", "Алматы, ежегодный отпуск (тест)"),
    ("COMMAND", "Алматы, служебная командировка (тест)"),
    ("STUDY", "Астана, учебный центр (тест)"),
    ("COMPETITION", "Шымкент, соревнования (тест)"),
    ("CONFERENCE", "Астана, конференция (тест)"),
    ("OTHER_ABSENCE", "Караганда, иное отсутствие (тест)"),
    ("DETACHED", "Алматы, принимающее управление (тест)"),
    ("ATTACHED", "Астана, прикомандирование (тест)"),
)
OPERATIONAL_CODES = ("DUTY", "GEV", "BEFORE_DUTY", "REST_AFTER_DUTY", "PENDING_CLARIFICATION")


class Command(BaseCommand):
    help = "Seed representative live test fixtures; requires ALLOWED_VALIDATION_SEED=1."

    def add_arguments(self, parser):
        parser.add_argument("--actor", default="acc_admin", help="Existing actor username; no accounts are created.")
        parser.add_argument("--business-date", type=date.fromisoformat, help="Stable cohort date; defaults to the local business date.")
        parser.add_argument("--manifest", help="Optional JSON output path outside Git (contains fixture IDs, never secrets).")

    def handle(self, *args, **options):
        if os.environ.get("ALLOWED_VALIDATION_SEED") != "1":
            raise CommandError("Set ALLOWED_VALIDATION_SEED=1 only on the isolated validation stand.")
        self.user = User.objects.filter(username=options["actor"], is_active=True).first()
        if self.user is None:
            raise CommandError(f"Existing active actor {options['actor']!r} was not found.")
        self.actor = str(self.user.pk)
        self.day = options["business_date"] or Clock.today_local()
        self.prefix = f"validation:{self.day.isoformat()}:"
        self.people = {}
        self.units = []
        for index in range(1, 4):
            unit = Division.objects.filter(code=f"SEED-D{index}-U1", is_active=True).first()
            if unit is None:
                raise CommandError("Run seed_org_structure with at least three departments first.")
            self.units.append(unit)
        known = set(StatusType.objects.filter(is_active=True).values_list("code", flat=True))
        missing = ({code for code, _ in ABSENCES} | set(OPERATIONAL_CODES)) - known
        if missing:
            raise CommandError(f"Run seed_status_types first; missing active types: {', '.join(sorted(missing))}.")

        with transaction.atomic(), override(self.day):
            absence_ids = self._absences()
            operational_ids = [self._status(f"operational-{code}", code, self.day - timedelta(days=1),
                                           self.day + timedelta(days=2), index % 3).pk
                               for index, code in enumerate(OPERATIONAL_CODES)]
            lifecycle_ids = self._lifecycles()
            secondment = self._secondment()
            security_object = self._object()
            duty_ids = self._duties(security_object)
            combat_ids = self._combat()
            workflow_person = self._person("api-workflow", 1)
            submission, issued = self._historical_expense()
            unique_division, org_people = self._unique_division()
            foreign_person, foreign_event, foreign_visit, visit_object = self._foreign_visit(
                security_object, org_people[0], combat_ids[0],
            )
            manifest = {
                "business_date": self.day.isoformat(), "actor_id": self.user.pk,
                "departments": [{"id": unit.parent_id, "code": unit.parent.code} for unit in self.units],
                "units": [{"id": unit.pk, "code": unit.code, "name": unit.name} for unit in self.units],
                "employees": {key: person.pk for key, person in self.people.items()},
                "absence_status_ids": absence_ids, "operational_status_ids": operational_ids,
                "lifecycle_status_ids": lifecycle_ids, "secondment_id": secondment.pk,
                "object_id": security_object.pk, "duty_shift_ids": duty_ids, "combat_shift_ids": combat_ids,
                "historical_business_date": submission.business_date.isoformat(),
                "historical_submission_id": submission.pk, "historical_document_id": issued.pk,
                "unique_division_id": unique_division.pk,
                "unique_division_employee_ids": [person.pk for person in org_people],
                "foreign_person_id": foreign_person.pk, "foreign_event_id": foreign_event.pk,
                "foreign_event_code": foreign_event.code, "foreign_visit_id": foreign_visit.pk,
                "foreign_visit_object_id": visit_object.pk,
                "api_workflows": {
                    "business_date": self.day.isoformat(), "department_id": self.units[0].parent_id,
                    "foreign_department_id": self.units[1].parent_id, "directorate_id": self.units[0].pk,
                    "division_id": self.units[0].pk, "foreign_division_id": self.units[1].pk,
                    "snapshot_date": submission.business_date.isoformat(), "snapshot_division_id": self.units[0].pk,
                    "snapshot_expected_text": [
                        f"{self.people['historical-duty'].last_name} {self.people['historical-duty'].first_name}",
                        "Астана, historical-duty (тест)",
                    ],
                    "workflow_division_id": self.units[1].pk, "workflow_employee_id": workflow_person.pk,
                    "workflow_date": self.day.isoformat(),
                },
            }
        serialized = json.dumps(manifest, ensure_ascii=False, indent=2)
        if options["manifest"]:
            target = Path(options["manifest"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(serialized + "\n", encoding="utf-8")
        self.stdout.write(serialized)

    def _personnel_number(self, key):
        suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
        return f"VLD{self.day:%Y%m%d}{suffix}"

    def _person(self, key, unit_index=0, *, division=None, position=None):
        if key in self.people:
            return self.people[key]
        person, _ = Employee.objects.get_or_create(personnel_number=self._personnel_number(key), defaults={
            "last_name": f"Тестовый {key}", "first_name": "Стенд",
            "iin": None, "birth_date": None, "hire_date": date(2020, 1, 1),
            "employment_status": Employee.EmploymentStatus.WORKING,
            "notes": f"Isolated validation fixture {self.prefix}{key}",
        })
        StaffUnit.objects.get_or_create(employee=person, defaults={
            "division": division or self.units[unit_index], "position": position,
            "index": 9000 + len(self.people),
        })
        self.people[key] = person
        return person

    def _absences(self):
        service = StatusApplicationService()
        ids = []
        for index, (code, destination) in enumerate(ABSENCES):
            person = self._person(f"absence-{code}", index % 3)
            legacy = StatusType.objects.get(pk=code).legacy_code
            source = EmployeeStatus.objects.filter(employee=person, status_type=legacy).first()
            if source is None:
                source = service.create_status(
                    employee_id=person.pk, status_type=legacy,
                    start_date=self.day - timedelta(days=1), end_date=self.day + timedelta(days=1),
                    location=destination, related_division_id=self.units[(index + 1) % 3].pk,
                    comment=f"{self.prefix}absence-{code}", user=self.user,
                )
            mirrored = OpsEmployeeStatus.objects.filter(source_ref=f"personnel:{source.pk}").first()
            if mirrored is None:
                raise CommandError(f"Personnel status {source.pk} did not produce an operational projection.")
            ids.append(mirrored.pk)
        return ids

    def _status(self, key, code, start, end, unit_index=0):
        person = self._person(key, unit_index)
        ref = self.prefix + key
        existing = OpsEmployeeStatus.objects.filter(source_ref=ref).first()
        return existing or create_status(
            employee_id=person.pk, status_type_code=code, date_start=start, date_end=end,
            source_ref=ref, comment=f"Астана, {key} (тест)",
            document_basis="Тестовый приказ: isolated validation", actor=self.actor,
        )

    def _lifecycles(self):
        dates = (("active", -1, 2), ("planned", 3, 5), ("completed", -14, -12), ("cancelled", 3, 5))
        ids = []
        for state, start, end in dates:
            status = self._status(f"lifecycle-{state}", "VACATION", self.day + timedelta(days=start),
                                  self.day + timedelta(days=end))
            if state == "cancelled" and status.cancelled_at is None:
                # Only the freshly owned planned example is cancelled; a rerun
                # never rewrites an operator's other lifecycle transitions.
                status = cancel_status(status, actor=self.actor, reason="Тестовая отмена планового отпуска")
            ids.append(status.pk)
        return ids

    def _secondment(self):
        person = self._person("secondment", 0)
        existing = Secondment.objects.filter(employee_id=person.pk).first()
        return existing or initiate_secondment(
            person.pk, to_division_id=self.units[1].pk,
            date_start=self.day - timedelta(days=1), date_end=self.day + timedelta(days=2),
            actor=self.actor, document_basis="Тестовый приказ об откомандировании",
        )

    def _object(self):
        # Dedicated cohort duty employees link the existing object even
        # when operators have changed its display name or the duty note.
        employees = Employee.objects.filter(personnel_number__in=[
            self._personnel_number(f"duty-{state}")
            for state in ("PLANNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CANCELLED")
        ]).values_list("pk", flat=True)
        shift = OpsDutyShift.objects.filter(employee_id__in=[str(pk) for pk in employees]).order_by("pk").first()
        if shift is not None:
            security_object = OpsSecurityObject.objects.filter(pk=shift.target["objectId"]).first()
            if security_object is None:
                raise CommandError("The existing validation duty references a missing object.")
            return security_object
        name = f"VLD {self.day.isoformat()} объект дежурств"
        security_object = passport.create_object(
            name=name, object_type="Учебный объект (тест)", region="Астана",
            address="Тестовая улица, 1", ownership="OWN",
        )
        passport.update_passport(security_object, [{"name": "Периметр", "posts": [
            {"name": "Пост 1", "task": "Тестовая охрана", "requirements": "Тестовый допуск"},
        ]}])
        passport.publish_version(security_object, effective_from=self.day - timedelta(days=30),
                                 note="Паспорт изолированного стенда", actor=self.actor)
        return security_object

    def _duties(self, security_object):
        ids = []
        version = security_object.passport_versions.order_by("-version_number").first()
        sector = version.sectors_snapshot[0]
        for index, state in enumerate(("PLANNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CANCELLED")):
            person = self._person(f"duty-{state}", index % 3)
            marker = self.prefix + f"duty-{state}"
            # Each cohort/state has its own immutable personnel identity.
            # Notes are operator metadata and cannot serve as the repeat key.
            existing = OpsDutyShift.objects.filter(employee_id=str(person.pk)).order_by("pk").first()
            if existing is None:
                business_day = self.day - timedelta(days=7) if state == "COMPLETED" else (
                    self.day if state == "ACTIVE" else self.day + timedelta(days=3))
                with override(business_day):
                    existing = duties.create_shift(
                        business_date=business_day, duty_type_code="DAY_OBJECT" if index % 2 else "DAY_OWN",
                        object_id=str(security_object.pk), sector_id=sector["id"], post_id=sector["posts"][0]["id"],
                        employee_id=str(person.pk), note=marker, override=False, override_reason=None, actor=self.actor,
                    )
                    if state in {"ACKNOWLEDGED", "ACTIVE", "COMPLETED"}:
                        existing = duties.acknowledge_shift(existing.pk)
                    if state in {"ACTIVE", "COMPLETED"}:
                        existing = duties.clock_in_shift(existing.pk)
                    if state == "COMPLETED":
                        existing = duties.clock_out_shift(existing.pk)
                    if state == "CANCELLED":
                        existing = duties.cancel_shift(existing.pk, reason="Тестовая отмена смены", actor=self.actor)
            ids.append(existing.pk)
        return ids

    def _combat(self):
        ids = []
        for index, key in enumerate(("accepted-a", "accepted-b", "legacy", "draft", "submitted", "returned", "completed")):
            unit_index = {"accepted-a": 0, "accepted-b": 1, "legacy": 2}.get(key, index % 3)
            known_roster = Employee.objects.filter(personnel_number__in=[
                self._personnel_number(f"combat-{key}-{member}") for member in range(3)
            ]).count() == 3
            roster = [self._person(f"combat-{key}-{member}", unit_index) for member in range(3)]
            group_name = f"VLD {self.day.isoformat()} {key}"
            business_day = self.day - timedelta(days=7) if key == "completed" else self.day
            names = [f"{person.last_name} {person.first_name}" for person in roster]
            # routeSetId is an opaque snapshot identifier, never an editable
            # group/employee label. Each cohort roster has its own stable key.
            fixture_id = self.prefix + f"combat:{roster[0].personnel_number}"
            shift = OpsCombatDutyShift.objects.filter(route_set__routeSetId=fixture_id).first()
            if shift is None and known_roster:
                # Adopt cohorts created before stable keys were introduced.
                # Old submissions froze names without personnel IDs. Match
                # the complete ordered fixture roster against either its
                # generated original names or current names: correcting a
                # live employee must not invalidate the historical snapshot.
                # Never adopt a populated operator group by its label alone.
                legacy = OpsCombatDutyShift.objects.filter(
                    business_date=business_day, duty_type_code="COMBAT_GROUP_MULTI_ROUTE",
                    route_set__routeSetId__startswith="route-set-",
                )
                originals = [f"Тестовый combat-{key}-{member} Стенд" for member in range(3)]
                allowed_names = [{current, original} for current, original in zip(names, originals)]
                matches = []
                for candidate in legacy.filter(submission__isnull=False).order_by("pk"):
                    legacy_submission = candidate.submission
                    if not isinstance(legacy_submission, dict):
                        continue
                    members = legacy_submission.get("memberEmployeeNames")
                    if (legacy_submission.get("groupLeaderEmployeeName") in allowed_names[0]
                            and isinstance(members, list) and len(members) == 2
                            and all(name in allowed for name, allowed in zip(members, allowed_names[1:]))):
                        matches.append(candidate)
                if len(matches) > 1:
                    raise CommandError("Multiple legacy shifts match the owned validation roster.")
                shift = matches[0] if matches else None
                if shift is None:
                    shift = legacy.filter(group_name=group_name, submission__isnull=True).order_by("pk").first()
                if shift is not None:
                    shift.route_set = {**shift.route_set, "routeSetId": fixture_id}
                    shift.save(update_fields=["route_set", "updated_at"])
            if shift is None:
                with override(business_day):
                    shift = combat.create_shift(
                        business_date=business_day, duty_type_code="COMBAT_GROUP_MULTI_ROUTE",
                        route_ids=["route-1", "route-2"] if index % 2 else ["route-3"],
                        coverage_mode="SIMULTANEOUS", required_employees=3, group_name=group_name,
                    )
                    shift.route_set = {**shift.route_set, "routeSetId": fixture_id}
                    shift.save(update_fields=["route_set", "updated_at"])
                    if key != "draft":
                        shift = combat.submit_roster(
                            shift.pk, group_leader=names[0], members=names[1:], reserve=[],
                            submitted_by_unit=self.units[unit_index].name,
                            submitted_by_division_id=None if key == "legacy" else self.units[unit_index].pk,
                        )
                    if key in {"accepted-a", "accepted-b", "legacy", "completed", "returned"}:
                        shift = combat.review_roster(shift.pk, decision="RETURN" if key == "returned" else "ACCEPT",
                                                     return_reason="Тест: уточнить состав" if key == "returned" else None)
                    if key == "completed":
                        for name in names:
                            shift = combat.acknowledge(shift.pk, employee_name=name)
                        shift = combat.check_in(shift.pk)
                        shift = combat.submit_handover(shift.pk, unresolved_incidents="", remarks="Тест: замечаний нет",
                                                      confirmed_by=names[0])
                        shift = combat.complete(shift.pk, actual_member_names=names)
            ids.append(shift.pk)
        return ids

    def _historical_expense(self):
        historical = self.day - timedelta(days=14)
        self._status("historical-duty", "DUTY", historical, historical + timedelta(days=1))
        unit = self.units[0]
        submission = OpsDailySubmission.objects.filter(division_id=unit.pk, business_date=historical, is_current=True).first()
        issued = OpsIssuedDocument.objects.filter(doc_type=EXPENSE_DOC_TYPE, division_id=unit.pk,
                                                  business_date=historical, status="ISSUED").first()
        with override(historical):
            if submission is None:
                submission = submit_day(division_id=unit.pk, business_date=historical, actor=self.actor,
                                        window_dates=[historical])
            if issued is None:
                issued = issue_expense_document(division_id=unit.pk, business_date=historical, actor=self.actor)
        return submission, issued

    def _unique_division(self):
        unit, _ = Division.objects.get_or_create(code=f"VLD-{self.day:%Y%m%d}-UNIT", defaults={
            "name": f"Учебный отдел VLD {self.day.isoformat()}",
            "parent": self.units[2], "division_type": Division.DivisionType.DIVISION,
        })
        people = []
        for key, name, level in (("org-chief", "Начальник учебного отдела", 10),
                                 ("org-member", "Инспектор учебного отдела", 30)):
            position, _ = Position.objects.get_or_create(code=f"VLD-{self.day:%Y%m%d}-{key}", defaults={
                "name": name, "level": level,
            })
            people.append(self._person(key, 2, division=unit, position=position))
        return unit, people

    def _foreign_visit(self, security_object, chief, combat_shift_id):
        # The owned combat snapshot already has an immutable cohort key.
        # Store foreign fixture associations there; preserve generated domain
        # codes and operator-edited labels, chiefs and visit metadata.
        anchor = OpsCombatDutyShift.objects.get(pk=combat_shift_id)
        refs = anchor.route_set.get("validationFixtureRefs", {})
        person_id = refs.get("foreignPersonId")
        person = OpsProtectedPerson.objects.filter(pk=person_id).first() if person_id else None
        if person_id and person is None:
            raise CommandError("The owned validation reference points to a missing protected person.")
        if person is None:
            created = gvo.create_person(
                name=f"Учебный иностранный делегат VLD {self.day.isoformat()}",
                category="FOREIGN", country="Черногория", position="Глава учебной делегации",
                bio="Синтетическое охраняемое лицо изолированного проверочного стенда.",
                facts=[{"key": "Назначение", "value": "Учебный международный визит (тест)"}],
                actor=self.actor,
            )
            person = OpsProtectedPerson.objects.get(pk=created["id"])
        event_id = refs.get("foreignEventId")
        event = OpsSecurityEvent.objects.filter(pk=event_id).first() if event_id else None
        if event_id and event is None:
            raise CommandError("The owned validation reference points to a missing foreign event.")
        if event is None:
            event = security_events.create_event(
                title=f"Учебный иностранный визит VLD {self.day.isoformat()}",
                object_id=str(security_object.pk), business_date=self.day,
                business_date_end=self.day + timedelta(days=1), kind="FOREIGN",
                protected_person_id=str(person.pk), chief_employee_id=str(chief.pk),
                location="Казахстан, Астана, учебная площадка (тест)", actor=self.actor,
            )
        fixture_refs = {**refs, "foreignPersonId": person.pk, "foreignEventId": event.pk}
        if fixture_refs != refs:
            anchor.route_set = {**anchor.route_set, "validationFixtureRefs": fixture_refs}
            anchor.save(update_fields=["route_set", "updated_at"])
        visit = gvo.visit_for_event(event, create=True)
        visit_object = event.visit_objects.order_by("position", "pk").first()
        if visit is None or visit_object is None:
            raise CommandError("The existing foreign validation event has no visit or visit object.")
        return person, event, visit, visit_object
