"""Маршруты core. Имена ресурсов — донорские: под них написан клиент SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.core.api.views import DivisionViewSet

router = DefaultRouter()
router.register("divisions", DivisionViewSet, basename="core-divisions")

urlpatterns = router.urls
