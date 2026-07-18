"""Story 11.1 — WebSocket URL patterns for the notifications app.

Channels hands ``URLRouter`` the path WITHOUT its leading slash, so the pattern
below resolves to ``/ws/notifications/`` on the wire (architecture.md#L600).
"""

from django.urls import path

from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = [
    path("ws/notifications/", NotificationConsumer.as_asgi()),
]
