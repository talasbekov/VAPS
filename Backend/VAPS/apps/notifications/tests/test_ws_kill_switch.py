"""Story 11.5 — the WS kill-switch (``VAPS_WS_ENABLED``), end to end.

The whole story is tested here and nowhere else: the two 500-line neighbours
(``test_ws_consumer.py``, ``test_ws_notify.py``) stay untouched, which keeps the
diff readable and means the flag could be deleted one file at a time.

The module name is load-bearing: ``test_ws_guards.test_ws_tests_are_never_skipped``
globs ``test_ws_*.py``, so a file called ``test_kill_switch.py`` would fall out
from under that guard silently. Nothing here skips, ever.

EVERY assertion is a discriminating PAIR (flag on / flag off). «Nothing was sent
while disabled» is green on its own against code that never sends at all — the
enabled half is what makes the disabled half mean something.

⚠️ TWO SUBSTITUTION MECHANISMS LIVE HERE AND THEY ARE NOT INTERCHANGEABLE:

* ``_publish`` takes the layer through the name ``services`` bound at import
  time, so its tests patch ``apps.notifications.services.get_channel_layer``
  (patching ``channels.layers`` would leave the service on the real layer —
  see ``test_ws_notify._explode``);
* the consumer does NOT go through ``services``: ``channels.consumer`` assigns
  ``self.channel_layer = get_channel_layer(self.channel_layer_alias)`` itself.
  Patching the name in ``services`` never reaches it, and «group_add was not
  called» would then be green under EVERY value of the flag. The consumer test
  therefore spies on the method of the cached singleton instead.

Fakes are real ``async def`` coroutines, never ``Mock``/``lambda``:
``async_to_sync`` type-checks its argument and raises ``TypeError`` BEFORE
calling, which would turn «the layer was never reached» into «the test never got
that far» (``test_ws_notify.py:98-100``).
"""

from datetime import date, timedelta

import pytest
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.notifications.consumers import CLOSE_UNAUTHENTICATED, CLOSE_WS_DISABLED
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.notifications.tests.test_ws_consumer import _communicator
from apps.notifications.tests.test_ws_notify import _island

# ASCII only — a non-latin X-User-Id is rejected before it ever reaches the
# network (finding of the 11.3 dev pass). Cyrillic belongs in fixture bodies.
RECIPIENT = "alice"
KIND = Notification.Kind.SUBMISSION_LAGGING
DAY = date(2026, 6, 5)
PAYLOAD = {"комментарий": "подразделения не сдали"}


class _RecordingChannelLayer:
    """Counts ``group_send`` calls; proves «not sent» instead of «swallowed».

    ``_publish`` already swallows everything (``services.py:124-134``), so a
    kill-switch can NEVER be proven by the absence of a crash — only by the
    absence of a call. A real coroutine, for the ``async_to_sync`` reason above.
    """

    def __init__(self):
        self.sends = []

    async def group_send(self, group, message):
        self.sends.append((group, message))


class _CountingAcquisition:
    """A ``get_channel_layer`` stand-in that records and then blows up.

    AC-4 is «the layer is not acquired AT ALL», one step stricter than «nothing
    was sent»: the guard has to sit before ``get_channel_layer()``, not after it
    inside the ``try``. The raise is what makes the enabled half a control — it
    is swallowed by ``_publish``'s own ``except``, so ``calls`` is the evidence.
    """

    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1
        raise RuntimeError("kill-switch must not acquire the channel layer")


# ---------------------------------------------------------------------------
# AC-1 — the flag itself. No override_settings here, on purpose.
# ---------------------------------------------------------------------------


