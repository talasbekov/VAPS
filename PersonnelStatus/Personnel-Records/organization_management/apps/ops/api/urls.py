"""Маршруты раздела ОМ. Имена ресурсов — те, под которые написана SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.ops.api.views import (
    CombatDutyShiftViewSet,
    OpsAuditLogViewSet,
    OpsDictionariesViewSet,
    OpsSettingChangesViewSet,
    OpsSettingsViewSet,
    CombatDutyTypeViewSet,
    CombatRosterCandidatesViewSet,
    CombatRouteViewSet,
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
router.register(
    "combat-duty-types", CombatDutyTypeViewSet, basename="ops-combat-types"
)
router.register("combat-routes", CombatRouteViewSet, basename="ops-combat-routes")
router.register(
    "combat-roster-candidates",
    CombatRosterCandidatesViewSet,
    basename="ops-combat-candidates",
)
router.register(
    "combat-duty-shifts", CombatDutyShiftViewSet, basename="ops-combat-shifts"
)
router.register("settings", OpsSettingsViewSet, basename="ops-settings")
router.register(
    "setting-changes", OpsSettingChangesViewSet, basename="ops-setting-changes"
)
router.register(
    "dictionaries", OpsDictionariesViewSet, basename="ops-dictionaries"
)
router.register("audit-logs", OpsAuditLogViewSet, basename="ops-audit-logs")

urlpatterns = router.urls
