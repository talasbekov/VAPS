"""
ASGI entrypoint for the HR system.

Defines the protocol type router to dispatch HTTP requests to Django's
ASGI application and WebSocket connections to the notifications
consumer via Channels.  ``AuthMiddlewareStack`` ensures that WebSocket
connections are associated with a Django session or JWT token so that
authenticated users receive their own notifications.
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from organization_management.apps.notifications import routing
from organization_management.apps.operations import ws_routing as ops_routing

# Use SQLite settings by default for local development
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "organization_management.config.settings.production")

# Маршруты раздела ОМ (`/ws/operations/...`) добавлены к старым, а не заменяют
# их: у сокета старого проекта своя идентичность (сессия через
# AuthMiddlewareStack) и свои группы. Раздел идентичность стека не использует —
# он проверяет токен сам (operations/ws_auth.py), — но и не мешает ей.
application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": AuthMiddlewareStack(
            URLRouter(
                routing.websocket_urlpatterns + ops_routing.websocket_urlpatterns
            )
        ),
    }
)
