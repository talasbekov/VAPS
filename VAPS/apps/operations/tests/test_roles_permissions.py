import pytest

from apps.operations.rbac.models import Permission, Role

pytestmark = pytest.mark.django_db


def test_role_code_is_primary_key():
    role = Role.objects.create(code="ADMIN", name="Администратор")
    assert role.pk == "ADMIN"
    assert role.is_active is True


def test_permission_code_is_primary_key():
    perm = Permission.objects.create(code="admin.roles", name="Управление ролями")
    assert perm.pk == "admin.roles"


def test_wildcard_permission_row_allowed():
    perm = Permission.objects.create(code="*", name="Все права")
    assert perm.pk == "*"
