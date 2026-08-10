"""Маршруты documents. Имена ресурсов — донорские: под них написан клиент SPA."""
from rest_framework.routers import DefaultRouter

from organization_management.apps.documents.api.views import AttachmentViewSet

router = DefaultRouter()
router.register(
    "attachments", AttachmentViewSet, basename="documents-attachments"
)

urlpatterns = router.urls
