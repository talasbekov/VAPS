"""Адреса своей учётной записи — `/api/user/`.

Отдельный модуль, а не строки в `api/urls.py` раздела: тот целиком висит на
префиксе `/api/operations/` и на гейте admin.roles, а эти два адреса живут
снаружи и того, и другого (см. `self_account.py` о выборе адреса).
"""
from django.urls import path

from organization_management.apps.operations.api.self_account import (
    ChangeOwnPasswordView,
    SelfProfileView,
)

urlpatterns = [
    path("profile/", SelfProfileView.as_view(), name="self-profile"),
    path(
        "change-password/",
        ChangeOwnPasswordView.as_view(),
        name="self-change-password",
    ),
]
