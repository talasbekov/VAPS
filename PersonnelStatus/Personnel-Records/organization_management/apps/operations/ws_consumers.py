"""Потребитель `/ws/operations/notifications/` (порт apps/notifications/
consumers.py из Backend/VAPS).

Тонкий транспорт и ничего сверх: ни деловой логики, ни транзакций, ни вызовов
сервисов. Запись уведомлений остаётся исключительно за notify() — единственной
точкой записи ленты; пометка «прочитано» — HTTP-мутация, и навешивать её на
сокет незачем.

ЗДЕСЬ ЖИВУТ ДВА РАЗНЫХ ПОЛЯ `type`, и путать их — классическая ошибка на
channels:

* `type` конверта КАНАЛЬНОГО СЛОЯ — `ws_groups.NOTIFY_MESSAGE_TYPE`; чистая
  маршрутизация, до клиента не доезжает (по нему channels и находит метод
  `ops_notify_message` ниже);
* `type` конверта WEBSOCKET — код вида уведомления, он едет ВНУТРИ
  `event["message"]` как `{"type": ..., "payload": ...}`.

Путаница даёт либо «No handler for message type» на сервере, либо конверт без
кода вида у клиента. Потребитель намеренно не знает видов: он ретранслирует
`event["message"]` дословно, поэтому словарь видов — забота отправителя.
"""
import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from organization_management.apps.operations.ws_auth import resolve_actor_id
from organization_management.apps.operations.ws_groups import group_name_for

# Код закрытия из приватного диапазона, зеркалящий REST-договор «аноним → 403».
# «Принять и молчать» отвергнуто: клиент не отличил бы «не пустили» от «пока
# ничего не произошло» и переподключался бы в пустоту вечно.
CLOSE_UNAUTHENTICATED = 4403


class OpsNotificationConsumer(AsyncWebsocketConsumer):
    """Ретранслирует уведомления, адресованные СВОЕМУ актору соединения.

    Группа выводится ИСКЛЮЧИТЕЛЬНО из токена, проверенного сервером. Ни один
    параметр, которым распоряжается клиент (`?user_id=`, `?recipient=`), на
    неё не влияет: это тот же инвариант «своя лента», что у HTTP-ленты, —
    сокет, умеющий подписаться на чужую группу, обошёл бы разграничение
    доступа целиком.
    """

    async def connect(self):
        # Идентичность ходит в базу (существование и активность учётки), а
        # корутине ORM недоступна — отсюда синхронный островок.
        actor = await database_sync_to_async(resolve_actor_id)(self.scope)
        if not actor:
            # Отказ ДО accept(): рукопожатие не состоялось вовсе.
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        self.group = group_name_for(actor)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        # У отклонённого рукопожатия группы не было — getattr, а не
        # self.group, иначе каждый отказ добавляет AttributeError в журнал.
        group = getattr(self, "group", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Клиент только слушает; живость держат протокольные ping/pong. Кадры
        # снаружи игнорируются, а не разбираются: неиспользуемый разборщик —
        # это поверхность атаки без единого потребителя.
        return

    async def ops_notify_message(self, event):
        # Имя метода — это NOTIFY_MESSAGE_TYPE с точками, заменёнными на
        # подчёркивания: так channels выбирает обработчик. Разъедься они,
        # потребитель падал бы на «No handler for message type» — в проде, на
        # первом же настоящем уведомлении.
        # `event["message"]` И ЕСТЬ конверт клиента; ретранслируется как есть
        # (см. про два поля `type` в докстринге модуля).
        await self.send(text_data=json.dumps(event["message"]))
