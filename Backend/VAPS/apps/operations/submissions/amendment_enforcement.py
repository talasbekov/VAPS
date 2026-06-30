"""Amendment enforcement (Story 5.4b): the submissions-side body of the statuses
amendment seam.

Registered into ``apps.operations.statuses.amendment_hook`` at
``AppConfig.ready()`` (submissions → statuses, the allowed direction — statuses
never imports submissions, architecture.md#L587). Invoked synchronously INSIDE the
retro-edit's transaction, so the amendments it creates commit atomically with the
edit — «правка без amendment невозможна» (ARCH-DATA-021 L288, architecture.md
L356/623: AUTO-amend, not block).

Detection keys off snapshot MEMBERSHIP (``DailySubmissionSelector.covering``): the
submissions whose immutable snapshot roster contains the employee on an affected
day — NOT a recomputed edit-time division, which would diverge from the сдача-time
division on a transfer/history change and miss the covered day. ``amend_day`` (5.4a)
re-snapshots the corrected state per covered submission. Audit emission and sanction
escalation are out of scope (5.9 / E6 forward-seam).
"""

from datetime import timedelta

from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import amend_day

# Reason recorded on the auto-amendment; the retro-edit's own ``reason`` is the
# sanction (Q1 default — resolve_pending_clarification treats reason as the
# sanction, see its cancelled_reason). Sanction escalation «выше после ухода
# расхода наверх» is a forward-seam (E6 release).
_AUTO_AMENDMENT_REASON = "Авто-amendment: ретро-правка статуса под сданным днём."


def _affected_days(intervals):
    """Union of the half-open ``[date_start, date_end)`` day-sets — ``end`` EXCLUDED.

    A bounding box (min start … max end) would amend gap days between disjoint
    intervals; iterating each interval's own days and unioning the sets does not
    (closes deferred-work L315). An inverted/empty interval yields no days.
    """
    days = set()
    for date_start, date_end in intervals:
        day = date_start
        while day < date_end:
            days.add(day)
            day += timedelta(days=1)
    return days


def enforce_amendment_on_retro_edit(
    employee_id, intervals, *, actor, reason, triggered_by_status_id=None
):
    """Create an amendment for every submitted day the retro-edit covers.

    Affected days = the half-open union of the intervals. Covered submissions are
    found by snapshot membership (``covering`` — one JSONB query over all affected
    days), so a division change between сдача and edit cannot mislead detection. One
    ``amend_day`` per covered submission, atomic within the caller's transaction.
    """
    days = _affected_days(intervals)
    for submission in DailySubmissionSelector.covering(employee_id, days):
        amend_day(
            division_id=submission.division_id,
            business_date=submission.business_date,
            actor=actor,
            reason=_AUTO_AMENDMENT_REASON,
            sanction=reason,
            triggered_by_status_id=triggered_by_status_id,
        )
