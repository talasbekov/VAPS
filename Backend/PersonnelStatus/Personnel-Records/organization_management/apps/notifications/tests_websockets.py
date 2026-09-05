"""Проверки веб-сокета уведомлений.

🔴 ЭТОТ ФАЙЛ НЕ СОБИРАЛСЯ НИКОГДА (Plane №799). Его имя не подходило под
`python_files` в `pytest.ini`, и ни один гейт его не гонял; собираться он стал
только с правкой шаблона.

И первый же сбор показал, ПОЧЕМУ это не мелочь: модуль не импортируется вовсе.
`channels.testing` тянет `channels.testing.live`, тот — `daphne`, а `daphne` в
зависимостях проекта нет (`requirements/base.txt` объявляет только `channels`).
Ошибка импорта в сборе не «красит одну пробу», а ПРЕРЫВАЕТ ВЕСЬ ПРОГОН
(`Interrupted: 1 error during collection`) — то есть включение шаблона без
этой оговорки уронило бы гейт всем.

`importorskip` ДО импорта `channels.testing`, а не `pytest.mark.skip` на
пробах: пропустить надо сам импорт, до которого разметка не доживает. Появится
`daphne` в зависимостях — файл начнёт выполняться сам, без правки здесь.
Отдельная карточка на то, вводить ли `daphne` в зависимости, — за решением
заказчика: это боевой пакет ASGI-сервера, а не тестовая мелочь.
"""

import pytest

pytest.importorskip(
    "daphne",
    reason=(
        "channels.testing тянет daphne, которого нет в зависимостях "
        "(Plane №799); без пропуска ошибка импорта прерывает весь сбор"
    ),
)

from channels.testing import WebsocketCommunicator  # noqa: E402
from django.test import override_settings  # noqa: E402
from django.contrib.auth.models import User  # noqa: E402
from organization_management.config.asgi import application  # noqa: E402
from channels.db import database_sync_to_async  # noqa: E402

@pytest.mark.django_db
@pytest.mark.asyncio
@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
async def test_authenticated_user_can_connect():
    user = await database_sync_to_async(User.objects.create_user)(username='testuser1', password='password')
    communicator = WebsocketCommunicator(application, "/ws/notifications/")
    communicator.scope["user"] = user
    connected, _ = await communicator.connect()
    assert connected
    await communicator.disconnect()

@pytest.mark.django_db
@pytest.mark.asyncio
@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
async def test_unauthenticated_user_cannot_connect():
    communicator = WebsocketCommunicator(application, "/ws/notifications/")
    # Simulate an unauthenticated user
    from django.contrib.auth.models import AnonymousUser
    communicator.scope["user"] = AnonymousUser()
    connected, _ = await communicator.connect()
    assert not connected
    # No need to disconnect if not connected, but it's good practice
    try:
        await communicator.disconnect()
    except Exception:
        pass

@pytest.mark.django_db
@pytest.mark.asyncio
@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
async def test_notification_is_broadcast_to_user():
    user = await database_sync_to_async(User.objects.create_user)(username='testuser2', password='password')
    communicator = WebsocketCommunicator(application, "/ws/notifications/")
    communicator.scope["user"] = user
    connected, _ = await communicator.connect()
    assert connected

    # Send a message to the user's group
    from channels.layers import get_channel_layer
    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        f'user_{user.id}_notifications',
        {
            'type': 'notification.message',
            'message': 'Hello, world!'
        }
    )

    response = await communicator.receive_json_from()
    assert response['message'] == 'Hello, world!'

    await communicator.disconnect()
