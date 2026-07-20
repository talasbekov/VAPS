"""Story 11.2 — ``notify()`` publishes to the websocket on commit (FR-35).

This is the first module in the project that puts the ORM, ``transaction`` and a
live socket in ONE test, and the harness below is the part worth reading before
changing anything.

**Why a synchronous island.** A real subscriber forces ``async def`` (the
``WsCommunicator`` of 11.1), but Django's ORM is ``@async_unsafe`` — calling it
from a thread with a running event loop raises ``SynchronousOnlyOperation`` — and
``async_to_sync`` refuses to run in such a thread outright
(``RuntimeError: You cannot use AsyncToSync in the same thread as an async event
loop``). Both are reachable here, so everything synchronous — ORM, the
transaction, and the ``group_send`` the commit hook performs — runs inside
``_island()``, off the loop, while the test body keeps only the socket.

**Why no ``django_capture_on_commit_callbacks`` in the island.** Django's
connections are thread-local, so the island gets its OWN connection — verified:
it cannot see rows the main thread wrote inside pytest-django's test atomic.
That atomic therefore does not cover the island at all, which means
``transaction.atomic()`` in there is a REAL transaction: a real COMMIT really
fires ``on_commit``, and a real ROLLBACK really discards it. Capturing callbacks
would emulate a commit that genuinely happens — strictly weaker. Ловушка №1 of
the story (callbacks never run under plain ``django_db``) is real and is why the
one main-thread test below DOES take the fixture; it simply does not apply to the
island.

**Why the island cleans up after itself.** The flip side of a real commit: those
rows are NOT rolled back by pytest-django, and the island's connection would stay
open into teardown («database is being accessed by other users»). Hence the
delete-and-close in ``_island``. ``django_db(transaction=True)`` — the story's
alternative — is NOT usable in this project: its teardown flush TRUNCATEs every
table and ``audit_logs`` rejects TRUNCATE at the DB level (story 4.2,
ARCH-SEC-032), so the test errors in teardown. Every ``transaction=True`` test in
the repo is marked concurrency/slow and runs only in ``test-full``, where those
teardown errors are the known, accepted ones.

**What the island cannot cover.** A test driving the real production emitter
(``lagging_check.check_lagging_submissions``) end to end was designed and
deliberately dropped: its seeding mutates ``SubmissionControlSettings``, which is
migration-seeded, and in here that mutation would COMMIT for the rest of the
session rather than roll back with the test. The invariant it was after — the
callback follows a per-day ``atomic`` nested in the run — is covered instead by
``test_inner_savepoint_rollback_discards_the_signal``, at no such risk.

Nothing here is skipped when Redis is down — ``make gate`` starts it, and
``test_ws_guards.test_ws_tests_are_never_skipped`` enforces that for this file
(which is also why the module is named ``test_ws_notify``, not
``test_notify_ws``: the guard globs ``test_ws_*.py``).
"""

import logging
from datetime import date

import pytest
from asgiref.sync import sync_to_async
from django.db import connection, transaction

from apps.notifications.api.serializers import NotificationSerializer
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.notifications.tests.test_ws_consumer import _communicator

DAY = date(2026, 6, 5)
KIND = Notification.Kind.SUBMISSION_LAGGING
RECIPIENT = "boss"
# A second, unrelated actor. Every other test in this module subscribes as the
# addressee, which cannot tell «delivered to the right group» from «delivered to
# a group everyone shares» — see test_only_the_addressed_recipient_receives_it.
OTHER_RECIPIENT = "colonel"
PAYLOAD = {"laggard_division_ids": ["div-1", "div-2"]}
SERVICES_LOGGER = "apps.notifications.services"


async def _island(fn):
    """Run *fn* off the event loop, on its own connection, and clean up after it.

    ``thread_sensitive=True`` is load-bearing: it pins every call to ONE executor
    thread, so the connection ``fn`` opens is the same one the cleanup closes.

    The delete is unscoped because within these tests the island is the only
    writer of notifications — the main thread's own rows (if any) live in
    pytest-django's atomic on a different connection and are invisible here.
    """

    def _wrapped():
        try:
            return fn()
        finally:
            Notification.objects.all().delete()
            connection.close()

    return await sync_to_async(_wrapped, thread_sensitive=True)()


class _ExplodingChannelLayer:
    """Stands in for an unreachable Redis: ``group_send`` always raises.

    ``group_send`` is a real coroutine function, not a Mock — ``async_to_sync``
    type-checks its argument and would raise ``TypeError`` before ever calling a
    Mock, turning «the layer blew up» into «the test never reached the layer».
    ``calls`` exists to prove the failure path was actually exercised.
    """

    def __init__(self):
        self.calls = 0

    async def group_send(self, group, message):
        self.calls += 1
        raise RuntimeError("channel layer is down")


