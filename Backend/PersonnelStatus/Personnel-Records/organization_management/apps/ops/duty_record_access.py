"""Shared scope rules for duty log mutations and its read model."""
import re
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops.security_events import personnel_full_name

READ_PERMISSIONS = ("duty.view", "analytics.view", "duty.manage", "status.manage")
WRITE_PERMISSIONS = ("duty.manage", "status.manage")
REGISTER_PERMISSIONS = READ_PERMISSIONS + ("duty.dispatch",)
MAX_IDENTIFIER = 9223372036854775807
MAX_BROWSER_IDENTIFIER = 9007199254740991


def public_identifier(value):
    return str(value) if value is not None and value > MAX_BROWSER_IDENTIFIER else value


def public_metadata(data):
    return {key: public_identifier(value) if key in ("employee_id", "division_id") else value for key, value in data.items()}


def division_scope(actor, permissions):
    result = set()
    for code in permissions:
        allowed = PermissionService.visible_division_ids(actor, code)
        if allowed is None:
            return None
        result.update(allowed)
    return result


def effective_register_scope(actor, *, status_scope):
    """Stable cache authority, including expiring grants and division subtrees."""
    scopes = {"status.manage": status_scope}
    for code in REGISTER_PERMISSIONS:
        if code not in scopes:
            scopes[code] = PermissionService.visible_division_ids(actor, code)

    def combined(codes):
        if any(scopes[code] is None for code in codes):
            return None
        return [public_identifier(pk) for pk in sorted(set().union(*(scopes[code] for code in codes)))]

    return {
        "read": combined(READ_PERMISSIONS),
        "write": combined(WRITE_PERMISSIONS),
        "plan": combined(("duty.manage",)),
        "dispatch": combined(("duty.dispatch",)),
    }


def in_scope(scope, division_id):
    return scope is None or (division_id is not None and division_id in scope)


def employee_data(person):
    staff = getattr(person, "staff_unit", None) if person else None
    division = staff.division if staff else None
    return {
        "employee_id": person.pk if person else None,
        "employee_name": personnel_full_name(person) if person else "",
        "division_id": division.pk if division else None,
        "division_name": division.name if division else "",
        "position_name": staff.position.name if staff and staff.position else "",
    }


def people_query(actor, permissions=WRITE_PERMISSIONS):
    rows = Employee.objects.select_related("staff_unit__division", "staff_unit__position")
    scope = division_scope(actor, permissions)
    return rows if scope is None else rows.filter(staff_unit__division_id__in=scope)


def person_for_id(employee_id):
    raw = str(employee_id or "")
    if not raw.isascii() or not raw.isdigit() or not 0 < int(raw) <= MAX_IDENTIFIER:
        return None
    return Employee.objects.select_related("staff_unit__division", "staff_unit__position").filter(pk=int(raw)).first()


def parse_key(key):
    match = re.fullmatch(r"(LOG|DISPATCH|PLAN):([1-9][0-9]{0,18})", str(key or ""))
    if match is None or int(match[2]) > 9223372036854775807:
        raise DomainError("ENTITY_NOT_FOUND", 404, message="Запись дежурства не найдена.")
    return match[1], int(match[2])


def source_metadata(source, row, supplement=None):
    if source == "LOG":
        return {name: getattr(row, name) for name in ("employee_id", "employee_name", "division_id", "division_name")}
    data = employee_data(person_for_id(row.employee_id))
    if supplement is not None and supplement.employee_id is not None:
        data.update({name: getattr(supplement, name) for name in ("employee_id", "employee_name", "division_id", "division_name")})
    else:
        data["employee_name"] = row.employee_name
    return data


def can_read(actor, source, row, metadata, scope=None, receiver_scope=None):
    scope = division_scope(actor, READ_PERMISSIONS) if scope is None else scope
    if in_scope(scope, metadata["division_id"]):
        return True
    return source == "DISPATCH" and in_scope(
        division_scope(actor, ("duty.dispatch",)) if receiver_scope is None else receiver_scope,
        row.receiver_department_id,
    )


def can_write(actor, source, row, metadata):
    if source == "DISPATCH":
        return in_scope(division_scope(actor, ("duty.dispatch",)), row.receiver_department_id)
    if source == "PLAN":
        scope = division_scope(actor, ("duty.manage",))
        if not in_scope(scope, metadata["division_id"]):
            return False
        if scope is None:
            return True
        # Historical visibility does not authorize changes to a transferred
        # employee's live shift. Keep both boundaries: POST returns history.
        from organization_management.apps.ops import duties
        return duties.visible_shifts(actor, "duty.manage").filter(pk=row.pk).exists()
    return in_scope(division_scope(actor, WRITE_PERMISSIONS), metadata["division_id"])


@transaction.atomic
def resolve_record(actor, key, *, write=False, lock=False):
    source, pk = parse_key(key)
    model = {"LOG": OpsDutyLogEntry, "DISPATCH": OpsDutyDispatchAssignment, "PLAN": OpsDutyShift}[source]
    if lock and source == "PLAN":
        # Match the legacy writer: month before shift, including execution
        # and classification paths that call back into the planner service.
        from organization_management.apps.ops import duties
        row = duties._lock_shift(pk)
    else:
        query = model.objects.select_for_update() if lock else model.objects.all()
        row = query.filter(pk=pk).first()
    if row is None:
        raise DomainError("ENTITY_NOT_FOUND", 404, message="Запись дежурства не найдена.")
    supplement = None if source == "LOG" else OpsDutyRecordSupplement.objects.filter(source_type=source, source_id=pk).first()
    metadata = source_metadata(source, row, supplement)
    allowed = can_write(actor, source, row, metadata) if write else can_read(actor, source, row, metadata)
    if not allowed:
        raise DomainError("PERMISSION_DENIED", 403, message="Запись находится вне доступной области подразделений.")
    return source, row, supplement, metadata
