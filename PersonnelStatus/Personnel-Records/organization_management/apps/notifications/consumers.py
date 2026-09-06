from channels.generic.websocket import AsyncJsonWebsocketConsumer

from organization_management.apps.notifications.groups import group_name_for

class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close()
            return

        # Имя группы — из общего договора (Plane №824): три копии этой строки
        # разошлись, и одна доставляла в пустоту.
        self.user_group = group_name_for(self.user.id)

        await self.channel_layer.group_add(
            self.user_group,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.user_group,
            self.channel_name
        )

    async def notification_message(self, event):
        """Отправка уведомления клиенту"""
        await self.send_json(event['message'])
