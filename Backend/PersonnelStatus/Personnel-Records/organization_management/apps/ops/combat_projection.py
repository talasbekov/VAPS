"""Single writer of combat duty's canonical, read-only expense facts."""
from datetime import timedelta
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.amendment_enforcement import enforce_amendment_on_bulk_edit


def source_ref(shift):
    return f"combat:{shift.pk}"


def assignment_label(shift):
    pieces = ["Групповое", shift.group_name, shift.location.get("label", "")]
    event = shift.assignment_snapshot.get("eventTitle")
    if event:
        pieces.append(f"ОМ: {event}")
    return " · ".join(piece for piece in pieces if piece)


def details(shift):
    return {
        "kind": "GROUP", "group_id": str(shift.group_id), "group_name": shift.group_name,
        "shift_id": str(shift.pk), "business_date": shift.business_date.isoformat(),
        "division_id": str(shift.division_id),
        "location": shift.location, "location_label": shift.location.get("label", ""),
        "object_id": str(shift.security_object_id) if shift.security_object_id else None,
        "post_id": str(shift.security_post_id) if shift.security_post_id else None,
        "event_id": str(shift.event_id) if shift.event_id else None,
        "event_name": shift.assignment_snapshot.get("eventTitle") or None,
        "automatic": True,
    }


def assignments_for(rows):
    """Bounded batch read; only authoritative auto facts can expose a group."""
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    facts, unknown = [], []
    for row in rows:
        if isinstance(row, dict):
            unknown.append(row["id"])
        elif row.source == "OM_AUTO" and (row.source_ref or "").startswith("combat:") and row.cancelled_at is None:
            facts.append({"id": row.pk, "source_ref": row.source_ref})
    if unknown:
        facts.extend(OpsEmployeeStatus.objects.filter(pk__in=unknown, source="OM_AUTO", source_ref__startswith="combat:", cancelled_at__isnull=True).values("id", "source_ref"))
    references = {r["source_ref"] for r in facts if 0 < len(r["source_ref"][7:]) < 19 and r["source_ref"][7:].isascii() and r["source_ref"][7:].isdigit()}
    shifts = {source_ref(s): details(s) for s in OpsCombatDutyShift.objects.filter(pk__in=[int(ref[7:]) for ref in references], group__isnull=False)} if references else {}
    return {r["id"]: shifts[r["source_ref"]] for r in facts if r["source_ref"] in shifts}


@transaction.atomic
def sync(shift, *, actor, reason=""):
    """Called inside the shift operation, after identity locks and validation.

    Reconcile only this source's facts, preserve unchanged rows, and amend
    every already-submitted affected day once for the entire operation.
    """
    ref = source_ref(shift)
    current = list(OpsEmployeeStatus.objects.select_for_update().filter(source_ref=ref, source="OM_AUTO", cancelled_at__isnull=True))
    wanted = set()
    if shift.cancelled_at is None and shift.state_code in {"SUBMITTED", "ACCEPTED"}:
        for member in shift.members.filter(active=True):
            wanted.add((member.employee_id, "DUTY", shift.business_date, shift.business_date + timedelta(days=1)))
            if shift.assignment_snapshot.get("restDayAfter"):
                wanted.add((member.employee_id, "REST_AFTER_DUTY", shift.business_date + timedelta(days=1), shift.business_date + timedelta(days=2)))
    label = assignment_label(shift)
    changed_people, intervals = set(), set()
    preserved = set()
    for row in current:
        key = (row.employee_id, row.status_type_code, row.date_start, row.date_end)
        if key in wanted and key not in preserved and row.comment == label:
            preserved.add(key)
            continue
        row.cancelled_at, row.cancelled_by = Clock.now(), actor
        row.cancelled_reason = reason or "Изменение назначения боевой группы"
        row.save(update_fields=["cancelled_at", "cancelled_by", "cancelled_reason", "updated_at"])
        changed_people.add(row.employee_id)
        intervals.add((row.date_start, row.date_end))
    for employee_id, code, first, last in sorted(wanted - preserved):
        OpsEmployeeStatus.objects.create(employee_id=employee_id, status_type_code=code, date_start=first, date_end=last, source="OM_AUTO", source_ref=ref, comment=label, created_by=actor)
        changed_people.add(employee_id)
        intervals.add((first, last))
    if changed_people:
        enforce_amendment_on_bulk_edit(changed_people, intervals, actor=actor, reason=reason)
