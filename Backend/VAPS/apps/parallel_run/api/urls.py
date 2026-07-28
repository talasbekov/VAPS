from django.urls import path

from apps.parallel_run.api.views import stand_health

urlpatterns = [
    path("health/", stand_health, name="parallel-run-health"),
]
