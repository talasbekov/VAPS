"""Маршруты раздела ОМ. Имена ресурсов — те, под которые написана SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.ops.api.views import (
    DutyCandidatesViewSet,
    DutyMonthlyPlanViewSet,
    DutyPlanObjectsViewSet,
    DutyShiftViewSet,
    DutyTypeViewSet,
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
router.register("duty-types", DutyTypeViewSet, basename="ops-duty-types")
router.register(
    "duty-monthly-plan", DutyMonthlyPlanViewSet, basename="ops-duty-plan"
)
router.register("duty-shifts", DutyShiftViewSet, basename="ops-duty-shifts")
router.register(
    "duty-plan-objects", DutyPlanObjectsViewSet, basename="ops-duty-objects"
)
router.register(
    "duty-candidates", DutyCandidatesViewSet, basename="ops-duty-candidates"
)

urlpatterns = router.urls
