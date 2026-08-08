"""Маршруты core. Имена ресурсов — донорские: под них написан клиент SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.core.api.views import (
    DivisionViewSet,
    EmployeeViewSet,
    PositionViewSet,
    RankViewSet,
    StaffingSlotViewSet,
    VacancyViewSet,
)

router = DefaultRouter()
router.register("divisions", DivisionViewSet, basename="core-divisions")
router.register("employees", EmployeeViewSet, basename="core-employees")
router.register("positions", PositionViewSet, basename="core-positions")
router.register("ranks", RankViewSet, basename="core-ranks")
router.register(
    "staffing-slots", StaffingSlotViewSet, basename="core-staffing-slots"
)
router.register("vacancies", VacancyViewSet, basename="core-vacancies")

urlpatterns = router.urls
