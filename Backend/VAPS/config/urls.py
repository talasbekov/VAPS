from django.urls import include, path

urlpatterns = [
    path("api/core/", include("apps.core.api.urls")),
]