def _explode(monkeypatch):
    """Patch the name ``services`` bound at import time, NOT ``channels.layers``.

    ``services.py`` did ``from channels.layers import get_channel_layer``, so it
    holds its own reference; patching the source module would leave the service
    using the real layer and the test would go green for the wrong reason.
    """
    layer = _ExplodingChannelLayer()
    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", lambda: layer
    )
    return layer


# ---------------------------------------------------------------------------
# AC-4 — commit publishes, rollback does not
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_commit_publishes_to_the_recipient_group():
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
        return Notification.objects.count()

    rows = await _island(_work)
    envelope = await communicator.receive_json_from(timeout=5)

    assert rows == 1
    # The client-facing type is the registry code — i.e. the row's own `kind`,
    # not a second dictionary mapping one to the other (AC-3).
    assert envelope["type"] == "SUBMISSION_LAGGING"
    assert envelope["payload"]["recipient"] == RECIPIENT
    assert envelope["payload"]["payload"] == PAYLOAD
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_rollback_publishes_nothing():
    """The core of the story: a rolled-back business transaction is SILENT.

    Sending inline instead of through ``on_commit`` passes every happy-path test
    and fails only here — in production it would announce a row that the rollback
    removed, and the client would fetch a 404.

    The «nothing arrived» half is worthless on its own (a dead socket is silent
    too), so the same test proves the socket is alive afterwards by committing a
    notification through it — the anti-vacuum idiom of ``test_ws_consumer``.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _rolled_back():
        try:
            with transaction.atomic():
                notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
                raise RuntimeError("business txn fails after notify")
        except RuntimeError:
            pass
        return Notification.objects.count()

    assert await _island(_rolled_back) == 0
    assert await communicator.receive_nothing(timeout=1) is True

    def _committed():
        with transaction.atomic():
            notify(RECIPIENT, KIND, date(2026, 6, 7), payload=PAYLOAD)

    await _island(_committed)
    alive = await communicator.receive_json_from(timeout=5)
    assert alive["payload"]["business_date"] == "2026-06-07"
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_only_the_addressed_recipient_receives_it():
    """AC-4 addresses ONE group: ``group_name_for(notification.recipient)``.

    Every other test here subscribes AS the addressee, so all of them stay green
    even if the sender broadcast to a group every actor shares — «my message
    arrived» says nothing about who else got it. Cross-delivery is the exact
    failure ``group_name_for`` exists to prevent (it hashes rather than sanitises
    precisely so ``a@b`` and ``a_b`` cannot collapse onto one name, groups.py),
    and until now nothing asserted the SENDER honours that contract. It is also
    the one bug in this story with a confidentiality blast radius: notifications
    carry which divisions are lagging, addressed by resolved duty officer.
    """
    mine = _communicator(user_id=RECIPIENT)
    theirs = _communicator(user_id=OTHER_RECIPIENT)
    assert (await mine.connect())[0] is True
    assert (await theirs.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    await _island(_work)

    delivered = await mine.receive_json_from(timeout=5)
    assert delivered["payload"]["recipient"] == RECIPIENT
    # The other socket is provably live (it completed a handshake above) and
    # provably silent — the two halves together are what make this meaningful.
    assert await theirs.receive_nothing(timeout=1) is True
    await mine.disconnect()
    await theirs.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_padded_recipient_reaches_the_stripped_group():
    """``notify()`` strips the recipient (lesson 5.6b: whitespace variants must
    not defeat the one-per-day key) — and the group name has to follow it.

    The two are coupled only by ``_publish`` addressing ``notification.recipient``
    (the stored, stripped value) rather than the argument it was called with.
    Addressing the raw argument would still pass every other test in this module,
    because they all pass an already-clean string; it would fail in production
    silently — ``group_name_for("  boss  ")`` is a perfectly valid group name
    that nobody is subscribed to, so the message would simply go nowhere.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(f"  {RECIPIENT}  ", KIND, DAY, payload=PAYLOAD)

    await _island(_work)
    delivered = await communicator.receive_json_from(timeout=5)

    assert delivered["payload"]["recipient"] == RECIPIENT
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_inner_savepoint_rollback_discards_the_signal():
    """Ловушка №7 from the other side: the callback follows the transaction it
    was registered in — savepoints included.

    ``test_rollback_publishes_nothing`` discards the WHOLE transaction, where a
    lost signal is over-determined (nothing committed at all). Production is
    finer-grained: ``lagging_check`` calls ``notify()` inside a per-day
    ``atomic`` nested in the catch-up run, so one day can roll back to its
    savepoint while the run commits. Django drops ``on_commit`` callbacks
    registered after a rolled-back savepoint, and that is what keeps a failed
    day from announcing a row the savepoint removed.

    The committed day in the same block is load-bearing: it proves the OUTER
    transaction really landed, so «nothing arrived for the failed day» is about
    the savepoint and not about a transaction that never committed.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True
    committed_day = date(2026, 6, 8)

    def _work():
        with transaction.atomic():  # the catch-up run: commits
            try:
                with transaction.atomic():  # one day: rolls back to a savepoint
                    notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
                    raise RuntimeError("this day fails after notify")
            except RuntimeError:
                pass
            notify(RECIPIENT, KIND, committed_day, payload=PAYLOAD)
        return sorted(Notification.objects.values_list("business_date", flat=True))

    assert await _island(_work) == [committed_day]
    arrived = await communicator.receive_json_from(timeout=5)
    assert arrived["payload"]["business_date"] == committed_day.isoformat()
    assert await communicator.receive_nothing(timeout=1) is True
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# AC-6 — the signal tracks a state change, not a call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_repeat_call_publishes_nothing():
    """``catch_up`` re-asks about already-notified days by construction
    (idempotency-by-watermark). Publishing per call rather than per created row
    would turn one retry into a storm of duplicates about rows that did not
    change."""
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
            notify(RECIPIENT, KIND, DAY, payload={"ignored": True})
        return Notification.objects.count()

    assert await _island(_work) == 1
    assert (await communicator.receive_json_from(timeout=5))["type"] == KIND.value
    # The second call was a no-op in the DB, so it must be a no-op on the wire.
    assert await communicator.receive_nothing(timeout=1) is True
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_repeat_call_in_a_separate_transaction_publishes_nothing():
    """AC-6 in the shape production actually produces it.

    The test above makes both calls inside ONE transaction, where the second is
    a no-op against a row that same transaction just wrote — ``get_or_create``
    reads its own uncommitted state. ``lagging_check.catch_up`` does something
    different: it re-asks about a day whose notification an EARLIER run already
    committed (idempotency-by-watermark), so the second ``created`` comes from a
    row read back out of the database. That is the retry path that would turn
    one restart into a storm of duplicates, and a ``created`` flag exercised only
    within a single transaction never proved it stays ``False`` across them.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
        # A second, fully separate transaction — the catch-up rerun.
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload={"ignored": True})
        return Notification.objects.count()

    assert await _island(_work) == 1
    assert (await communicator.receive_json_from(timeout=5))["type"] == KIND.value
    assert await communicator.receive_nothing(timeout=1) is True
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# AC-7 — a dead channel layer changes nothing about notify()
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_channel_layer_failure_is_non_fatal(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Transaction branch: the callback runs after the commit, outside the
    ``try`` in ``notify()`` — so ``_publish`` needs its own.

    Here the fixture IS required (Ловушка №1): this test runs on the main thread,
    whose connection pytest-django wraps in an atomic that never commits, so
    without it the callback would never run and the test would be vacuous.

    Both consequences are asserted. «It did not raise» alone would miss the
    regression ``lagging_check`` actually reads — a ``None`` return makes
    ``_emit_lagging`` raise ``LaggingNotifyError``, roll the day back and hold the
    watermark, i.e. an outage of the signal would stop the business catch-up.
    """
    layer = _explode(monkeypatch)

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    assert row is not None
    assert Notification.objects.filter(
        recipient=RECIPIENT, kind=KIND, business_date=DAY
    ).exists()
    # Anti-vacuum: the layer really was reached and really did blow up.
    assert layer.calls == 1


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_autocommit_layer_failure_is_non_fatal(monkeypatch):
    """Autocommit branch — separate code path, covered by nothing else.

    With no atomic in scope, ``transaction.on_commit`` runs the callback
    IMMEDIATELY and inline, i.e. inside ``notify()``'s own ``try``. Without the
    guard in ``_publish`` the exception would be swallowed THERE and ``notify()``
    would return ``None`` — the same regression as above, reached the other way.

    Runs in the island precisely because it needs true autocommit: on the main
    thread pytest-django's atomic is always in scope, so this branch is
    unreachable there.
    """
    layer = _explode(monkeypatch)

    def _work():
        row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
        return row, Notification.objects.count(), layer.calls

    row, rows, calls = await _island(_work)

    assert row is not None
    assert rows == 1
    assert calls == 1


@pytest.mark.django_db
def test_publish_failure_is_logged(
    monkeypatch, caplog, django_capture_on_commit_callbacks
):
    """AC-7 asks for the failure to be swallowed AND recorded; the two tests
    above only prove the swallowing.

    A silently swallowed exception is an invisible outage: WS delivery could stop
    for every user in the system while the gate, the caller, the DB and every
    other test here stayed green — the failure is INVISIBLE by construction on
    this path, which is precisely why the log is the only thing that surfaces it.
    """
    layer = _explode(monkeypatch)
    caplog.set_level(logging.ERROR, logger=SERVICES_LOGGER)

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    assert row is not None and layer.calls == 1
    records = [r for r in caplog.records if r.name == SERVICES_LOGGER]
    assert len(records) == 1, records
    # `logger.exception`, not `logger.error`: without the traceback an operator
    # learns THAT the socket broke and never why.
    assert records[0].exc_info is not None
    # Asserted on `args`, not on the formatted string: these are the structured
    # fields the contract names (services.py already logs this exact set), and
    # binding to arg VALUES rather than to the format keeps the test from
    # breaking over a cosmetic rewording.
    assert RECIPIENT in records[0].args
    assert KIND in records[0].args
    assert DAY in records[0].args
    # «Structured, без ПДн» (architecture.md#L460): the domain payload names the
    # lagging divisions and must not be spilled into the log line.
    assert "div-1" not in records[0].getMessage()


@pytest.mark.django_db
def test_missing_channel_layer_is_non_fatal(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Ловушка №5: an unconfigured ``CHANNEL_LAYERS`` makes ``get_channel_layer()``
    return ``None``, so the failure lands at layer ACQUISITION — ``None.group_send``
    raises ``AttributeError`` before any send is attempted.

    The story judged the blanket ``except Exception`` sufficient here and declined
    a dedicated branch. That is a judgement about the CODE, and this is the test
    that keeps it true: narrowing the except to transport errors later — an
    entirely plausible «let's not swallow real bugs» refactor — reopens exactly
    this hole, and an ``AttributeError`` escaping an ``on_commit`` callback
    surfaces in the caller AFTER the business change was committed.
    """
    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", lambda: None
    )

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    assert row is not None
    assert Notification.objects.filter(
        recipient=RECIPIENT, kind=KIND, business_date=DAY
    ).exists()


