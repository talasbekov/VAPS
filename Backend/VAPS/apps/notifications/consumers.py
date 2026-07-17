"""Story 11.1 — minimal smoke WS consumer for notification delivery.

``NotificationConsumer`` is transport-only: on ``connect()`` it joins a
channels_redis group named after the caller's identity (``scope["actor_id"]``,
set by ``apps.notifications.ws_auth.AuthenticatedWSMiddleware`` from the
``?token=`` handshake query-string — see that module's docstring for why
query-string, not a header). The group name (``f"user_{actor_id}"``) is a
DELIBERATE convention: ``actor_id`` is the same string as
``Notification.recipient``/``User.username`` (ARCH-007), so Story 11.2 can
call ``channel_layer.group_send(f"user_{recipient}", ...)`` directly from
``notify()`` without any additional identity mapping.

No business-notification publishing logic lives here (Story 11.2) — this
consumer only proves the transport: whatever JSON-able message arrives via
``notify.message`` group-sends is forwarded to the client verbatim as JSON.

No ORM access in this consumer (AC 4): the smoke consumer reads nothing from
the database — group membership is keyed purely off the handshake-time
``actor_id`` string, no ``User``/``Notification`` row lookup happens. If a
future story (11.2+) adds ORM access here (e.g. an idempotent connection-
registration row), it MUST go through ``channels.db.database_sync_to_async``
— Channels consumers run in an async context and synchronous Django ORM
calls are not awaitable/thread-safe there without it.
"""

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        actor_id = self.scope.get("actor_id")
        if not actor_id:
            # No identity extracted from the handshake (Task 4) → reject the
            # connection outright rather than accept into an anonymous group.
            await self.close(code=4401)
            return
        self.group_name = f"user_{actor_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        group_name = getattr(self, "group_name", None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def notify_message(self, event):
        """Handler for group_send({"type": "notify.message", "payload": ...}) —
        Channels dispatches "notify.message" to a method named with dots
        replaced by underscores, per its routing convention. Forwards the
        payload to the client verbatim as JSON (smoke path — no business
        shaping here, that's 11.2)."""
        await self.send_json(event["payload"])
