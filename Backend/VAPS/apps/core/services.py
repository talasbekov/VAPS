from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.core.models import (
    Employee,
    EmployeeDivisionHistory,
    EmployeeStaffingAssignment,
    SensitiveFieldPolicy,
    StaffingSlot,
    Vacancy,
)
from apps.core.selectors import local_midnight


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


@transaction.atomic
def dismiss_employee(employee, *, date, reason=None, actor: str):
    """Dismiss an employee on calendar date D (core side, story 2.5).

    Soft-delete only (architecture.md:468 / ARCH-DATA-025 — nothing is
    physically deleted): archive the card, close the open division-history
    interval at D, free the staffing slot(s) (close the open assignment +
    open an explicit Vacancy carrying the основание), so the employee drops
    out of roster_on(D) — the Список denominator (story 2.4).

    Cross-context note: closing EmployeeStatus rows is NOT here (core ↛
    operations, ARCH-004) — the operations-side orchestrator composes this
    with close_active_statuses_on. `date` is explicit (no wall-clock,
    ARCH-DATA-022); datetime columns use local_midnight(D).
    """
    if not actor or not actor.strip():
        raise ValidationError("actor must be a non-empty string")
    employee = Employee.objects.select_for_update().get(id=employee.id)
    if employee.employment_status != Employee.EmploymentStatus.WORKING:
        raise ValidationError("employee is not WORKING; cannot dismiss")
    t = local_midnight(date)

    open_interval = (
        EmployeeDivisionHistory.objects.select_for_update()
        .filter(employee=employee, ends_at__isnull=True)
        .order_by("-starts_at")
        .first()
    )
    if open_interval:
        if open_interval.starts_at >= t:
            raise ValidationError("dismissal date precedes the open interval start.")
        open_interval.ends_at = t
        open_interval.full_clean()
        open_interval.save(update_fields=["ends_at"])

    open_assignments = list(
        EmployeeStaffingAssignment.objects.select_for_update().filter(
            employee=employee, ends_at__isnull=True
        )
    )
    for assignment in open_assignments:
        if assignment.starts_at >= t:
            raise ValidationError("dismissal date precedes an assignment start.")
        assignment.ends_at = t
        assignment.full_clean()
        assignment.save(update_fields=["ends_at"])
        vacancy = Vacancy(
            staffing_slot=assignment.staffing_slot,
            status_code=Vacancy.Status.OPEN,
            opened_at=t,
            reason=reason,
            created_by=actor,
        )
        vacancy.full_clean()
        vacancy.save()

    employee.employment_status = Employee.EmploymentStatus.ARCHIVED
    employee.is_active = False
    employee.dismissal_date = date
    employee.separated_at = t
    employee.save(
        update_fields=[
            "employment_status",
            "is_active",
            "dismissal_date",
            "separated_at",
            "updated_at",
        ]
    )
    return employee


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
