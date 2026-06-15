from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services.strength_report import resolve_status


class EmployeeStatusSelector:
    """Bulk-first status reads — the ONLY data channel for aggregation."""

    @staticmethod
    def overlapping_on(on_date, employee_ids=None):
        """Live interval facts containing the date, one bulk query.

        period__contains rides the full GiST index built in 1.5 exactly
        for these derived lookups; cancelled rows do not exist for the
        report (cancelled_at is "записи нет").
        """
        qs = EmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            qs = qs.filter(employee_id__in=employee_ids)
        return list(
            qs.values("employee_id", "status_type_code", "date_start", "date_end")
        )

    @classmethod
    def status_on(cls, employee_id, on_date) -> str:
        """Point AC contract: the derived status of ONE employee.

        MUST NOT be called in a loop anywhere — that reproduces the
        donor's COUNT()-in-a-loop anti-pattern; the bulk path is
        overlapping_on + derive_report.
        """
        rows = cls.overlapping_on(on_date, employee_ids=[employee_id])
        return resolve_status(rows, on_date)
