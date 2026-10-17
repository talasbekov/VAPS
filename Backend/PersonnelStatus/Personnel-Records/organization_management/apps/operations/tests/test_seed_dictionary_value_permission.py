"""Право на значения справочников в сиде (UC-REF-001, BR13)."""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from organization_management.apps.operations.models import (
    Permission,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.services import (
    LegacyRoleSync,
    PermissionService,
)

pytestmark = pytest.mark.django_db

CODE = "dictionary_value.manage"


def test_seed_declares_the_value_permission_and_grants_it_to_reference_admin():
    call_command("seed_operations", reference_only=True)

    assert Permission.objects.get(code=CODE).name == "Изменение справочных значений"
    assert Permission.objects.get(code="dictionary.manage").name == (
        "Управление справочниками ОМ без значений (охраняемые лица)"
    )
    granted = set(
        RolePermission.objects.filter(role_code_id="REFERENCE_ADMIN")
        .values_list("permission_code_id", flat=True)
    )
    assert {"dictionary.view", "dictionary.manage", CODE} <= granted


def test_reference_admin_holder_gets_the_value_permission():
    call_command("seed_operations", reference_only=True)
    user = get_user_model().objects.create_user(username="ref-admin", password="x")
    actor = LegacyRoleSync.actor_id_for_user(user)
    UserRole.objects.create(user_id=actor, role_code_id="REFERENCE_ADMIN", is_active=True)

    assert CODE in PermissionService.effective_permissions(actor)
