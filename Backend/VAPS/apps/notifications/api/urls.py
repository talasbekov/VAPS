"""Story 5.7c — notifications read API routing.

A single list-only endpoint (``GET /api/notifications/``), so a plain ``path``
maps ``GET → list`` directly rather than a router. A ``DefaultRouter`` with an
empty prefix would collide its ``api-root`` with the list at ``^$``; the plain
path is unambiguous and still exposes ``.cls``/``.actions`` on the callback for
the rbac-matrix route introspection (story 2.9).
"""

from django.urls import path

from apps.notifications.api.views import NotificationViewSet

urlpatterns = [
    path(
        "",
        NotificationViewSet.as_view({"get": "list"}),
        name="notification-list",
    ),
]
