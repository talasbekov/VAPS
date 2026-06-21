import pytest
from django.db import IntegrityError

from apps.operations.rbac.models import Permission, Role, RolePermission

pytestmark = pytest.mark.django_db


@pytest.fixture
def role_and_perm():
    role = Role.objects.create(code="OMD", name="ОМД")
    perm = Permission.objects.create(
        code="assignment.create", name="Создание назначения"
    )
    return role, perm


def test_create_mapping_has_integer_pk(role_and_perm):
    role, perm = role_and_perm
    rp = RolePermission.objects.create(role_code=role, permission_code=perm)
    assert isinstance(rp.pk, int)


def test_role_permission_unique(role_and_perm):
    role, perm = role_and_perm
    RolePermission.objects.create(role_code=role, permission_code=perm)
    with pytest.raises(IntegrityError):
        RolePermission.objects.create(role_code=role, permission_code=perm)
