"""Story 13.1a — bugreports API routing.

A plain ``path`` maps each verb directly rather than a ``DefaultRouter``
(mirror of apps/notifications/api/urls.py's own rationale: an empty-prefix
router collides its ``api-root`` with the list route and confuses
drf-spectacular's operationId derivation — verified live, the router variant
produced a duplicate ``bugreports_retrieve`` operationId for both GET
endpoints). Plain paths still expose ``.cls``/``.actions`` for the rbac-
matrix route introspection (story 2.9).
"""

from django.urls import path

from apps.operations.bugreports.api.views import BugReportViewSet

urlpatterns = [
    path(
        "",
        BugReportViewSet.as_view({"get": "list", "post": "create"}),
        name="bugreport-list",
    ),
    path(
        "<int:pk>/",
        BugReportViewSet.as_view({"get": "retrieve"}),
        name="bugreport-detail",
    ),
]
