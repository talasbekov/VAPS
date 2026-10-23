"""Own current/next sources and a separate acknowledgement of intent."""
import hashlib
import json
from secrets import compare_digest
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q

from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations import audit_service
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment, OpsDutyDispatchConfig
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.ops import duty_log, my_assignments, personnel_duty_records
from organization_management.apps.ops.duty_record_access import parse_key, source_metadata
from organization_management.apps.ops.duty_read_snapshot import read_snapshot


def _current(data):
    if data["source_state"] in ("CANCELLED", "COMPLETED") or data["actual_end"] is not None:
        return False
    now = Clock.now()
    actual_start = personnel_duty_records.instant(data["actual_start"])
    if actual_start is not None and actual_start <= now:
        return True
    planned_end = personnel_duty_records.instant(data["planned_end"])
    return planned_end > now if planned_end else data["date_end"] >= Clock.today_local().isoformat()


def _can_acknowledge(data):
    return (_current(data) and data["source_state"] == "PLANNED"
        and data["acknowledged_at"] is None and data["actual_start"] is None and data["actual_end"] is None
        and (data["source"] != "STATUS" or data["planned_start"] is not None))


def _acknowledgement_token(source, row, data):
    identity = {"owner": str(row.employee_id), "key": data["id"],
        "business_date": data["business_date"], "date_start": data["date_start"], "date_end": data["date_end"],
        "planned_start": data["planned_start"], "planned_end": data["planned_end"]}
    if source == "LOG":
        identity.update(location=row.location_label, document_basis=row.document_basis, note=row.note)
        # Journal revision also increments for acknowledgement and facts.
        # Hash planned content instead so retries remain idempotent.
    elif source == "PLAN":
        identity["target"] = row.target
        identity["duty_type_code"] = row.duty_type_code
    else:
        identity["placement"] = row.placement
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _row(source, row, supplement, metadata):
    data = duty_log.serialize_record(source, row, supplement, metadata)
    place = row.placement if source in ("STATUS", "DISPATCH") else {}
    if source == "PLAN":
        date_start = date_end = row.business_date.isoformat()
    elif source == "STATUS":
        date_start, date_end = row.snapshot["date_start"], row.snapshot["date_end"]
    else:
        date_start = Clock.to_local(row.planned_start if source == "LOG" else row.start_at).date().isoformat()
        date_end = Clock.to_local((row.planned_end if source == "LOG" else row.end_at) - timedelta(microseconds=1)).date().isoformat()
    result = {key: data[key] for key in ("id", "source", "source_id", "business_date", "planned_start", "planned_end",
        "actual_start", "actual_end", "acknowledged_at")} | {
        "source_state": data["state"], "date_start": date_start, "date_end": date_end,
        "object_label": str(place.get("object_name") or (row.target or {}).get("safeLabel") or "") if source == "PLAN" else str(place.get("object_name") or (row.location_label if source == "LOG" else "")),
        "post_label": str(place.get("post_name") or place.get("group_name") or ""),
        # These journal sources do not own a chief or a delivered instruction.
        # A neighbouring object catalogue is not evidence of either fact.
        "senior": None, "instruction": None, "readOnly": True,
    }
    result["canAcknowledge"] = _can_acknowledge(result)
    result["acknowledgementToken"] = _acknowledgement_token(source, row, result)
    return result


