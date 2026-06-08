import pytest
from django.core.management import call_command

from apps.core.models import Division, DivisionType, Organization
from apps.operations.models import UserRole
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(organization=org, type_code=dt, name="root", code="R")
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C", parent=root
    )
    other = Division.objects.create(organization=org, type_code=dt, name="other", code="O")
    return root, child, other


def test_scoped_role_matches_division_in_subtree(tree):
    root, child, _ = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=child.id) is True


def test_scoped_role_denies_division_outside_subtree(tree):
    root, _, other = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=other.id) is False


def test_scoped_role_still_grants_when_no_division_given(tree):
    root, _, _ = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view") is True


def test_global_role_matches_any_division(tree):
    root, child, other = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=other.id) is True
