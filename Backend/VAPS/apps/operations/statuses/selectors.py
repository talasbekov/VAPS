import calendar
import datetime

from django.contrib.postgres.fields.ranges import DateRange
from django.db.models import Min

from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.strength_report import resolve_status


class StatusTypeSelector:
    """Read-only access to the status-type reference catalog.

    The read channel for modules OUTSIDE ``statuses``: submissions reaches
    statuses only through ``selectors``/``services``, never by importing the
    models across the module seam (story 10.8 Д6). Mirrors the shape of
    ``CoreDivisionTreeSelector.divisions_map`` — one query, a flat map.
    """

    @staticmethod
    def names_map() -> dict:
        """``code -> name`` for report/export rows, ONE query.

        Includes deactivated types on purpose: an immutable snapshot legally
        cites a type that was renamed or deactivated after сдача, and the
        export must still resolve its human-readable name. The caller falls
        back to the code itself when a type is absent entirely.
        """
        return dict(StatusType.objects.values_list("code", "name"))


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

    @classmethod
    def month_calendar(cls, employee_id, year, month) -> dict:
        """Story 19.4a (FR-37): дневной статус ОДНОГО сотрудника за ЦЕЛЫЙ
        месяц, ОДИН bulk-запрос. Возвращает плотный `Dict[date, str]` —
        КАЖДЫЙ день месяца, включая дни без факта (`resolve_status()`
        уже отдаёт "IN_SERVICE", FR-9, для них).

        Цикл по дням месяца ниже — ЧИСТЫЙ Python над уже загруженным
        `rows` (никаких запросов внутри цикла); предупреждение
        `status_on`'s docstring про "MUST NOT be called in a loop"
        относится к методам, каждый из которых сам бьёт БД
        (`status_on`/`overlapping_on`), не к чистой функции
        `resolve_status`."""
        if not 1 <= month <= 12:
            raise ValueError(f"month must be 1-12, got {month!r}")
        days_in_month = calendar.monthrange(year, month)[1]
        month_start = datetime.date(year, month, 1)
        month_end = datetime.date(year, month, days_in_month) + datetime.timedelta(
            days=1
        )

        rows = list(
            EmployeeStatus.objects.filter(
                cancelled_at__isnull=True,
                employee_id=employee_id,
                period__overlap=DateRange(month_start, month_end, bounds="[)"),
            ).values("employee_id", "status_type_code", "date_start", "date_end")
        )

        days = [month_start + datetime.timedelta(days=i) for i in range(days_in_month)]
        return {day: resolve_status(rows, day) for day in days}