@read_snapshot()
def snapshot(actor):
    employee = my_assignments.employee_of_user(actor)
    result = {"employeeId": str(employee.pk) if employee else None, "unlinkedReason": None,
        "time_zone": str(_local_tz()), "generated_at": duty_log.local_stamp(Clock.now()), "results": []}
    if employee is None or not employee.is_active:
        result["unlinkedReason"] = my_assignments.UNLINKED_REASON if employee is None else my_assignments.DISMISSED_REASON
        return result
    now, today = Clock.now(), Clock.today_local()
    rows = []
    for row in personnel_duty_records.exits(today, date.max - timedelta(days=1), employee_id=employee.pk):
        if not row.source_changed:
            rows.append(_row("STATUS", row, row.supplement, source_metadata("STATUS", row, row.supplement)))
    for row in personnel_duty_records._bounded(OpsDutyLogEntry.objects.filter(employee_id=employee.pk, cancelled_at__isnull=True).filter(
        Q(planned_end__gt=now) | Q(actual_start__lte=now, actual_end__isnull=True))):
        rows.append(_row("LOG", row, None, source_metadata("LOG", row)))
    from organization_management.apps.ops.duty_dispatch import DutyContext, receiver
    config = OpsDutyDispatchConfig.objects.filter(singleton_key=1).first()
    department = receiver(config)
    dispatches = [] if department is None else personnel_duty_records._bounded(OpsDutyDispatchAssignment.objects.filter(
        employee_id=employee.pk, receiver_department_id=department.pk, cancelled_at__isnull=True).filter(
        Q(end_at__gt=now) | Q(pk__in=OpsDutyRecordSupplement.objects.filter(source_type="DISPATCH", employee_id=employee.pk,
            actual_start__lte=now, actual_end__isnull=True).values("source_id"))))
    if dispatches:
        # Same source validity rule as the dispatch workspace; a cancelled or
        # overridden allocation never becomes a live profile assignment.
        from organization_management.apps.ops.duty_roster import _available_dispatch_places
        first = min(Clock.to_local(row.start_at).date() for row in dispatches)
        last = max(Clock.to_local(row.end_at - timedelta(microseconds=1)).date() for row in dispatches)
        context = DutyContext(first, last, employee_ids={employee.pk})
        available = _available_dispatch_places(dispatches)
        supplements = {row.source_id: row for row in OpsDutyRecordSupplement.objects.filter(source_type="DISPATCH", source_id__in=[row.pk for row in dispatches])}
        for row in dispatches:
            supplement = supplements.get(row.pk)
            identity_matches = supplement is None or supplement.employee_id is None or supplement.employee_id == row.employee_id
            if row.pk in available and identity_matches and not context.source_reason(row.employee_id, row.source_status_id, row.start_at, row.end_at):
                rows.append(_row("DISPATCH", row, supplement, source_metadata("DISPATCH", row, supplement)))
    shifts = personnel_duty_records._bounded(OpsDutyShift.objects.filter(employee_id=str(employee.pk)).exclude(state_code="CANCELLED").filter(
        Q(business_date__gte=today) | Q(actual_start__lte=now, actual_end__isnull=True)))
    supplements = {row.source_id: row for row in OpsDutyRecordSupplement.objects.filter(source_type="PLAN", source_id__in=[row.pk for row in shifts])}
    for row in shifts:
        supplement = supplements.get(row.pk)
        rows.append(_row("PLAN", row, supplement, source_metadata("PLAN", row, supplement)))
    current = []
    for row in rows:
        started = personnel_duty_records.instant(row["actual_start"])
        ended = personnel_duty_records.instant(row["actual_end"])
        planned_end = personnel_duty_records.instant(row["planned_end"])
        active = started is not None and started <= now and ended is None
        if row["source_state"] in ("CANCELLED", "COMPLETED") or ended is not None:
            continue
        if not active and ((planned_end is not None and planned_end <= now) or (planned_end is None and row["date_end"] < today.isoformat())):
            continue
        row["_active"] = active
        current.append(row)
    if len(current) > personnel_duty_records.MAX_SOURCE_ROWS:
        raise DomainError("DUTY_REGISTER_LIMIT", 422, message="Слишком много личных выходов для одного ответа.")
    current.sort(key=lambda row: (not row["_active"], row["planned_start"] or row["date_start"], row["id"]))
    for row in current:
        row.pop("_active")
    result["results"] = current
    return result


def _ack_conflict():
    return DomainError("DUTY_REGISTER_CONFLICT", 409, message="Выход изменён, отменён или уже завершён. Обновите личные назначения.")


