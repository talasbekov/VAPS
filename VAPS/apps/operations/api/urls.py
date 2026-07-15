from rest_framework.routers import DefaultRouter

from apps.operations.api.views import (
    MyPermissionsViewSet,
    PermissionViewSet,
    RoleViewSet,
    TemporaryDutyViewSet,
    UserRoleViewSet,
)
from apps.operations.statuses.api.views import StatusViewSet
from apps.operations.submissions.api.views import (
    DailySubmissionViewSet,
    ExpenseReportViewSet,
)

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")
router.register("user-roles", UserRoleViewSet, basename="ops-user-role")
router.register("temporary-duty", TemporaryDutyViewSet, basename="ops-temp-duty")
router.register("my-permissions", MyPermissionsViewSet, basename="ops-my-permissions")
router.register(
    "daily-submissions", DailySubmissionViewSet, basename="ops-daily-submission"
)
router.register(
    "expense-reports", ExpenseReportViewSet, basename="ops-expense-report"
)
router.register("statuses", StatusViewSet, basename="ops-status")

urlpatterns = router.urls
