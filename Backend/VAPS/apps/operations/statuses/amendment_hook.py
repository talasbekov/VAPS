"""Story 3.9/5.4b — amendment seam between statuses and submissions.

When a status covering already-submitted days is retro-edited, the affected
submitted days MUST trigger an amendment (ARCH-DATA-021 invariant L288: ретро-
правка накрытой сданной даты ОБЯЗАНА триггерить amendment — иначе две правды;
architecture.md L356/623: AUTO-amendments, not a block).

The DETECTION of which days were actually submitted lives in
``apps.operations.submissions`` (story 5.4b), which reads ``statuses`` — never the
reverse (architecture.md#L587: subdomain flow is one-way, downward). So
``statuses`` MUST NOT import ``submissions``. This module is the INVERSE SEAM: a
module-level handler slot that ``statuses`` owns and dispatches through, while
``submissions`` provides the implementation and registers it at
``AppConfig.ready()`` (submissions → statuses is the allowed direction). Until a
handler is registered this stays a documented NO-OP (the pre-E5 contract).
"""

_handler = None


def register_amendment_handler(fn):
    """Register the submissions-side enforcement handler.

    Called once from ``ops_submissions`` ``AppConfig.ready()``. Keeps the
    statuses → submissions edge absent: statuses never imports submissions; the
    dependency is inverted through this late-bound callback slot (architecture.md
    #L587). Idempotent — a re-register (e.g. app reload) just replaces the slot.
    """
    global _handler
    _handler = fn


def mark_days_for_amendment(
    employee_id, intervals, *, actor, reason, triggered_by_status_id=None
):
    """Dispatch a retro-edit's affected intervals to the registered handler.

    ``intervals`` — list of half-open ``(date_start, date_end)`` pairs (NOT a
    bounding box): every day whose derived status could have changed. The handler
    (submissions) detects which days are covered by a current ``DailySubmission``
    and triggers an amendment (``amend_day``) per covered ``(division, day)``,
    ATOMICALLY within the retro-edit's transaction. ``actor``/``reason`` flow from
    the retro-edit (``reason`` carries the sanction); ``triggered_by_status_id`` —
    the resolving status. NO-OP when no handler is registered (pre-E5 contract).

    The «covered date» boundary at ``end`` is the half-open one (``end`` EXCLUDED),
    decided here per ARCH-DATA-023 (closes the VAPS_7.8.2 §82.2 / deferred-work
    L315 bounding-box gap).
    """
    if _handler is None:
        return None
    return _handler(
        employee_id,
        intervals,
        actor=actor,
        reason=reason,
        triggered_by_status_id=triggered_by_status_id,
    )
