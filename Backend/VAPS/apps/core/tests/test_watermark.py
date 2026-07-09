import ast
import zlib
from datetime import date, timedelta
from pathlib import Path

import pytest
from django.db import IntegrityError, connection, connections, transaction
from django.test.utils import CaptureQueriesContext

from apps.core import watermark as watermark_module
from apps.core.models import Watermark
from apps.core.watermark import (
    _lock_id,
    advance_watermark,
    advisory_lock,
    bootstrap_watermark,
    read_watermark,
)

KEY = "status_effects"
OTHER_KEY = "some_other_effects"
DAY = date(2026, 3, 1)

WALL_CLOCK_CALLS = {
    "timezone.now",
    "datetime.now",
    "datetime.today",
    "datetime.utcnow",
    "date.today",
    "now",
}


def _held_advisory_locks(conn=connection) -> int:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks "
            "WHERE locktype = 'advisory' AND pid = pg_backend_pid()"
        )
        return cursor.fetchone()[0]


def _take_lock(conn, name: str) -> bool:
    with conn.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [_lock_id(name)])
        return cursor.fetchone()[0]


@pytest.fixture
def other_session():
    """A second, real database session.

    Advisory locks are re-entrant within one session (Postgres counts them), so
    a rival modelled on the test's own connection would take the lock happily
    and every mutual-exclusion assertion would be falsely green. Closing the
    connection releases whatever advisory locks it still holds.
    """
    conn = connections.create_connection("default")
    try:
        yield conn
    finally:
        conn.close()


def test_lock_id_is_crc32_not_builtin_hash():
    # PYTHONHASHSEED randomizes builtin hash() per process, so two beat
    # containers would take two *different* locks and both run (AC-10).
    assert _lock_id("status_effects") == zlib.crc32(b"status_effects")


@pytest.mark.django_db
def test_advisory_lock_is_acquired_then_released():
    before = _held_advisory_locks()
    with advisory_lock(KEY) as acquired:
        assert acquired is True
        assert _held_advisory_locks() == before + 1
    # Session-level locks survive the transaction, so the unlock must be ours.
    assert _held_advisory_locks() == before


@pytest.mark.django_db
def test_advisory_lock_releases_on_exception():
    before = _held_advisory_locks()
    with pytest.raises(RuntimeError):
        with advisory_lock(KEY) as acquired:
            assert acquired is True
            raise RuntimeError("body exploded")
    assert _held_advisory_locks() == before


@pytest.mark.django_db
def test_advisory_lock_is_refused_while_another_session_holds_it(other_session):
    # The `acquired is False` branch — and with it AC-8's whole premise — is
    # otherwise reachable only through the concurrency-marked test, which the
    # gate deselects. Two real sessions, no threads: deterministic.
    assert _take_lock(other_session, KEY) is True
    ours_before = _held_advisory_locks()

    with CaptureQueriesContext(connection) as captured:
        with advisory_lock(KEY) as acquired:
            assert acquired is False
            assert _held_advisory_locks() == ours_before

    # The `finally` must release only what we acquired. Postgres would refuse to
    # hand over a lock owned by another session anyway, so an unconditional
    # unlock leaves no trace in the database — only in the SQL we emitted (and
    # in the server log, as "you don't own a lock of type ExclusiveLock").
    emitted = " ".join(query["sql"] for query in captured.captured_queries)
    assert "pg_try_advisory_lock" in emitted, "sanity: we did try to take it"
    assert "pg_advisory_unlock" not in emitted, "released a lock we never took"

    assert _held_advisory_locks(other_session) == 1, "the rival kept its lock"


def test_lock_ids_differ_between_keys():
    # Two watermarks must not serialize against each other on one advisory lock.
    assert _lock_id(KEY) != _lock_id(OTHER_KEY)


def test_watermark_module_never_reads_the_wall_clock():
    # AC-1: business dates always arrive as parameters (ARCH-DATA-022 #L300).
    # The project-wide AST guard `test_no_wall_clock_reads_in_domain_layers`
    # scans only services.py/models.py, so this module needs its own.
    tree = ast.parse(Path(watermark_module.__file__).read_text(encoding="utf-8"))
    calls = {
        ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)
    }
    assert not calls & WALL_CLOCK_CALLS, calls & WALL_CLOCK_CALLS


@pytest.mark.django_db
def test_read_watermark_returns_none_for_unknown_key():
    assert read_watermark(KEY) is None


@pytest.mark.django_db
def test_bootstrap_creates_row_and_returns_its_date():
    assert bootstrap_watermark(KEY, on=DAY) == DAY
    assert Watermark.objects.get(key=KEY).last_materialized_date == DAY


@pytest.mark.django_db
def test_bootstrap_is_idempotent_and_never_overwrites():
    bootstrap_watermark(KEY, on=DAY)
    # A second run (concurrent first-create resolved by the advisory lock, or a
    # plain re-run) must keep the original date, not rewind to the new `on`.
    assert bootstrap_watermark(KEY, on=DAY + timedelta(days=5)) == DAY
    assert Watermark.objects.filter(key=KEY).count() == 1


@pytest.mark.django_db
def test_advance_watermark_moves_forward():
    bootstrap_watermark(KEY, on=DAY)
    advance_watermark(KEY, to=DAY + timedelta(days=1))
    assert read_watermark(KEY) == DAY + timedelta(days=1)


@pytest.mark.django_db
def test_advance_watermark_backwards_raises():
    bootstrap_watermark(KEY, on=DAY)
    with pytest.raises(ValueError, match="strictly forward"):
        advance_watermark(KEY, to=DAY - timedelta(days=1))
    assert read_watermark(KEY) == DAY


@pytest.mark.django_db
def test_advance_watermark_to_same_date_raises():
    # Re-materializing an already-materialized day is the duplicate-effect bug
    # the watermark exists to prevent: monotonicity is *strict*.
    bootstrap_watermark(KEY, on=DAY)
    with pytest.raises(ValueError, match="strictly forward"):
        advance_watermark(KEY, to=DAY)
    assert read_watermark(KEY) == DAY


@pytest.mark.django_db
def test_advance_watermark_on_unbootstrapped_key_raises():
    with pytest.raises(ValueError, match="not bootstrapped"):
        advance_watermark(KEY, to=DAY)


@pytest.mark.django_db
def test_watermark_keys_are_independent():
    # `core_watermarks` is a keyed store: advancing one materialization stream
    # must not drag another one forward past days it never replayed.
    bootstrap_watermark(KEY, on=DAY)
    bootstrap_watermark(OTHER_KEY, on=DAY)

    advance_watermark(KEY, to=DAY + timedelta(days=1))

    assert read_watermark(KEY) == DAY + timedelta(days=1)
    assert read_watermark(OTHER_KEY) == DAY


@pytest.mark.django_db
def test_blank_key_violates_check_constraint():
    # A silently-empty key would let two processes share one watermark row.
    with pytest.raises(IntegrityError) as exc:
        with transaction.atomic():
            Watermark.objects.create(key="", last_materialized_date=DAY)
    assert "ck_core_watermarks_key_not_blank" in str(exc.value)
