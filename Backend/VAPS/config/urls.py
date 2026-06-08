from django.urls import include, path

urlpatterns = [
    path("api/core/", include("apps.core.api.urls")),
    path("api/operations/", include("apps.operations.api.urls")),
]
