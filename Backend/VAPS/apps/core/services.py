from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.core.models import (
    EmployeeDivisionHistory,
    EmployeeStaffingAssignment,
    StaffingSlot,
)


@transaction.atomic
def assign_employee_division(employee, division, *, starts_at, source="MANUAL"):
    """Move an employee to a division, maintaining a non-overlapping history.

    BR-CORE-HISTORY-001 (no overlapping intervals), BR-CORE-HISTORY-002
    (current employee.division mirrors the open interval).
    """
    open_interval = (
        EmployeeDivisionHistory.objects.select_for_update()
        .filter(employee=employee, ends_at__isnull=True)
        .order_by("-starts_at")
        .first()
    )
    if open_interval:
        if open_interval.starts_at >= starts_at:
            raise ValidationError("New interval starts before the current open interval.")
        open_interval.ends_at = starts_at
        open_interval.full_clean()
        open_interval.save(update_fields=["ends_at"])

    record = EmployeeDivisionHistory(
        employee=employee, division=division, starts_at=starts_at, source=source
    )
    record.full_clean()
    record.save()

    employee.division = division
    employee.save(update_fields=["division", "updated_at"])
    return record


def compute_free_slots(division_id, *, on_date):
    """BR-CORE-STAFF-002: a vacancy is a staffing slot with no active assignment on a date.

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