def test_the_flag_defaults_to_enabled_and_is_a_real_bool():
    """AC-1: the default IS the state of the whole WS suite, so pin it directly.

    ``make gate`` (``Makefile:95-101``) exports ``VAPS_DB*`` and
    ``VAPS_REDIS_URL`` and deliberately NOT ``VAPS_WS_ENABLED`` — which makes the
    default in ``config/settings.py`` the single thing deciding whether every WS
    test runs against a live socket. A default of ``"0"`` does not «whiten» that
    suite, it turns it red somewhere else entirely (a socket closed right after
    accept emits ``websocket.close`` where the delivery tests await
    ``websocket.send``). Until now that was only caught INDIRECTLY, as a pile of
    failures in two other modules; this asserts the cause where the cause lives,
    so the next reader gets one honest line instead of a forensic exercise.

    ``is True`` rather than a truthiness check, and that is the second half of the
    test: dropping the ``== "1"`` comparison leaves the setting holding the STRING
    ``"1"``, which is truthy — and would then also be truthy for ``"0"``, i.e. the
    kill-switch would silently stop switching anything off. Only identity to
    ``True`` catches that.

    (If this goes red with everything else, check the environment: someone
    exported ``VAPS_WS_ENABLED=0`` into the gate. That is the diagnosis this test
    exists to hand over.)
    """
    assert settings.VAPS_WS_ENABLED is True


# ---------------------------------------------------------------------------
# AC-2/AC-3 — the consumer. No django_db: the consumer never touches the ORM.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ws_disabled_accepts_then_closes_with_the_disabled_code():
    """accept() FIRST, then close(4503) — the order is the whole story (AC-2).

    ``close`` BEFORE ``accept`` makes the server answer HTTP 403: the handshake
    never completes and the browser sees ``CloseEvent{code: 1006}``, i.e. the
    private code never reaches the wire (proven in 11.3 Решение №4). The client
    could not tell a kill-switch from a dead network and would back off forever
    — the exact opposite of the epic's «silent switch to polling».

    ``WsCommunicator.connect()`` returns on the FIRST output message, so it
    reports (True, None) here and the close frame is the NEXT one.
    """
    with override_settings(VAPS_WS_ENABLED=False):
        communicator = _communicator(user_id=RECIPIENT)
        connected, _ = await communicator.connect()
        assert connected is True, "kill-switch must accept before closing"
        assert await communicator.receive_output() == {
            "type": "websocket.close",
            "code": CLOSE_WS_DISABLED,
        }
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_ws_enabled_still_accepts_and_stays_open():
    """The enabled half of the pair above.

    ⚠️ This asserts the ABSENCE OF A CLOSE FRAME, not ``connected is True``:
    after accept-then-close ``connect()`` returns (True, None) under BOTH values
    of the flag, so the bare form used elsewhere in the suite
    (``test_ws_consumer.py:133``) stopped discriminating anything here.
    """
    with override_settings(VAPS_WS_ENABLED=True):
        communicator = _communicator(user_id=RECIPIENT)
        connected, _ = await communicator.connect()
        assert connected is True
        assert await communicator.receive_nothing() is True, (
            "an enabled socket must stay open — no close frame"
        )
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_ws_disabled_never_joins_a_group(monkeypatch):
    """AC-2: the disabled branch returns BEFORE ``group_add``.

    ⚠️ «The kill-switch does not touch Redis» is FALSE at this level and is
    deliberately not asserted: ``channels/consumer.py:44-49`` calls
    ``new_channel()`` on the layer before ``connect()`` runs, unconditionally.
    The flag only skips joining the group. «Redis is not touched» holds for
    ``_publish`` alone (AC-4).
    """
    layer = get_channel_layer()
    real_group_add = layer.group_add
    joins = []

    async def _spy(group, channel):
        joins.append((group, channel))
        return await real_group_add(group, channel)

    monkeypatch.setattr(layer, "group_add", _spy)

    with override_settings(VAPS_WS_ENABLED=False):
        disabled = _communicator(user_id=RECIPIENT)
        await disabled.connect()
        await disabled.disconnect()
    assert joins == [], "a disabled socket must not join any group"

    with override_settings(VAPS_WS_ENABLED=True):
        enabled = _communicator(user_id=RECIPIENT)
        await enabled.connect()
        await enabled.disconnect()
    assert len(joins) == 1, "an enabled socket must still join exactly one group"


