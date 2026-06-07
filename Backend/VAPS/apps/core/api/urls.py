from rest_framework.routers import DefaultRouter

from apps.core.api.views import DivisionViewSet, EmployeeViewSet

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("divisions", DivisionViewSet, basename="division")

urlpatterns = router.urls
