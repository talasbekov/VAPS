"""Story 3.9 — amendment seam for Epic 5 (E5 does not exist yet).

When a status covering already-submitted days is retro-edited, the affected
submitted days MUST be flagged for amendment (ARCH-DATA-021 invariant: ретро-
правка накрытой сданной даты ОБЯЗАНА триггерить amendment — иначе две правды).

The DETECTION of which days were actually submitted lives in
``apps.operations.submissions`` (Epic 5, story 5.4), which reads ``statuses`` —
never the reverse (architecture.md#L587: subdomain flow is one-way, downward).
So ``statuses`` MUST NOT import ``submissions``. Until E5 exists this is a
documented NO-OP seam: the resolution service calls it with the affected
interval, making the call-site real and testable; E5 fills the body (and may
relocate it onto its own side of the contract).
"""


def mark_days_for_amendment(employee_id, date_start, date_end):
    """E5 hook — NO-OP until ``DailySubmission`` exists (Epic 5, story 5.4).

    ``employee_id`` whose status changed; ``[date_start, date_end)`` the
    half-open span of affected days. The «covered date» boundary semantics at
    ``end`` (and partial multi-day overlaps) are an explicitly deferred E5
    contract (VAPS_7.8.2 §82.2 → deferred-work), not decided here.
    """
    return None
