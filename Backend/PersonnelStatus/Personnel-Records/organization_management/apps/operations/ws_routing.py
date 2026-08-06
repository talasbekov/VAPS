"""WS-маршруты раздела ОМ (порт apps/notifications/routing.py из Backend/VAPS).

Channels отдаёт `URLRouter` путь БЕЗ ведущего слэша, поэтому шаблон ниже на
проводе означает `/ws/operations/notifications/`.

Своё пространство `/ws/operations/`, а не общее `/ws/notifications/`: последнее
занято сокетом старого проекта (`apps.notifications`), у которого своя
идентичность (сессия) и свои имена групп (`user_<pk>`). Подмешивать раздел в
чужой поток означало бы делить с ним и словарь видов, и правила доступа.
"""
from django.urls import path

from organization_management.apps.operations.ws_consumers import (
    OpsNotificationConsumer,
)

websocket_urlpatterns = [
    path("ws/operations/notifications/", OpsNotificationConsumer.as_asgi()),
]
