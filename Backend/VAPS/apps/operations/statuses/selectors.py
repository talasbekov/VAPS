from django.db.models import Min

from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services.strength_report import resolve_status


class EmployeeStatusSelector:
    """Bulk-first status reads — the ONLY data channel for aggregation."""

    @staticmethod
    def earliest_start():
        """Earliest live status date_start — the status half of the report
        data horizon (6.10a review D1 2026-07-13). None on an empty system.
        """
        return EmployeeStatus.objects.filter(cancelled_at__isnull=True).aggregate(
            m=Min("date_start")
        )["m"]

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

    @staticmethod
    def snapshot_facts_on(on_date, employee_ids=None):
        """Like overlapping_on, but also carries status_id (pk) and source.

        The DailySubmission снапшот row (story 5.3a) needs ``status_id`` and
        ``source``, which overlapping_on omits. overlapping_on is left UNTOUCHED
        (strength_report rides its exact 4-field shape) — this is a sibling, not
        a change. Same predicate: cancelled_at IS NULL + period contains the
        date (the GiST-indexed half-open [date_start, date_end) lookup).
        """
        qs = EmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            qs = qs.filter(employee_id__in=employee_ids)
        return list(
            qs.values(
                "id",
                "employee_id",
                "status_type_code",
                "date_start",
                "date_end",
                "source",
            )
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
