from rest_framework.routers import DefaultRouter

from apps.operations.api.views import (
    MyPermissionsViewSet, PermissionViewSet, RoleViewSet,
    TemporaryDutyViewSet, UserRoleViewSet,
)

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")
router.register("user-roles", UserRoleViewSet, basename="ops-user-role")
router.register("temporary-duty", TemporaryDutyViewSet, basename="ops-temp-duty")
router.register("my-permissions", MyPermissionsViewSet, basename="ops-my-permissions")

urlpatterns = router.urls
