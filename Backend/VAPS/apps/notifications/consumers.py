"""Story 11.1 — the WebSocket consumer behind ``/ws/notifications/`` (FR-35).

A thin transport, nothing else (layer contract, architecture.md#L444-454): no
business logic, no ``transaction.atomic``, no service calls, no ORM. Writing
notifications stays exclusively with ``notifications.services.notify()``
(boundary «notifications ← все», architecture.md#L592), and marking one read is
an HTTP mutation belonging to 11.4 — not something to bolt onto the socket.

TWO DIFFERENT «type» FIELDS LIVE HERE — the classic Channels bug, and 11.2 has
to get it right:

* ``type`` of the **channel-layer** envelope is ``"notify.message"`` — exported
  as ``groups.NOTIFY_MESSAGE_TYPE``; 11.2 imports it, never retypes it. It is
  pure routing: Channels turns the dots into underscores and dispatches to
  ``notify_message`` below. It never reaches the client.
* ``type`` of the **WebSocket** envelope is the UPPER_SNAKE code from
  ``docs/registries/ws-message-types.yaml`` and travels INSIDE
  ``event["message"]`` as ``{"type": ..., "payload": ...}``
  (architecture.md#L459).

Confusing the two yields either ``No handler for message type`` on the server or
a client envelope with the registry code silently lost in transport. This
consumer is deliberately type-agnostic: it relays ``event["message"]`` verbatim,
so the open question about the registry (``SUBMISSION_LAGGING`` vs
``DAILY_MARK_MISSING``) blocks 11.2, not this transport.
"""

import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings

from apps.notifications.groups import group_name_for

logger = logging.getLogger(__name__)

# Private-range close code mirroring the REST contract «аноним → 403
# PERMISSION_DENIED» (5.7c AC-3). Accepting-then-staying-silent was rejected: the
# 11.3 client could not tell "not allowed" from "no events yet" and would
# reconnect into the void forever.
CLOSE_UNAUTHENTICATED = 4403

# Story 11.5 — kill-switch (settings.VAPS_WS_ENABLED). Same private range, same
# convention as 4403 above: the code mirrors its HTTP status, here 503 «service
# unavailable» — the socket is off by an administrator's decision, not broken.
#
# ⚠️ THIS ONE IS SENT AFTER accept(), UNLIKE THE 4403 BRANCH BELOW, and the
# asymmetry is deliberate — 11.3's Открытый вопрос №1 named this very spot.
# ASGI says a `websocket.close` sent BEFORE `websocket.accept` makes the server
# answer HTTP 403: the handshake never completes, so the browser gets
# CloseEvent{code: 1006, wasClean: false} and the private code never reaches the
# wire at all (proven in 11.3 Решение №4; only the Python tests, which read ASGI
# messages directly, ever see 4403). A client could not tell that from a dead
# network — it would back off forever while notifications kept arriving over
# REST. The epic's «silent switch to polling» is unreachable without accepting
# first: after accept() the connection exists and the close frame carries its
# code honestly, as CloseEvent{code: 4503, wasClean: true}.
# Converting the 4403 branch to the same shape is NOT done here — accepting a
# socket from an unauthenticated peer is a security-level behaviour change,
# pinned by six tests of 11.1, and needs its own story (11.5 Решение №4).
CLOSE_WS_DISABLED = 4503


class NotificationConsumer(AsyncWebsocketConsumer):
    """Relays notifications addressed to the connection's own actor.

    The group is derived EXCLUSIVELY from the server-resolved
    ``scope["actor_id"]`` (set by ``apps.core.auth.ws.ActorIdMiddleware``). No
    client-supplied ``user_id``/``recipient`` influences it — that is the 5.7c
    self-scope invariant carried onto WS: a socket that could subscribe to
    someone else's group would walk straight around the read-API's access
    control.
    """

    async def connect(self):
        actor = self.scope.get("actor_id")
        if not actor:
            # Refuse the handshake itself — no accept() first.
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        # Identity FIRST, flag SECOND — never the other way round. The cheap
        # check looks like it belongs on top, but putting it there would accept
        # unauthenticated peers whenever WS is off, i.e. turn the kill-switch
        # into a hole in access control (pinned by
        # test_anonymous_is_still_refused_before_accept_when_ws_disabled).
        # Read through `settings.` at call time, never copied into a module
        # constant: override_settings patches the settings object, and a copy
        # taken at import would make every disabled-state test vacuous.
        if not settings.VAPS_WS_ENABLED:
            await self.accept()
            await self.close(code=CLOSE_WS_DISABLED)
            return
        self.group = group_name_for(actor)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        # A refused connection never got a group — getattr, not self.group, or
        # this raises AttributeError on every rejected handshake.
        group = getattr(self, "group", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # The 11.3 client only listens; liveness is protocol-level ping/pong plus
        # the nginx read-timeout in 12.1. Inbound frames are ignored rather than
        # parsed — an unused parser is an attack surface.
        return

    async def notify_message(self, event):
        # `event["message"]` IS the client envelope; relayed as-is (see module
        # docstring on the two «type» fields).
        await self.send(text_data=json.dumps(event["message"]))
