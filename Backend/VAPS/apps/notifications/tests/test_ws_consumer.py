"""Story 11.1 — Channels/channels_redis WS transport smoke tests.

Proves the AC set: a ``WebsocketCommunicator`` can connect to
``/ws/notifications/`` with an identity (query-string ``token``, mirroring the
dev ``X-User-Id`` header — see Dev Notes/consumers.py for the handshake
mechanism), the consumer joins a group named after that identity
(``recipient``/``username`` — same string as ``Notification.recipient``,
ARCH-007), and a ``group_send`` issued from an INDEPENDENT context (its own
``get_channel_layer()`` call, no shared asyncio task with the connect — the
worker-process simulation the AC calls for) reaches the connected consumer
through the REAL ``channels_redis`` backend (not ``InMemoryChannelLayer`` —
epics.md AC: "InMemoryChannelLayer в конфиге = fail CI"). Requires the
``redis`` docker-compose service (see Backend/VAPS/docker-compose.yml) to be
up; `make gate` brings it up alongside `db`.

No business-notification logic here (that's 11.2) — only the generic
transport smoke path.
"""

import pytest
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator

from config.asgi import application

pytestmark = pytest.mark.django_db


async def test_connect_accepts_and_joins_group_by_identity():
    communicator = WebsocketCommunicator(application, "/ws/notifications/?token=alice")
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


async def test_connect_without_identity_is_rejected():
    communicator = WebsocketCommunicator(application, "/ws/notifications/")
    connected, _close_code = await communicator.connect()
    assert connected is False


async def test_group_send_from_independent_context_reaches_connected_consumer():
    # "Independent context" per AC 2: a fresh get_channel_layer() call, not the
    # WebsocketCommunicator's own scope/consumer — this is the closest a single
    # test process gets to "another process (Celery worker) publishing" without
    # actually spawning one; only a real Redis (channels_redis) can carry the
    # message across that boundary. InMemoryChannelLayer would silently drop it.
    communicator = WebsocketCommunicator(application, "/ws/notifications/?token=bob")
    connected, _ = await communicator.connect()
    assert connected is True

    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        "user_bob",
        {"type": "notify.message", "payload": {"hello": "world"}},
    )

    message = await communicator.receive_json_from(timeout=5)
    assert message == {"hello": "world"}

    await communicator.disconnect()


async def test_disconnect_leaves_group_cleanly():
    communicator = WebsocketCommunicator(application, "/ws/notifications/?token=carol")
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()

    # After disconnect, a group_send to the same group must not error even
    # though no consumer remains to receive it (group_discard happened).
    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        "user_carol",
        {"type": "notify.message", "payload": {"ignored": True}},
    )


def test_channel_layers_backend_is_not_in_memory():
    """AC 3: InMemoryChannelLayer in the gate-config is a red CI, not a runtime
    fallback. Reads the loaded settings directly (this test itself runs under
    the gate's VAPS_DB=postgres env, so settings.CHANNEL_LAYERS is exactly the
    gate config)."""
    from django.conf import settings

    backend = settings.CHANNEL_LAYERS["default"]["BACKEND"]
    assert backend != "channels.layers.InMemoryChannelLayer"
    assert backend == "channels_redis.core.RedisChannelLayer"
