from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/core/", include("apps.core.api.urls")),
    path("api/operations/", include("apps.operations.api.urls")),
    path("api/audit/", include("apps.audit.api.urls")),
]
