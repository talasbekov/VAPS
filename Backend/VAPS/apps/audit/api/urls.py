from rest_framework.routers import DefaultRouter

from apps.audit.api.views import AuditLogViewSet

router = DefaultRouter()
router.register("logs", AuditLogViewSet, basename="audit-log")

urlpatterns = router.urls
