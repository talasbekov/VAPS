"""Story 11.1 — WS URL routing for apps.notifications.

Mirrors ``apps/notifications/api/urls.py``'s app-owns-its-routes pattern:
``config/asgi.py`` imports ``websocket_urlpatterns`` from here, the same way
``config/urls.py`` includes ``apps.notifications.api.urls``. A single route
for the MVP smoke consumer (Story 11.1 scope) — additional WS routes, if any
future story needs them, are added here, not in ``config/asgi.py``.
"""

from django.urls import re_path

from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = [
    re_path(r"^ws/notifications/$", NotificationConsumer.as_asgi()),
]
