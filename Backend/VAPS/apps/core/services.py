from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.models import EmployeeDivisionHistory


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
