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
    EvaluationRegistryViewSet,
    EvaluationWorkItemViewSet,
    EvaluationWorkspaceViewSet,
    OperationalRatingDynamicsViewSet,
    OperationalRatingEmployeeViewSet,
    OperationalRatingsViewSet,
    OpsPersonnelViewSet,
    RatingAnalyticsViewSet,
    RatingAuditViewSet,
    RatingExportArtifactsViewSet,
    RatingExportsViewSet,
    RatingNotificationsViewSet,
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
# Оперативный рейтинг (§19, §22.16): динамика, карточка и реестр — СВОИ
# коллекции, а не хвосты под путём сводки: путь строки перехватил бы соседей
# (инцидент Этапа 39 клиента).
router.register(
    "operational-ratings", OperationalRatingsViewSet,
    basename="ops-operational-ratings",
)
router.register(
    "operational-rating-dynamics", OperationalRatingDynamicsViewSet,
    basename="ops-rating-dynamics",
)
router.register(
    "operational-rating-employee", OperationalRatingEmployeeViewSet,
    basename="ops-rating-employee",
)
router.register(
    "rating-analytics", RatingAnalyticsViewSet,
    basename="ops-rating-analytics",
)
router.register(
    "evaluation-workspace", EvaluationWorkspaceViewSet,
    basename="ops-evaluation-workspace",
)
router.register(
    "evaluation-work-items", EvaluationWorkItemViewSet,
    basename="ops-evaluation-work-items",
)
router.register(
    "evaluation-registry", EvaluationRegistryViewSet,
    basename="ops-evaluation-registry",
)
router.register(
    "rating-audit", RatingAuditViewSet, basename="ops-rating-audit"
)
router.register(
    "rating-notifications", RatingNotificationsViewSet,
    basename="ops-rating-notifications",
)
router.register(
    "rating-exports", RatingExportsViewSet, basename="ops-rating-exports"
)
router.register(
    "rating-export-artifacts", RatingExportArtifactsViewSet,
    basename="ops-rating-export-artifacts",
)

urlpatterns = router.urls
