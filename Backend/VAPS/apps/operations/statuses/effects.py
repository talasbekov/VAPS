"""Story 3.12 — effect seams for the status catch-up runner (FR-41).

Materializing a business day means writing its audit trail and emitting its
notifications. Neither consumer exists yet — ``AuditLog`` is Epic 4 (story 4.1)
and ``notifications`` is Epic 5 (story 5.7) — and ``statuses`` must not reach
across those boundaries anyway (architecture.md#L587). So these are documented
NO-OP seams with a real call-site: ``tasks.py`` calls ``materialize_day_effects``
once per day of the plan, which makes the wiring testable today and leaves
E4/E5 nothing to do but fill the bodies.

What is NOT an effect: the lifecycle of a status (PLANNED → ACTIVE → FINISHED)
is derived from ``[date_start, date_end)`` and the Clock — architecture.md#L298
forbids a mutable enum flipped by tasks — and so is the auto-return of a
secondment (story 3.7). The runner never mutates a status row.
"""


def record_catchup_audit(business_date):
    """E4 hook — NO-OP until ``AuditLog`` exists (Epic 4, story 4.1).

    ``business_date`` is the day being materialized. The closed-world registry
    ``docs/registries/audit-events.yaml`` carries no CATCHUP_* event yet, so
    there is nothing legitimate to write.
    """
    return None


def emit_catchup_notifications(business_date):
    """E5 hook — NO-OP until ``notifications.services.notify()`` exists (5.7).

    ``business_date`` is the day being materialized. FR-41's «за 7 дней до
    начала / за 3 дня до конца» reminders are deferred to этап 2 and are not
    this seam's concern either.
    """
    return None


def materialize_day_effects(business_date):
    """Every effect of one business day. Writes nothing to the DB today.

    Idempotency is carried by the monotonic watermark, not by a dedup key: the
    ``unique(entity, business_date, submission version)`` upsert of
    architecture.md#L299 needs «версия сдачи» = ``DailySubmission`` (Epic 5),
    so the materialization table arrives together with the real effects.
    """
    record_catchup_audit(business_date)
    emit_catchup_notifications(business_date)
