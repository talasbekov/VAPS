"""Story 11.1 — the WS transport: handshake identity, group derivation, and
delivery from a process that does not serve the socket (FR-35).

No ``django_db`` anywhere on purpose: the consumer never touches the ORM, and
mixing async tests with DB fixtures buys pain for nothing.

Nothing here is skipped when Redis is missing. ``make gate`` brings the service
up itself, and a skip would make the central AC-6 assertion indistinguishable
from a test that does not exist (ретро E9, AI-1).
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import jwt
import pytest
from asgiref.testing import ApplicationCommunicator
from django.test import override_settings
from rest_framework.exceptions import AuthenticationFailed

from apps.core.auth.authentication import verify_jwt_sub
from apps.core.auth.ws import resolve_actor_id
from apps.notifications.groups import group_name_for
from config.asgi import application

BACKEND_DIR = Path(__file__).resolve().parents[3]

# Mirror of test_jwt_authentication's fixture: ≥64 bytes keeps HS256 above
# PyJWT's RFC-7518 minimum.
_SECRET = "test-secret-story-11-1-ws-auth-" + "0" * 40
_OTHER_SECRET = "another-issuer-entirely-story-11-1-" + "9" * 40
_JWT_CFG = {
    "key": _SECRET,
    "algorithms": ["HS256"],
    "audience": None,
    "issuer": None,
    "leeway": 0,
}

# BaseChannelLayer.valid_group_name — the constraint group_name_for exists for.
_CHANNELS_GROUP_RE = re.compile(r"^[a-zA-Z\d\-_.]+$")


def _token(sub="alice", exp_delta=3600):
    payload = {
        "sub": sub,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_delta),
    }
    return jwt.encode(payload, _SECRET, algorithm="HS256")


# (case, token, actor id the token must resolve to — None meaning «rejected»).
# Shared by the WS/REST parity test and its anti-vacuum companion below.
_TOKEN_RULE_CASES = [
    ("valid", _token(), "alice"),
    ("expired", _token(exp_delta=-10), None),
    ("foreign signature", jwt.encode({"sub": "alice"}, _OTHER_SECRET), None),
    ("no sub claim", jwt.encode({"exp": 9999999999}, _SECRET), None),
    ("no exp claim", jwt.encode({"sub": "alice"}, _SECRET), None),
    ("sub with inner whitespace", _token(sub="al ice"), None),
    ("sub over 100 chars", _token(sub="x" * 101), None),
    ("not a jwt at all", "definitely-not-a-token", None),
]


class WsCommunicator(ApplicationCommunicator):
    """Minimal WebSocket driver over ``asgiref.testing.ApplicationCommunicator``.

    Why not ``channels.testing.WebsocketCommunicator``: importing ANY name from
    ``channels.testing`` executes its ``__init__``, which unconditionally pulls
    ``channels.testing.live`` → ``daphne.testing`` (verified against channels
    4.3.2). Installing daphne to satisfy one import line would drag Twisted,
    autobahn, pyOpenSSL and three C-extensions into the offline mirror of the
    контур — a bad trade for a dev-only import, and AC-1 forbids daphne outright
    (решение Bratan, 2026-07-19).

    What is NOT reimplemented: ``receive_output``/``receive_nothing``/``wait``
    come from the asgiref base (asgiref is already a hard channels dependency).
    The only thing channels' own wrapper adds on top is patching
    ``close_old_connections`` to a no-op — meaningless here, since this consumer
    never touches the ORM (AC-7). Scope construction below mirrors the upstream
    class field for field.
    """

    def __init__(self, application, path, headers=None):
        parsed = urlparse(path)
        scope = {
            "type": "websocket",
            "path": unquote(parsed.path),
            "query_string": parsed.query.encode("utf-8"),
            "headers": headers or [],
            "subprotocols": [],
        }
        super().__init__(application, scope)

    async def connect(self, timeout=1):
        """(True, subprotocol) when accepted, (False, close-code) when refused."""
        await self.send_input({"type": "websocket.connect"})
        response = await self.receive_output(timeout)
        if response["type"] == "websocket.close":
            return (False, response.get("code", 1000))
        assert response["type"] == "websocket.accept", response
        return (True, response.get("subprotocol", None))

    async def receive_json_from(self, timeout=1):
        response = await self.receive_output(timeout)
        assert response["type"] == "websocket.send", response
        assert isinstance(response.get("text"), str), response
        return json.loads(response["text"])

    async def disconnect(self, code=1000, timeout=1):
        await self.send_input({"type": "websocket.disconnect", "code": code})
        await self.wait(timeout)


def _communicator(path="/ws/notifications/", user_id=None):
    headers = [(b"x-user-id", user_id.encode())] if user_id else []
    return WsCommunicator(application, path, headers=headers)


# ---------------------------------------------------------------------------
# Handshake identity (AC-3, AC-4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_authenticated_handshake_is_accepted():
    communicator = _communicator(user_id="alice")
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_anonymous_handshake_is_refused_with_4403():
    # No header, no query param → the handshake itself is refused. "Accept and
    # stay silent" would leave the 11.3 client reconnecting forever.
    communicator = _communicator()
    connected, code = await communicator.connect()
    assert connected is False
    assert code == 4403
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_user_id_query_param_authenticates_when_jwt_is_disabled():
    communicator = _communicator(path="/ws/notifications/?user_id=alice")
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_blank_user_id_is_treated_as_anonymous():
    # A truthy-but-blank actor_id would slip past truthiness gates downstream —
    # mirror of the XUserIdAuthentication hygiene.
    communicator = _communicator(user_id="   ")
    connected, code = await communicator.connect()
    assert connected is False
    assert code == 4403
    await communicator.disconnect()


# ---------------------------------------------------------------------------
# JWT branch — fail-closed mirror of REST (AC-4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_token_authenticates_when_jwt_is_configured():
    with override_settings(VAPS_JWT=_JWT_CFG):
        communicator = _communicator(path=f"/ws/notifications/?token={_token()}")
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_x_user_id_is_ignored_when_jwt_is_configured():
    # The unsigned dev header must not bypass a configured issuer (review D1
    # of settings.build_auth_classes, carried onto WS).
    with override_settings(VAPS_JWT=_JWT_CFG):
        communicator = _communicator(user_id="alice")
        connected, code = await communicator.connect()
        assert connected is False
        assert code == 4403
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_expired_token_is_refused():
    with override_settings(VAPS_JWT=_JWT_CFG):
        path = f"/ws/notifications/?token={_token(exp_delta=-10)}"
        communicator = _communicator(path=path)
        connected, code = await communicator.connect()
        assert connected is False
        assert code == 4403
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_user_id_query_param_is_ignored_when_jwt_is_configured():
    # The header variant is covered above; the query param is the OTHER unsigned
    # dev channel, and «fail-closed» has to hold for both or it holds for neither.
    with override_settings(VAPS_JWT=_JWT_CFG):
        communicator = _communicator(path="/ws/notifications/?user_id=alice")
        connected, code = await communicator.connect()
        assert connected is False
        assert code == 4403
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_token_signed_by_another_issuer_is_refused():
    # A well-formed, unexpired token with a valid `sub` — only the signature is
    # foreign. Nothing but signature verification can reject this one.
    payload = {
        "sub": "alice",
        "exp": datetime.now(timezone.utc) + timedelta(seconds=3600),
    }
    forged = jwt.encode(payload, _OTHER_SECRET, algorithm="HS256")
    with override_settings(VAPS_JWT=_JWT_CFG):
        communicator = _communicator(path=f"/ws/notifications/?token={forged}")
        connected, code = await communicator.connect()
        assert connected is False
        assert code == 4403
        await communicator.disconnect()


@pytest.mark.parametrize("case,token,expected", _TOKEN_RULE_CASES)
def test_ws_identity_enforces_the_same_token_rules_as_rest(case, token, expected):
    """The WS handshake and the REST chain must accept/reject the SAME tokens.

    Task 3 extracted ``verify_jwt_sub`` precisely so the two auth paths cannot
    drift; this pins that they have not. Expectations are written out literally
    rather than derived from ``verify_jwt_sub`` — deriving them would make the
    test agree with whatever the code does, including the wrong thing.
    """
    with override_settings(VAPS_JWT=_JWT_CFG):
        scope = {
            "type": "websocket",
            "path": "/ws/notifications/",
            "query_string": f"token={token}".encode(),
            "headers": [],
        }
        assert resolve_actor_id(scope) == expected, case

    try:
        rest = verify_jwt_sub(token, _JWT_CFG)
    except AuthenticationFailed:
        rest = None
    assert rest == expected, f"REST disagrees with WS on: {case}"


def test_token_rule_parity_sample_covers_both_outcomes():
    # Anti-vacuum for the parametrised test above: a sample that happened to be
    # all-rejects would pass against a resolver that returns None unconditionally.
    outcomes = {expected for _, _, expected in _TOKEN_RULE_CASES}
    assert outcomes == {"alice", None}, outcomes


# ---------------------------------------------------------------------------
# Group naming (AC-5)
# ---------------------------------------------------------------------------


def test_group_name_is_deterministic():
    assert group_name_for("alice") == group_name_for("alice")


@pytest.mark.parametrize(
    "recipient",
    [
        "alice",
        "op-1@example.com",
        "urn:actor:42",
        "Иванов.И.И",
        " padded ",
        "x" * 100,
    ],
)
def test_group_name_is_valid_for_hostile_ids(recipient):
    name = group_name_for(recipient)
    assert _CHANNELS_GROUP_RE.match(name), name
    assert len(name) <= 100


def test_group_names_differ_for_different_recipients():
    assert group_name_for("alice") != group_name_for("bob")


def test_group_name_rejects_blank_recipient():
    with pytest.raises(ValueError):
        group_name_for("   ")


def test_group_name_ignores_surrounding_whitespace():
    # Both identity paths already strip (verify_jwt_sub, resolve_actor_id), so
    # this is defence in depth — but it IS part of the contract 11.2 has to match:
    # if notify() addressed " alice " and the socket subscribed as "alice", the
    # mismatch would surface as silently undelivered notifications, not an error.
    assert group_name_for(" alice ") == group_name_for("alice")


# ---------------------------------------------------------------------------
# AC-6 — delivery from a process that does not serve the socket
# ---------------------------------------------------------------------------

# The message travels as a JSON *string literal* parsed inside the subprocess,
# not as interpolated Python source: JSON's `false`/`true`/`null` are not Python
# names, so splicing json.dumps() output straight into the script raises
# NameError on any payload carrying a boolean or a null (found by
# test_ws_e2e::test_payload_crosses_the_transport_verbatim). It also mirrors
# 11.2 more closely — there the envelope likewise arrives already decoded.
_SENDER_SCRIPT = """
import json
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.notifications.groups import NOTIFY_MESSAGE_TYPE, group_name_for

