"""Маршруты /api/operations/ — identity раздела «Охранные мероприятия»."""
from django.urls import path

from .operations_views import MyOperationsPermissionsView

urlpatterns = [
    path(
        "my-permissions/",
        MyOperationsPermissionsView.as_view(),
        name="operations-my-permissions",
    ),
]
