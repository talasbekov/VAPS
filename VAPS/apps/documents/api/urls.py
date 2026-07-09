from rest_framework.routers import DefaultRouter

from apps.documents.api.views import AttachmentViewSet

router = DefaultRouter()
router.register("attachments", AttachmentViewSet, basename="documents-attachment")

urlpatterns = router.urls