# ---------------------------------------------------------------------------
# AC-8/AC-9 — the envelope survives the real layer and matches the read-API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_ws_envelope_matches_read_api_projection():
    """FULL value equality with ``NotificationSerializer``, not just the keys.

    11.4 puts rows from this socket into the same query cache as rows from
    ``GET /api/notifications/``; a divergence in the timestamp format alone would
    break the cache ordering there and the ``?since=`` cursor in 11.3 — and
    comparing key sets would stay green through exactly that. The formats DO
    diverge if uncorrected: ``created_at`` is stored in UTC while DRF renders in
    ``Asia/Qyzylorda``.

    The test imports the serializer on purpose while ``services.py`` must not
    (that direction would invert the layer contract) — the ban binds production
    code; if the test did not import it, nothing would hold the contract at all.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
        return NotificationSerializer(row).data

    projection = await _island(_work)
    envelope = await communicator.receive_json_from(timeout=5)

    assert envelope["payload"] == projection
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_envelope_survives_the_real_channel_layer():
    """msgpack → channel layer → consumer → ``json.dumps`` → the wire, end to end.

    ``channels_redis`` packs the envelope with msgpack, which cannot serialize
    ``date``/``datetime`` (``TypeError: can not serialize 'datetime.date'``), and
    the consumer then runs ``json.dumps`` over it, which fails on the same values.
    Neither stage exists when a test compares dictionaries in memory, so this
    trap is only catchable by driving the real layer — which is what makes the
    ``.isoformat()`` calls in ``_publish`` load-bearing rather than cosmetic.
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    await _island(_work)
    payload = (await communicator.receive_json_from(timeout=5))["payload"]

    assert isinstance(payload["business_date"], str)
    assert isinstance(payload["created_at"], str)
    assert payload["business_date"] == DAY.isoformat()
    assert payload["read_at"] is None
    # Rendered in the project timezone, like the read-API — not bare UTC.
    assert payload["created_at"].endswith("+05:00")
    await communicator.disconnect()
