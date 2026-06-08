from rest_framework.routers import DefaultRouter

from apps.operations.api.views import (
    PermissionViewSet, RoleViewSet, UserRoleViewSet,
)

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")
router.register("user-roles", UserRoleViewSet, basename="ops-user-role")

urlpatterns = router.urls
