"""Stories 5.7c/11.4a — notifications API routing.

A plain ``path`` maps each verb directly rather than a router. A
``DefaultRouter`` with an empty prefix would collide its ``api-root`` with the
list at ``^$``; the plain paths are unambiguous and still expose
``.cls``/``.actions`` on the callback for the rbac-matrix route introspection
(story 2.9).
"""

from django.urls import path

from apps.notifications.api.views import NotificationViewSet

urlpatterns = [
    path(
        "",
        NotificationViewSet.as_view({"get": "list"}),
        name="notification-list",
    ),
    path(
        "<int:pk>/read/",
        NotificationViewSet.as_view({"post": "mark_read"}),
        name="notification-mark-read",
    ),
]
