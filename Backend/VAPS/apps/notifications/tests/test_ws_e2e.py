"""Story 11.1 — end-to-end coverage of the WS transport (QA pass).

``test_ws_consumer.py`` covers handshake identity, group naming and delivery;
``test_ws_guards.py`` covers the architectural invariants. This module drives the
paths those two only approximate:

* **The HTTP branch of the same entrypoint.** Mounting ``ProtocolTypeRouter``
  moved every REST request onto ``config.asgi.application``, and until now
  nothing sent one through it — the existing check only reads the router's dict
  keys, which stays green while the HTTP branch is mapped to something broken.
* **Hostile actor ids against the REAL channel layer.** The group-name test
  matches a regex *copied* from Channels; only an actual ``group_add`` proves the
  name is one Channels accepts.
* **Several sockets for one actor.** Two tabs, or a reconnect overlapping its
  predecessor — the 11.3 client's normal life, and unproven so far.
* **The routed path**, which is the literal string 11.3 will be written against.

The communicator harness is imported from ``test_ws_consumer`` rather than
copied: two drifting copies of «how to drive a socket» is the same failure mode
``group_name_for`` exists to prevent.

Nothing here is skipped when Redis is down — same reasoning as the sibling
modules (ретро E9, AI-1), and ``test_ws_guards`` enforces it for this file too.
"""

import json

import pytest
from asgiref.testing import ApplicationCommunicator

from apps.notifications.tests.test_ws_consumer import (
    WsCommunicator,
    _communicator,
    _send_from_another_process,
)
from config.asgi import application

WS_PATH = "/ws/notifications/"


# ---------------------------------------------------------------------------
# The HTTP half of the ASGI entrypoint (AC-3, AC-10)
# ---------------------------------------------------------------------------


async def _http_get(path, headers=None, timeout=10):
    """One HTTP request through ``config.asgi.application`` → ``(status, body)``."""
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "scheme": "http",
        "root_path": "",
    }
    communicator = ApplicationCommunicator(application, scope)
    await communicator.send_input(
        {"type": "http.request", "body": b"", "more_body": False}
    )
    start = await communicator.receive_output(timeout)
    assert start["type"] == "http.response.start", start
    body = b""
    while True:
        chunk = await communicator.receive_output(timeout)
        assert chunk["type"] == "http.response.body", chunk
        body += chunk.get("body", b"")
        if not chunk.get("more_body"):
            break
    await communicator.wait(timeout)
    return start["status"], body


@pytest.mark.asyncio
async def test_rest_api_still_answers_through_the_asgi_entrypoint():
    """The REST surface did not fall off the deployment when WS was mounted.

    Swapping the entrypoint for a ``ProtocolTypeRouter`` is exactly where a
    project loses its HTTP stack quietly: every unit test keeps using the test
    client (which never touches ``config.asgi``), so the outage only shows up in
    production. One anonymous request proves the whole chain still runs under
    ASGI — URL conf, DRF, the project's exception handler and the MIDDLEWARE
    stack — because each of them has to work to produce this exact envelope.

    Anonymous on purpose: 403 is decided before any queryset, so this stays a
    transport test with no ``django_db`` and no fixtures.
    """
    status, body = await _http_get("/api/notifications/")

    assert status == 403
    envelope = json.loads(body)
    # The project's DomainError envelope, not DRF's default {"detail": ...} —
    # i.e. the custom exception handler ran, not just «some view answered».
    assert envelope["error_code"] == "PERMISSION_DENIED"
    # MIDDLEWARE ran on this branch: request_id is stamped by
    # RequestContextMiddleware, and it is empty outside a request. This is the
    # HTTP half of the asymmetry config/asgi.py documents — the WS branch has no
    # MIDDLEWARE and therefore no request_id.
    assert envelope["request_id"], envelope


@pytest.mark.asyncio
async def test_unknown_http_route_is_answered_by_django_not_by_the_router():
    # Anti-vacuum companion to the test above: 403 alone could in principle come
    # from something wrapping the whole app. A 404 rendered by Django's own
    # handler proves the URL conf is what resolves paths on this branch.
    status, _ = await _http_get("/definitely-not-a-route")
    assert status == 404


