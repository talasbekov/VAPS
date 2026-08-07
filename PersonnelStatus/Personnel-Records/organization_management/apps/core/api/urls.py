"""Маршруты core. Имена ресурсов — донорские: под них написан клиент SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.core.api.views import (
    DivisionViewSet,
    EmployeeViewSet,
)

router = DefaultRouter()
router.register("divisions", DivisionViewSet, basename="core-divisions")
router.register("employees", EmployeeViewSet, basename="core-employees")

urlpatterns = router.urls
