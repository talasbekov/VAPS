"""Проверки веб-сокета уведомлений (`/ws/notifications/`).

🔴 ЭТОТ ФАЙЛ НЕ СОБИРАЛСЯ НИКОГДА (Plane №799). Его имя не подходило под
`python_files` в `pytest.ini`, и ни один гейт его не гонял; собираться он стал
только с правкой шаблона. Первый же сбор показал, что модуль не импортируется
вовсе: `channels.testing` тянет `channels.testing.live`, тот — `daphne`, а
`daphne` в зависимостях не был объявлен. Ошибка импорта в сборе не «красит одну
пробу», а ПРЕРЫВАЕТ ВЕСЬ ПРОГОН, поэтому файл был закрыт `importorskip`.

🔴 ПРОПУСКА БОЛЬШЕ НЕТ (Plane №806, решение заказчика 06.09.2026): веб-сокет
уведомлений признан живым в боевом контуре, и эти три пробы гоняются в каждом
прогоне. `importorskip` снят намеренно, а не забыт: пока он стоял, исчезнувший
`daphne` превращал пробы в тихий скип, а скип читается как зелень. Теперь
пропавший пакет обязан уронить сбор — это ошибка поставки, и молчать о ней
нечем.

ГДЕ ЧТО ОБЪЯВЛЕНО, и это не мелочь: `channels-redis` — в `requirements/base.txt`
(слой каналов боевой), а `daphne` — в `requirements/development.txt`. Боевым
ASGI-сервером заказчик выбрал `uvicorn`; `daphne` нужен ровно этим пробам, и
объявлять его боевым значило бы обещать контуру сервер, которым его никто не
запускает.

ЧТО ЕЩЁ ПОТРЕБОВАЛОСЬ, чтобы «гоняются» было правдой: `pytest-asyncio`
(`requirements/development.txt`). Пробы написаны как `async def`, а сам pytest
корутины не исполняет. Замерено 06.09.2026: `-p no:asyncio` даёт 3 failed
(«async def functions are not natively supported. You need to install a suitable
plugin…»), с плагином — 3 passed. Падение громкое, а не тихий скип, — но пробы
без плагина всё равно не выполняются, поэтому он в поставке разработки.

СОСЕДНИЙ СРЕЗ. `apps/operations/tests/test_ws_consumer.py` проверяет ДРУГОЙ
маршрут (`/ws/operations/notifications/`) и делает это без daphne — своим
тонким коммуникатором поверх `asgiref.testing`. Дубля нет: там своя
идентичность (токен раздела), здесь — сессия через `AuthMiddlewareStack`.
"""
import pytest

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import override_settings

from organization_management.config.asgi import application

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
    """Конверт из группы пользователя доезжает до сокета дословно.

    🔴 ЭТА ПРОБА ПЕРВЫМ ЖЕ ВЫПОЛНЕНИЕМ ВСКРЫЛА ДЕФЕКТ БОЕВОГО КОДА (Plane
    №824). Она написана была на группу `user_<id>_notifications`, и на ней
    падала по таймауту: потребитель заходит в группу `user_<id>` (см.
    `consumers.py`), и в адрес с суффиксом не заходит НИКТО. Тот же неверный
    адрес стоит в `signals.py`, откуда уходят уведомления о смене статуса, —
    то есть они не приезжают в браузер вообще. Правится это отдельной
    карточкой: здесь проверяется ПОТРЕБИТЕЛЬ, и брать он обязан свой
    собственный адрес, а не тот, по которому ошибочно пишет один из издателей.

    Форма конверта тоже взята у потребителя, а не придумана: `send_json`
    отправляет `event["message"]` КАК ЕСТЬ, ничего не оборачивая. Прежний
    ассерт `response["message"]` предполагал обёртку, которой нет, и на
    строковом теле дал бы `TypeError` — до него дело не доходило только
    потому, что раньше падал таймаут.
    """
    user = await database_sync_to_async(User.objects.create_user)(
        username="testuser2", password="password"
    )
    communicator = WebsocketCommunicator(application, "/ws/notifications/")
    communicator.scope["user"] = user
    connected, _ = await communicator.connect()
    assert connected

    from channels.layers import get_channel_layer

    # Тело — словарь, как у настоящего издателя
    # (`services/websocket_service.py`), а не строка: так проверяется, что
    # структура доезжает целиком, а не только факт доставки.
    payload = {"type": "status_update", "employee_id": 42, "new_status": "ON_DUTY"}
    await get_channel_layer().group_send(
        f"user_{user.id}",
        {"type": "notification.message", "message": payload},
    )

    assert await communicator.receive_json_from() == payload

    await communicator.disconnect()