# ---------------------------------------------------------------------------
# The routed path IS the contract with the 11.3 client (AC-3)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/ws/notifications",  # the #1 client typo: APPEND_SLASH does not exist for WS
        "/ws/notifications/extra/",
        "/ws/",
    ],
)
@pytest.mark.asyncio
async def test_no_socket_is_opened_on_a_path_other_than_the_documented_one(path):
    """A near-miss URL must not yield a working socket.

    Asserted as «nothing was accepted» rather than «ValueError is raised»: the
    invariant is about the socket, and pinning the framework's current way of
    refusing would make this test a Channels-version detector. The positive half
    (``/ws/notifications/`` IS accepted) is asserted throughout the sibling
    module, so an implementation that accepted nothing at all could not hide here.
    """
    communicator = WsCommunicator(
        application, path, headers=[(b"x-user-id", b"alice")]
    )
    await communicator.send_input({"type": "websocket.connect"})
    try:
        output = await communicator.receive_output(2)
    except ValueError:
        return  # URLRouter refused an unrouted path — no socket was opened
    assert output["type"] != "websocket.accept", (
        f"{path} opened a socket; only {WS_PATH} is routed"
    )


# ---------------------------------------------------------------------------
# Identity plumbing traps (AC-4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_header_lookup_is_case_insensitive():
    # ASGI says header names arrive lower-cased, but nothing enforces it and the
    # nginx hop landing in 12.1 sits between the client and this code. A proxy
    # forwarding `X-User-Id` verbatim must not read as anonymous.
    communicator = WsCommunicator(
        application, WS_PATH, headers=[(b"X-User-Id", b"alice")]
    )
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# Hostile actor ids, end to end (AC-5, AC-6)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["op-1@example.com", "Иванов.И.И"])
@pytest.mark.asyncio
async def test_hostile_actor_id_survives_group_add_and_delivery(actor):
    """``group_name_for`` is validated against a regex *copied* from Channels.

    A copy can go stale, and it says nothing about what the Redis layer does with
    the name at runtime — which is the failure the hash exists to prevent
    (``group_add`` blowing up on ``@``/``:``/Cyrillic). Driving a real handshake
    plus a real cross-process delivery for such an id closes that gap: here the
    name is accepted by the layer that actually enforces the rule.
    """
    message = {"type": "DAILY_MARK_MISSING", "payload": {"actor": actor}}
    communicator = _communicator(user_id=actor)
    connected, _ = await communicator.connect()
    assert connected is True

    _send_from_another_process(actor, message)

    assert await communicator.receive_json_from(timeout=5) == message
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# Fan-out and relay fidelity (AC-6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_socket_of_one_actor_receives_the_message():
    """Two tabs — or a reconnect overlapping the socket it replaces (11.3).

    The group is derived from the actor, so both connections share it. Had it
    been derived per-connection (channel name mixed into the hash — an easy
    "fix" for someone chasing uniqueness), exactly one of these two would have
    received the message and the bug would read as flakiness in the UI.
    """
    message = {"type": "DAILY_MARK_MISSING", "payload": {"tabs": 2}}
    first = _communicator(user_id="alice")
    second = _communicator(user_id="alice")
    for communicator in (first, second):
        connected, _ = await communicator.connect()
        assert connected is True

    _send_from_another_process("alice", message)

    assert await first.receive_json_from(timeout=5) == message
    assert await second.receive_json_from(timeout=5) == message
    await first.disconnect()
    await second.disconnect()


@pytest.mark.asyncio
async def test_payload_crosses_the_transport_verbatim():
    """Relaying the envelope unchanged is this consumer's ONLY job.

    Two things are pinned. Non-ASCII: ``json.dumps`` escapes it by default, so
    the bytes on the wire do not look like the input and the round-trip has to be
    shown, not assumed — this product's payloads are Russian and Kazakh text.
    Falsy scalars: ``0``/``False``/``None`` are precisely the values a careless
    "clean up the payload" step drops, and they are meaningful here (an unread
    counter of 0, a cleared timestamp of null) — 11.4 renders them.
    """
    message = {
        "type": "DAILY_MARK_MISSING",
        "payload": {
            "unit": "1-й батальон",
            "note": "смена не сдана — «просрочка»",
            "city": "Қызылорда",
            "count": 0,
            "ratio": 0.5,
            "flagged": False,
            "cleared_at": None,
            "ids": [3, 1, 2],
            "nested": {"deep": {"ok": True}},
        },
    }
    communicator = _communicator(user_id="alice")
    connected, _ = await communicator.connect()
    assert connected is True

    _send_from_another_process("alice", message)

    received = await communicator.receive_json_from(timeout=5)
    assert received == message
    # Equality on dicts ignores list order; the ids arrived in the sent order.
    assert received["payload"]["ids"] == [3, 1, 2]
    await communicator.disconnect()