@transaction.atomic
def acknowledge(actor, key, *, token):
    """Confirm only one's own intent; no scope override enters journal RBAC."""
    from organization_management.apps.staff_unit.models import StaffUnit
    from organization_management.apps.statuses.models import EmployeeStatus
    from organization_management.apps.operations.models_status import OpsEmployeeStatus
    from organization_management.apps.ops.duty_dispatch import DutyContext, receiver
    from organization_management.apps.ops.duty_roster import _available_dispatch_places
    from organization_management.apps.ops import duties

    employee = my_assignments.employee_of_user(actor)
    if employee is None or not employee.is_active:
        raise DomainError("PERMISSION_DENIED", 403, message="Подтвердить можно только собственное действующее назначение.")
    source, pk = parse_key(key)
    model = {"STATUS": EmployeeStatus, "LOG": OpsDutyLogEntry, "PLAN": OpsDutyShift, "DISPATCH": OpsDutyDispatchAssignment}[source]
    owner = str(employee.pk) if source == "PLAN" else employee.pk
    if not model.objects.filter(pk=pk, employee_id=owner).exists():
        raise DomainError("PERMISSION_DENIED", 403, message="Подтвердить можно только собственное назначение.")
    # Preserve the existing source writers' lock order before the employee.
    config = OpsDutyDispatchConfig.objects.select_for_update().filter(singleton_key=1).first() if source == "DISPATCH" else None
    row = duties._lock_shift(pk) if source == "PLAN" else None
    if Employee.objects.select_for_update().filter(pk=employee.pk, user_id=actor, is_active=True).first() is None:
        raise DomainError("PERMISSION_DENIED", 403, message="Кадровая привязка учётной записи изменилась.")
    StaffUnit.objects.select_for_update().filter(employee_id=employee.pk).first()
    if source != "PLAN":
        row = model.objects.select_for_update().filter(pk=pk, employee_id=owner).first()
    if row is None or str(row.employee_id) != str(employee.pk):
        raise DomainError("PERMISSION_DENIED", 403, message="Сотрудник исходного назначения изменился.")
    if source == "STATUS":
        row = personnel_duty_records.resolve(pk, key.rsplit(":", 1)[1])
        if row is None or row.source_changed or row.start_at is None:
            raise _ack_conflict()
        supplement = row.supplement
    else:
        supplement = None if source == "LOG" else OpsDutyRecordSupplement.objects.filter(source_type=source, source_id=pk).first()
    if row.employee_id is None or str(row.employee_id) != str(employee.pk) or (
            supplement is not None and supplement.employee_id is not None and supplement.employee_id != employee.pk):
        raise DomainError("PERMISSION_DENIED", 403, message="История назначения относится к другому сотруднику.")
    if source == "DISPATCH":
        department = receiver(config)
        context = DutyContext(Clock.to_local(row.start_at).date(), Clock.to_local(row.end_at - timedelta(microseconds=1)).date(), employee_ids={employee.pk})
        OpsEmployeeStatus.objects.select_for_update().filter(pk=row.source_status_id, employee_id=employee.pk).first()
        if (department is None or row.receiver_department_id != department.pk or row.pk not in _available_dispatch_places([row])
                or context.source_reason(employee.pk, row.source_status_id, row.start_at, row.end_at)):
            raise _ack_conflict()
    metadata = source_metadata(source, row, supplement)
    old = duty_log.serialize_record(source, row, supplement, metadata)
    data = _row(source, row, supplement, metadata)
    if not compare_digest(data["acknowledgementToken"], token):
        raise _ack_conflict()
    if not _current(data):
        raise _ack_conflict()
    acknowledged = personnel_duty_records.instant(data["acknowledged_at"])
    if acknowledged is not None:
        if acknowledged > Clock.now():
            raise _ack_conflict()
        return data
    if not _can_acknowledge(data):
        raise _ack_conflict()
    holder = row if source in ("LOG", "PLAN") else duty_log.ensure_supplement(source, row, supplement, metadata, actor)
    holder.acknowledged_at = holder.updated_at = Clock.now()
    fields = ["acknowledged_at", "updated_at"]
    if source == "PLAN":
        holder.state_code = "ACKNOWLEDGED"
        fields.append("state_code")
    else:
        holder.acknowledged_by = actor
        fields.append("acknowledged_by")
        if source == "LOG":
            holder.revision += 1
            fields.append("revision")
        else:
            holder.updated_by = actor
            fields.append("updated_by")
            supplement = holder
    holder.save(update_fields=fields)
    duty_log.record_audit(actor, audit_service.DUTY_LOG_ACKNOWLEDGED, source, row, supplement, metadata, old)
    return _row(source, row, supplement, metadata)
