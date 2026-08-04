"""Маршруты /api/operations/ — раздел «Охранные мероприятия».

Поверхность растёт по мере переезда из Backend/VAPS; сейчас — идентичность.
"""
from rest_framework.routers import DefaultRouter

from organization_management.apps.operations.api.views import MyPermissionsViewSet

router = DefaultRouter()
router.register("my-permissions", MyPermissionsViewSet, basename="ops-my-permissions")

urlpatterns = router.urls
