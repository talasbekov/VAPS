"""Общие помощники проб раздела ОМ.

`client_for` заводит учётку с ролью и правами нового RBAC и возвращает
авторизованный APIClient. В рабочем репозитории помощник живёт в
`test_bulk_status_api.py`; экспорт исходников этого модуля не содержит,
поэтому помощник вынесен сюда, а старый путь импорта сохранён шимом.
"""
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.services import LegacyRoleSync


def client_for(username, role_code=None, permission_codes=None,
               scope_division_id=None):
    """Учётка + роль + права → (APIClient, User).

    Без `role_code` — просто вошедший пользователь без единого права:
    ровно то, что нужно пробам «один IsAuthenticated не право».
    """
    user = get_user_model().objects.create_user(
        username=username, password="x"
    )
    if role_code is not None:
        Role.objects.get_or_create(code=role_code, defaults={"name": role_code})
        for code in permission_codes or []:
            Permission.objects.get_or_create(code=code, defaults={"name": code})
            RolePermission.objects.get_or_create(
                role_code_id=role_code, permission_code_id=code
            )
        UserRole.objects.get_or_create(
            user_id=LegacyRoleSync.actor_id_for_user(user),
            role_code_id=role_code,
            scope_division_id=scope_division_id,
            defaults={"is_active": True},
        )
    api = APIClient()
    api.force_authenticate(user)
    return api, user
