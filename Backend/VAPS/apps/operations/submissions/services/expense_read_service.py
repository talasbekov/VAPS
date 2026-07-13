"""Story 6.10a — read/period side of the расход HTTP surface.

Two read-only helpers over the existing per-date derive (`StrengthReportService
.compute`, story 1.7) — NO new model, NO issuance, NO DocumentSequence number:

* ``assert_report_date_has_data`` — the AC-4 guard: a date BEFORE the data
  horizon (earlier than every known status and history row) → 422
  ``REPORT_NO_DATA_FOR_DATE`` (distinct from 409 ``REPORT_NOT_READY_FOR_DATE``
  = «сдачи нет», and from a legitimately empty division on an in-range date =
  valid 0=0+0 report).
* ``derive_period`` — read-only «страница на дату»: for each date in the range
  the derived расход numbers (Решение Bratan Q2 — no per-period document, no
  number; the numbered legal artifact stays the single-date issue, 6.5/AC-1).

RBAC-free by contract (canon: domain services take no permission_code; the
coarse gate + ``ensure_division_scope`` live in the view). Business_date is an
explicit argument all the way down (ARCH-DATA-022); no Clock read here.
"""

from datetime import timedelta

from apps.core.exceptions import DomainError
from apps.core.selectors import HistoricalEmployeeSelector
from apps.operations.statuses.selectors import EmployeeStatusSelector
from apps.operations.statuses.services import StrengthReportService

# Guard on period length — a runaway range would derive thousands of days.
MAX_PERIOD_DAYS = 62


def report_data_horizon():
    """Earliest business date the system has ANY data for — or None if empty.

    min(earliest live status ``date_start``, earliest division-history start).
    Date-SENSITIVE by construction (review D1 2026-07-13): the previous roster
    truthiness probe was vacuous — ``roster_on`` falls back to the current
    ``Employee.division`` for employees with no covering history interval, and
    the pilot has ZERO history rows, so the roster is non-empty on ANY date
    (including 1990) as soon as one WORKING employee exists.
    """
    candidates = [
        d
        for d in (
            EmployeeStatusSelector.earliest_start(),
            HistoricalEmployeeSelector.earliest_history_start(),
        )
        if d is not None
    ]
    return min(candidates, default=None)


def assert_report_date_has_data(*, business_date):
    """Raise 422 ``REPORT_NO_DATA_FOR_DATE`` if the date predates the horizon.

    «До начала данных» = earlier than every known data point (statuses ∪
    division history), or an entirely empty system. A legitimately empty
    division on an in-range date passes → valid empty расход (0=0+0) — NOT
    this code. NOT 409 ``REPORT_NOT_READY_FOR_DATE`` (that = «сдачи за дату
    нет», a different, state-level condition). The finer «division did not
    exist yet on the date» refinement is deferred to 7.x — the pilot has no
    trustworthy division creation date until E7 backfills history (review D1).
    """
    horizon = report_data_horizon()
    if horizon is not None and business_date >= horizon:
        return
    raise DomainError(
        "REPORT_NO_DATA_FOR_DATE",
        422,
        detail={
            "business_date": business_date.isoformat(),
            "data_horizon": horizon.isoformat() if horizon else None,
        },
        message="Запрошена дата до начала данных — нет ни списка, ни статусов.",
    )


def _serialize_report(business_date, result):
    """StrengthReportResult → flat JSON page (numbers only, read-only)."""
    return {
        "business_date": business_date.isoformat(),
        "totals": {
            "staff_total": result.totals.staff_total,
            "list_total": result.totals.list_total,
            "vacancies": result.totals.vacancies,
            "attached": result.totals.attached,
            "columns": dict(result.totals.columns),
        },
        "rows": [
            {
                "division_id": str(row.division_id),
                "name": row.name,
                "staff_total": row.staff_total,
                "list_total": row.list_total,
                "vacancies": row.vacancies,
                "attached": row.attached,
                "columns": dict(row.columns),
            }
            for row in result.rows
        ],
    }


def derive_period(*, division_id, date_from, date_to):
    """Read-only page-per-date расход over ``[date_from, date_to]`` (Q2).

    One page per calendar date = ``derive(снапшот, дата)`` numbers. NO number,
    NO stored document. A date before data begins → 422 (AC-4). Raises 400
    ``VALIDATION_ERROR`` on an inverted or over-long range.
    """
    if date_from > date_to:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            message="date_from не может быть позже date_to.",
        )
    span = (date_to - date_from).days + 1
    if span > MAX_PERIOD_DAYS:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"days": span, "max": MAX_PERIOD_DAYS},
            message=f"Период слишком длинный (макс. {MAX_PERIOD_DAYS} дней).",
        )

    # The range is contiguous and ascending, so one horizon check on date_from
    # covers the whole span (hoisted out of the loop — review perf 2026-07-13).
    assert_report_date_has_data(business_date=date_from)

    pages = []
    day = date_from
    while day <= date_to:
        result = StrengthReportService.compute(day, division_id)
        pages.append(_serialize_report(day, result))
        day += timedelta(days=1)
    return pages
