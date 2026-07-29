from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/core/", include("apps.core.api.urls")),
    path("api/operations/", include("apps.operations.api.urls")),
    path("api/audit/", include("apps.audit.api.urls")),
    path("api/notifications/", include("apps.notifications.api.urls")),
    path("api/documents/", include("apps.documents.api.urls")),
    # Story 7.0: health-маркер стенда в контуре (docker-compose healthcheck).
    path("api/parallel-run/", include("apps.parallel_run.api.urls")),
    # Story 13.1a: «сообщить о проблеме» — стоимость ~0, cм. BugReportViewSet.
    path("api/bugreports/", include("apps.operations.bugreports.api.urls")),
]
