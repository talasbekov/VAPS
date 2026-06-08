from rest_framework.routers import DefaultRouter

from apps.operations.api.views import PermissionViewSet, RoleViewSet

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")

urlpatterns = router.urls
