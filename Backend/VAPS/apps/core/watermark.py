"""Watermark bookkeeping + advisory lock (ARCH-DATA-022, Story 3.12).

The single read/write point for ``core_watermarks``. It lives in core because
the table does: ``apps/operations/**`` MUST NOT import ``apps.core.models``
(ARCH-004, test_operations_does_not_import_core_models), so the catch-up runner
in ``operations/statuses/tasks.py`` calls these functions instead of the ORM.

This module NEVER reads the wall clock — business dates always arrive as
parameters (architecture.md#L300). The AST guard
``test_no_wall_clock_reads_in_domain_layers`` covers only ``services.py`` /
``models.py``, not this file, so that discipline is manual here.
"""

import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date

from django.db import connection

from apps.core.models import Watermark


def _lock_id(name: str) -> int:
    """Stable 32-bit advisory-lock id for a watermark key.

    Builtin ``hash()`` is randomized per process (PYTHONHASHSEED), so two beat
    containers would take two different locks and both run. crc32 does not move.
    """
    return zlib.crc32(name.encode())


@contextmanager
def advisory_lock(name: str) -> Iterator[bool]:
    """Yield whether the session-level advisory lock for ``name`` was taken.

    Session-level, not ``pg_try_advisory_xact_lock``: the lock has to outlive
    the N per-day transactions of one catch-up run — an xact lock would drop at
    the first commit and let a second runner into the middle of the plan.

    Non-blocking (``try``): a beat tick that finds the lock held exits silently
    (architecture.md#L469) rather than queueing up behind the run in progress.

    Advisory locks are re-entrant within a session (Postgres counts them), so
    the unlock is strictly paired — we release only what we actually acquired,
    never someone else's count.
    """
    lock_id = _lock_id(name)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [lock_id])
        acquired = cursor.fetchone()[0]
    try:
        yield acquired
    finally:
        if acquired:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s)", [lock_id])


def read_watermark(key: str) -> date | None:
    """Last materialized business date for ``key``; None if never bootstrapped."""
    return (
        Watermark.objects.filter(key=key)
        .values_list("last_materialized_date", flat=True)
        .first()
    )


def bootstrap_watermark(key: str, *, on: date) -> date:
    """Create the row at ``on`` if absent; return the date actually stored.

    Idempotent: an existing row is never rewound to ``on``. Callers hold the
    advisory lock, so the concurrent first-create never reaches IntegrityError.
    """
    row, _created = Watermark.objects.get_or_create(
        key=key, defaults={"last_materialized_date": on}
    )
    return row.last_materialized_date


def advance_watermark(key: str, *, to: date) -> date:
    """Move the watermark strictly forward. Call inside the day's transaction.

    ``to <= current`` is refused: a silent rewind would re-materialize days that
    already ran, which is exactly the duplicate-effect bug the watermark
    prevents. Monotonicity needs the old value, so it cannot be a CheckConstraint
    — it is guarded here, under the advisory lock that serializes writers.
    """
    try:
        row = Watermark.objects.get(key=key)
    except Watermark.DoesNotExist as exc:
        raise ValueError(f"watermark {key!r} is not bootstrapped") from exc
    if to <= row.last_materialized_date:
        raise ValueError(
            f"watermark {key!r} must advance strictly forward: "
            f"{row.last_materialized_date.isoformat()} -> {to.isoformat()}"
        )
    row.last_materialized_date = to
    # save(), not queryset.update(): auto_now on updated_at only fires on save.
    row.save(update_fields=["last_materialized_date", "updated_at"])
    return to