@pytest.mark.asyncio
async def test_disabled_socket_disconnects_without_discarding_a_group(monkeypatch):
    """AC-7 / Ловушка 12: ``disconnect()`` survives a connection that never joined.

    ``disconnect()`` reads ``getattr(self, "group", None)`` precisely because a
    REFUSED handshake never reached ``group_add`` — and the kill-switch has just
    added a second branch of that kind. The story says «check it, do not fix it»,
    but nothing checked it: every existing test calls ``disconnect()`` and would
    fail only if the ``AttributeError`` happened to surface through
    ``communicator.wait()``. Rewriting that getattr as a bare ``self.group``
    (the obvious tidy-up once someone notices the branch always sets it — except
    on the two refusal paths) is the mutation this test exists against, and it
    would break the anonymous path too.

    Discriminating pair, like everything else here: zero discards while off,
    exactly one while on. «No discard» alone is green against a consumer that
    never discards at all, which would leak a group membership per socket.
    """
    layer = get_channel_layer()
    real_group_discard = layer.group_discard
    discards = []

    async def _spy(group, channel):
        discards.append((group, channel))
        return await real_group_discard(group, channel)

    monkeypatch.setattr(layer, "group_discard", _spy)

    with override_settings(VAPS_WS_ENABLED=False):
        disabled = _communicator(user_id=RECIPIENT)
        await disabled.connect()
        # No assertion needed beyond «this returns»: an AttributeError raised in
        # disconnect() propagates out of ApplicationCommunicator.wait().
        await disabled.disconnect()
    assert discards == [], "a socket that never joined must not discard a group"

    with override_settings(VAPS_WS_ENABLED=True):
        enabled = _communicator(user_id=RECIPIENT)
        await enabled.connect()
        await enabled.disconnect()
    assert len(discards) == 1, "an enabled socket must still leave its group"


@pytest.mark.asyncio
async def test_anonymous_is_still_refused_before_accept_when_ws_disabled():
    """AC-3: identity is checked FIRST, the flag SECOND — pinned on purpose.

    The naive implementation puts the cheap flag check first; this test exists
    against precisely that. An unauthenticated socket is never accepted, flag or
    no flag — otherwise the kill-switch would become a hole in access control
    and the six 4403 tests of 11.1 would be «fixed» into a silent repeal of its
    AC-4.
    """
    with override_settings(VAPS_WS_ENABLED=False):
        communicator = _communicator()
        connected, code = await communicator.connect()
        assert (connected, code) == (False, CLOSE_UNAUTHENTICATED)
        await communicator.disconnect()

    with override_settings(VAPS_WS_ENABLED=True):
        communicator = _communicator()
        connected, code = await communicator.connect()
        assert (connected, code) == (False, CLOSE_UNAUTHENTICATED)
        await communicator.disconnect()


