from rest_framework.routers import DefaultRouter

from apps.operations.api.views import (
    MyPermissionsViewSet,
    PermissionViewSet,
    RoleViewSet,
    TemporaryDutyViewSet,
    UserRoleViewSet,
)
from apps.operations.duties.api.views import DutyPlanViewSet
from apps.operations.load.api.views import OverloadViewSet
from apps.operations.events.api.views import (
    AssignmentVersionViewSet,
    GroupForceRequestViewSet,
    GroupViewSet,
    JournalEntryViewSet,
    PlacementAssignmentViewSet,
    SecurityEventDirectAssignmentViewSet,
    SecurityEventViewSet,
)
from apps.operations.statuses.api.views import StatusTypeViewSet, StatusViewSet
from apps.operations.submissions.api.views import (
    DailySubmissionViewSet,
    ExpenseReportViewSet,
    TrafficLightViewSet,
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
router.register("expense-reports", ExpenseReportViewSet, basename="ops-expense-report")
router.register("traffic-light", TrafficLightViewSet, basename="ops-traffic-light")
router.register("duty-plans", DutyPlanViewSet, basename="ops-duty-plan")
router.register("security-events", SecurityEventViewSet, basename="ops-security-event")
router.register("groups", GroupViewSet, basename="ops-group")
router.register(
    "force-requests", GroupForceRequestViewSet, basename="ops-force-request"
)
router.register(
    "direct-assignments",
    SecurityEventDirectAssignmentViewSet,
    basename="ops-direct-assignment",
)
router.register(
    "assignment-versions", AssignmentVersionViewSet, basename="ops-assignment-version"
)
router.register(
    "placement-assignments",
    PlacementAssignmentViewSet,
    basename="ops-placement-assignment",
)
router.register("journal-entries", JournalEntryViewSet, basename="ops-journal-entry")
router.register("statuses", StatusViewSet, basename="ops-status")
router.register("statuses/types", StatusTypeViewSet, basename="ops-status-type")
router.register("load", OverloadViewSet, basename="ops-load")

urlpatterns = router.urls
