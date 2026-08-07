"""Маршруты core. Имена ресурсов — донорские: под них написан клиент SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.core.api.views import (
    DivisionViewSet,
    EmployeeViewSet,
    PositionViewSet,
    RankViewSet,
)

router = DefaultRouter()
router.register("divisions", DivisionViewSet, basename="core-divisions")
router.register("employees", EmployeeViewSet, basename="core-employees")
router.register("positions", PositionViewSet, basename="core-positions")
router.register("ranks", RankViewSet, basename="core-ranks")

urlpatterns = router.urls