# ---------------------------------------------------------------------------
# AC-4/AC-5 — notify()/_publish. Synchronous, django_db, on_commit executed.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_disabled_flag_writes_the_row_and_publishes_nothing(
    monkeypatch, django_capture_on_commit_callbacks
):
    """AC-4 + AC-5 as one discriminating pair: the row always, the signal never.

    The two halves use different ``business_date`` values because the
    one-per-day key is ``(recipient, kind, business_date)`` — a repeat call on
    the same day is a no-op by design and would publish nothing for a reason
    that has nothing to do with the flag.
    """
    layer = _RecordingChannelLayer()
    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", lambda: layer
    )

    with override_settings(VAPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                off_row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
    assert off_row is not None
    assert Notification.objects.filter(pk=off_row.pk).exists()
    assert layer.sends == [], "a disabled kill-switch must publish nothing"

    with override_settings(VAPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                on_row = notify(
                    RECIPIENT, KIND, DAY + timedelta(days=1), payload=PAYLOAD
                )
    assert on_row is not None
    assert len(layer.sends) == 1, "an enabled flag must still publish exactly once"


@pytest.mark.django_db
def test_disabled_flag_does_not_acquire_the_channel_layer(
    monkeypatch, django_capture_on_commit_callbacks
):
    """AC-4: the guard sits BEFORE ``get_channel_layer()``, not inside the try.

    The point of a kill-switch is to not touch the risky infrastructure at all,
    not to swallow its failure neatly — the swallowing already exists
    (``services.py:124-134``), which is why «it did not crash» proves nothing
    (Ловушка 10).
    """
    acquisition = _CountingAcquisition()
    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", acquisition
    )

    with override_settings(VAPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
    assert acquisition.calls == 0, "a disabled kill-switch must not reach Redis"

    # Control: with the flag on, the very same stand-in IS reached (and its
    # RuntimeError is swallowed by _publish, as the best-effort contract says).
    with override_settings(VAPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify(RECIPIENT, KIND, DAY + timedelta(days=1), payload=PAYLOAD)
    assert acquisition.calls == 1, "anti-vacuum: the enabled path must acquire it"


@pytest.mark.django_db
def test_notify_still_returns_the_row_when_ws_is_disabled(
    django_capture_on_commit_callbacks,
):
    """AC-5: switching off the SIGNAL must not stop a BUSINESS operation.

    ``lagging_check._emit_lagging`` reads a ``None`` return as «the notice did
    not persist» → ``LaggingNotifyError`` → the catch-up halts and holds its
    watermark (``services.py:75-80``). A flag that dropped ``notify()`` to
    ``None`` would turn «no websocket today» into «no catch-up today».
    """
    with override_settings(VAPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                off_row = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    with override_settings(VAPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                on_row = notify(
                    RECIPIENT, KIND, DAY + timedelta(days=1), payload=PAYLOAD
                )

    assert off_row is not None, "notify() must return the row with WS disabled"
    assert on_row is not None
    assert off_row.recipient == on_row.recipient == RECIPIENT


# ---------------------------------------------------------------------------
# End to end, over the REAL channel layer — «выключили посреди дня»
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.django_db
async def test_a_live_socket_goes_silent_while_the_flag_is_off():
    """The epic's rollback test on the back end, with nothing faked in between.

    Every other test in this module substitutes something: the ``_publish`` pair
    swaps ``get_channel_layer`` for a recorder, the consumer pair spies on a
    method. Both halves are therefore proven only against a stand-in — and the
    thing the flag actually has to silence is the full chain ``notify()`` →
    ``on_commit`` → real ``group_send`` → channels_redis → consumer → the wire.
    This drives that chain, and only that chain (harness borrowed from
    ``test_ws_notify``, never copied — same rule as ``_communicator``).

    It also pins the operational semantics behind Решение №1, which are NOT
    obvious and are exactly what an administrator will assume wrongly: the flag
    is read at PUBLISH time, not at handshake time, so flipping it does not kill
    the sockets that are already open — they simply stop receiving. That is why
    the documented procedure is «change the env, restart the container» (the
    restart is what tears the sockets down and sends the clients into a refused
    reconnect), and why the client half (11.5a) cannot rely on a close frame that
    a mid-day flip never sends.

    ORDER is the discriminating assertion. Both notifications are emitted before
    anything is read off the socket, so the ONE that arrives proves the other did
    not merely arrive late — a `receive_nothing` timeout on its own could never
    tell «suppressed» from «slow».
    """
    communicator = _communicator(user_id=RECIPIENT)
    assert (await communicator.connect())[0] is True

    def _silenced():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)

    def _delivered():
        with transaction.atomic():
            notify(RECIPIENT, KIND, DAY + timedelta(days=1), payload=PAYLOAD)

    # The island commits for real, so on_commit really fires (under plain
    # django_db the callback never runs and this test would be vacuum).
    with override_settings(VAPS_WS_ENABLED=False):
        await _island(_silenced)
    with override_settings(VAPS_WS_ENABLED=True):
        await _island(_delivered)

    envelope = await communicator.receive_json_from(timeout=5)
    delivered_day = (DAY + timedelta(days=1)).isoformat()
    assert envelope["payload"]["business_date"] == delivered_day, (
        "the FIRST frame on the wire must be the one published with WS enabled — "
        "the row written while the switch was off never reached the layer"
    )
    assert await communicator.receive_nothing(timeout=1) is True
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# AC-6 — the read-API is the fallback, and the flag does not reach it.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_read_api_is_unaffected_by_the_flag():
    """AC-6: “выключили посреди дня → консистентное читаемое состояние”.

    The back half of the epic's rollback test: with WS off, REST answers byte
    for byte what it answered with WS on — same rows, same ``(-created_at, id)``
    order, same pagination envelope. The client half (actually switching to
    polling) is 11.5a.
    """
    for offset in range(3):
        Notification.objects.create(
            recipient=RECIPIENT,
            kind=KIND,
            business_date=DAY + timedelta(days=offset),
            payload={"комментарий": f"день {offset}"},
        )
    client = APIClient()
    client.credentials(HTTP_X_USER_ID=RECIPIENT)

    with override_settings(VAPS_WS_ENABLED=False):
        disabled = client.get(_list_url())
    with override_settings(VAPS_WS_ENABLED=True):
        enabled = client.get(_list_url())

    assert disabled.status_code == 200
    assert enabled.status_code == 200
    assert disabled.json() == enabled.json()
    # Anti-vacuum: two empty bodies would compare equal just as happily.
    assert disabled.json()["count"] == 3


@pytest.mark.django_db
def test_a_notification_emitted_with_ws_off_is_served_by_the_read_api(
    monkeypatch, django_capture_on_commit_callbacks
):
    """AC-6 end to end: «уведомления продолжают приходить» through the fallback.

    The test above plants its rows with ``Notification.objects.create`` and so
    compares two REST responses to each other — it proves the flag does not reach
    the VIEW, but it never once runs the writer. The epic AC is a chain, not a
    view: ``notify()`` emits with the switch off, and the operator still sees the
    notification because REST serves it. That chain (emit → persist → HTTP) had
    no test, and it is the whole reason polling is an acceptable fallback (11.5a);
    if a disabled flag ever short-circuited the write, THIS is the assertion that
    fails, and it fails on the user-visible surface rather than three layers down.

    Pair: one row emitted with WS off, one with WS on, both read back in one
    response. The recorder confirms in passing that only the enabled one went to
    the layer — so a green here can never mean «the flag did nothing».
    """
    layer = _RecordingChannelLayer()
    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", lambda: layer
    )

    with override_settings(VAPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                silenced = notify(RECIPIENT, KIND, DAY, payload=PAYLOAD)
    with override_settings(VAPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify(RECIPIENT, KIND, DAY + timedelta(days=1), payload=PAYLOAD)

    client = APIClient()
    client.credentials(HTTP_X_USER_ID=RECIPIENT)
    with override_settings(VAPS_WS_ENABLED=False):
        response = client.get(_list_url())

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2, "both rows are readable, whatever the flag was"
    ids = [row["id"] for row in body["results"]]
    assert silenced.id in ids, (
        "the notification emitted while WS was off must still reach the operator "
        "over REST — that fallback is what makes the kill-switch survivable"
    )
    served = next(row for row in body["results"] if row["id"] == silenced.id)
    assert served["kind"] == KIND
    assert served["business_date"] == DAY.isoformat()
    assert served["payload"] == PAYLOAD
    # In passing: the flag really was off for the first emit.
    assert len(layer.sends) == 1


def _list_url():
    return reverse("notification-list")