async_to_sync(get_channel_layer().group_send)(
    group_name_for({recipient!r}),
    {{"type": NOTIFY_MESSAGE_TYPE, "message": json.loads({message!r})}},
)
"""


def _send_from_another_process(recipient, message):
    """``group_send`` from a separate OS process with its own ``django.setup()``
    and NO ASGI application loaded — the literal meaning of the epic's «group_send
    из Celery worker» (Celery itself is forbidden, epics.md#L759 / Решение №2).

    A same-process variant would only prove the Redis round-trip inside one
    interpreter, which is exactly what an in-memory layer also passes.
    """
    script = _SENDER_SCRIPT.format(recipient=recipient, message=json.dumps(message))
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=60,
    )
    # Without this, "не запустилось" would masquerade as "не пришло".
    assert result.returncode == 0, (
        f"sender subprocess failed ({result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


@pytest.mark.asyncio
async def test_group_send_from_another_process_reaches_the_socket():
    message = {"type": "DAILY_MARK_MISSING", "payload": {"probe": 1}}
    communicator = _communicator(user_id="alice")
    connected, _ = await communicator.connect()
    assert connected is True

    _send_from_another_process("alice", message)

    assert await communicator.receive_json_from(timeout=5) == message
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_group_send_to_another_recipient_does_not_leak():
    # Anti-vacuum: receive_nothing() is also green on a dead socket, so the same
    # test proves the socket is alive by receiving its OWN message afterwards.
    own = {"type": "DAILY_MARK_MISSING", "payload": {"for": "alice"}}
    communicator = _communicator(user_id="alice")
    connected, _ = await communicator.connect()
    assert connected is True

    _send_from_another_process("bob", {"type": "DAILY_MARK_MISSING", "payload": {}})
    assert await communicator.receive_nothing(timeout=1) is True

    _send_from_another_process("alice", own)
    assert await communicator.receive_json_from(timeout=5) == own
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_group_follows_the_token_not_the_client_supplied_identity():
    """AC-4, second Given — the self-scope invariant of 5.7c carried onto WS.

    The handshake below carries a token for `alice` while shouting `bob` through
    every channel a client controls: the `X-User-Id` header, `?user_id=` and a
    made-up `?recipient=`. Delivery has to follow the token and only the token.
    Checking the close code alone would not catch this: the connection is
    legitimately ACCEPTED here (the token is valid) — the question is which group
    it landed in, and only delivery answers that.
    """
    own = {"type": "DAILY_MARK_MISSING", "payload": {"for": "alice"}}
    path = (
        f"/ws/notifications/?token={_token(sub='alice')}"
        "&user_id=bob&recipient=bob"
    )
    with override_settings(VAPS_JWT=_JWT_CFG):
        communicator = _communicator(path=path, user_id="bob")
        connected, _ = await communicator.connect()
        assert connected is True

        # Subscribed to bob's group would mean the socket walked around the
        # read-API's access control entirely.
        _send_from_another_process("bob", {"type": "DAILY_MARK_MISSING", "payload": {}})
        assert await communicator.receive_nothing(timeout=1) is True

        # Anti-vacuum: the socket is alive and IS in alice's group.
        _send_from_another_process("alice", own)
        assert await communicator.receive_json_from(timeout=5) == own
        await communicator.disconnect()


@pytest.mark.asyncio
async def test_inbound_frames_are_ignored_and_the_socket_survives_them():
    # The 11.3 client only listens, so `receive` is a deliberate no-op. An
    # unhandled frame would raise inside the consumer and tear the socket down —
    # proven not to happen by delivering through it afterwards.
    own = {"type": "DAILY_MARK_MISSING", "payload": {"after": "garbage"}}
    communicator = _communicator(user_id="alice")
    connected, _ = await communicator.connect()
    assert connected is True

    await communicator.send_input({"type": "websocket.receive", "text": "not json{{"})
    await communicator.send_input({"type": "websocket.receive", "bytes": b"\x00\x01"})
    assert await communicator.receive_nothing(timeout=1) is True

    _send_from_another_process("alice", own)
    assert await communicator.receive_json_from(timeout=5) == own
    await communicator.disconnect()
