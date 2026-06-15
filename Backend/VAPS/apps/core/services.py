from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.core.models import (
    EmployeeDivisionHistory,
    EmployeeStaffingAssignment,
    SensitiveFieldPolicy,
    StaffingSlot,
)


@transaction.atomic
def assign_employee_division(
    employee, division, *, starts_at, actor: str, source="MANUAL"
):
    """Move an employee to a division, maintaining a non-overlapping history.

    BR-CORE-HISTORY-001 (no overlapping intervals), BR-CORE-HISTORY-002
    (current employee.division mirrors the open interval).
    """
    # Blank actor would blur the "NULL = honestly actorless" convention:
    # a caller that reaches a service always has a real identity.
    if not actor or not actor.strip():
        raise ValidationError("actor must be a non-empty string")
    open_interval = (
        EmployeeDivisionHistory.objects.select_for_update()
        .filter(employee=employee, ends_at__isnull=True)
        .order_by("-starts_at")
        .first()
    )
    if open_interval:
        if open_interval.starts_at >= starts_at:
            raise ValidationError(
                "New interval starts before the current open interval."
            )
        open_interval.ends_at = starts_at
        open_interval.full_clean()
        open_interval.save(update_fields=["ends_at"])

    record = EmployeeDivisionHistory(
        employee=employee,
        division=division,
        starts_at=starts_at,
        source=source,
        created_by=actor,
    )
    record.full_clean()
    record.save()

    employee.division = division
    employee.save(update_fields=["division", "updated_at"])
    return record


def compute_free_slots(division_id, *, on_date):
    """BR-CORE-STAFF-002: vacancy = staffing slot with no active assignment on a date.

    Returns active slots valid on `on_date` that have no staffing assignment
    overlapping `on_date`.
    """
    slots = StaffingSlot.objects.filter(
        division_id=division_id, is_active=True, valid_from__lte=on_date
    ).filter(Q(valid_to__isnull=True) | Q(valid_to__gt=on_date))

    occupied_slot_ids = set(
        EmployeeStaffingAssignment.objects.filter(
            staffing_slot__in=slots, starts_at__lte=on_date
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=on_date))
        .values_list("staffing_slot_id", flat=True)
    )
    return [s for s in slots if s.id not in occupied_slot_ids]


def _partial_mask(value: str) -> str:
    text = str(value)
    if len(text) <= 4:
        return "*" * len(text)
    return "*" * (len(text) - 4) + text[-4:]


def mask_employee_data(data: dict, *, user_permissions: set) -> dict:
    """Apply sensitive-field policies to a serialized employee dict.

    BR-PRIVACY-001/002: a field is revealed only if the caller holds the
    policy's permission_code; otherwise FULL_HIDE -> None, PARTIAL_MASK -> tail-masked.
    """
    result = dict(data)
    policies = SensitiveFieldPolicy.objects.filter(is_active=True)
    for policy in policies:
        if policy.field_code not in result or result[policy.field_code] is None:
            continue
        has_permission = policy.permission_code in user_permissions
        if has_permission or policy.mask_strategy == "ALLOW":
            continue
        if policy.mask_strategy == "FULL_HIDE":
            result[policy.field_code] = None
        elif policy.mask_strategy == "PARTIAL_MASK":
            result[policy.field_code] = _partial_mask(result[policy.field_code])
    return result
