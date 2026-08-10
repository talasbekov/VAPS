"""Маршруты раздела ОМ. Имена ресурсов — те, под которые написана SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.ops.api.views import (
    OpsPersonnelViewSet,
    SecurityEventViewSet,
    SecurityObjectViewSet,
)

router = DefaultRouter()
router.register("objects", SecurityObjectViewSet, basename="ops-objects")
router.register(
    "security-events", SecurityEventViewSet, basename="ops-security-events"
)
router.register("personnel", OpsPersonnelViewSet, basename="ops-personnel")

urlpatterns = router.urls
