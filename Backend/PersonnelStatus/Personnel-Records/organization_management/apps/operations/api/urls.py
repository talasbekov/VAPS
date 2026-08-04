"""Маршруты /api/operations/ — раздел «Охранные мероприятия».

Поверхность растёт по мере переезда из Backend/VAPS; сейчас — идентичность
и администрирование RBAC.
"""
from rest_framework.routers import DefaultRouter

from organization_management.apps.operations.api.views import (
    AuditLogViewSet,
    DailySubmissionViewSet,
    MyPermissionsViewSet,
    PermissionViewSet,
    RoleViewSet,
    SecondmentViewSet,
    StatusTypeViewSet,
    StatusViewSet,
    StrengthReportViewSet,
    TemporaryDutyViewSet,
    UserRoleViewSet,
)

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")
router.register("user-roles", UserRoleViewSet, basename="ops-user-role")
router.register("status-types", StatusTypeViewSet, basename="ops-status-type")
router.register("statuses", StatusViewSet, basename="ops-status")
router.register("secondments", SecondmentViewSet, basename="ops-secondment")
router.register(
    "strength-report", StrengthReportViewSet, basename="ops-strength-report"
)
router.register("temporary-duty", TemporaryDutyViewSet, basename="ops-temp-duty")
router.register(
    "daily-submissions", DailySubmissionViewSet, basename="ops-daily-submission"
)
router.register("audit-logs", AuditLogViewSet, basename="ops-audit-log")
router.register("my-permissions", MyPermissionsViewSet, basename="ops-my-permissions")

urlpatterns = router.urls
