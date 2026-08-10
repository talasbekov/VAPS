"""Маршруты раздела ОМ. Имена ресурсов — те, под которые написана SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.ops.api.views import SecurityObjectViewSet

router = DefaultRouter()
router.register("objects", SecurityObjectViewSet, basename="ops-objects")

urlpatterns = router.urls
