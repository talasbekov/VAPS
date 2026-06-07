from rest_framework.routers import DefaultRouter

from apps.core.api.views import (
    DivisionViewSet, EmployeeViewSet, PositionViewSet, RankViewSet,
    StaffingSlotViewSet, VacancyViewSet,
)

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("divisions", DivisionViewSet, basename="division")
router.register("positions", PositionViewSet, basename="position")
router.register("ranks", RankViewSet, basename="rank")
router.register("staffing-slots", StaffingSlotViewSet, basename="staffing-slot")
router.register("vacancies", VacancyViewSet, basename="vacancy")

urlpatterns = router.urls
