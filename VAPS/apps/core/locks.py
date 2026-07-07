"""Process-coordination locks (ARCH-DATA-022).

Postgres **session-level** advisory locks: mutual exclusion for a whole
background run (the catch-up beat task, Story 3.12) that spans MULTIPLE
transactions. Row locks (``select_for_update``) and ``pg_advisory_xact_lock``
both release at the first commit — useless when a run commits day-by-day. A
session-level ``pg_advisory_lock`` is held until explicitly released (or the
connection closes), so it brackets the entire multi-transaction run.

Postgres-only (advisory locks are a Postgres feature; ARCH-DATA-020).
"""

import logging
from contextlib import contextmanager

from django.db import connection

logger = logging.getLogger(__name__)


@contextmanager
def advisory_lock(key, *, blocking=True):
    """Hold a session-level Postgres advisory lock for ``key`` (a stable int).

    Yields ``True`` while the lock is held by this session; yields ``False``
    (without waiting) when ``blocking=False`` and another session already holds
    it — the caller decides what to do (e.g. skip the run). The lock is ALWAYS
    released in ``finally`` when it was acquired here.

    Session-level on purpose: a catch-up run commits one transaction per day,
    so the lock must outlive any single transaction. ``pg_advisory_xact_lock``
    would release at the first per-day commit and let a concurrent run in.
    Acquire and release run on the SAME ``connection`` (Django's per-thread
    connection), which is required for advisory lock/unlock to pair up.
    """
    if blocking:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s)", [key])
        acquired = True
    else:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", [key])
            acquired = cur.fetchone()[0]
    try:
        yield acquired
    finally:
        if acquired:
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", [key])
