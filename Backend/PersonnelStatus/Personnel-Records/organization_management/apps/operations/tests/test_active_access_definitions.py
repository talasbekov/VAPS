"""Deactivating definitions revokes access and notification eligibility together."""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient
from django.contrib.auth.models import User

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Permission, Role, RolePermission, TemporaryDutyPermission, UserRole
from organization_management.apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def scene():
    division = Division.objects.create(name='Access definition scope', division_type='department')
    user = User.objects.create_user('definition-viewer', password='fixture-only')
    role = Role.objects.create(code='FIX_ACTIVE_ROLE', name='Scoped viewer')
    permission = Permission.objects.create(code='fix.definition.view', name='Scoped right')
    RolePermission.objects.create(role_code=role, permission_code=permission)
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=division.pk)
    return user, role, permission, division


def assert_access(scene, allowed):
    user, role, permission, division = scene
    uid = str(user.pk)
    code = permission.code
    assert PermissionService.has_permission(uid, code, division.pk) is allowed
    assert (code in PermissionService.effective_permissions(uid)) is allowed
    assert (role.code in PermissionService.roles_holding(code)) is allowed
    assert bool(PermissionService.active_grants_for_permission(uid, code)) is allowed
    assert bool(PermissionService.active_grants_for_permission_many([uid], code)[uid]) is allowed
    assert (division.pk in (PermissionService.visible_division_ids(uid, code) or set())) is allowed


@pytest.mark.parametrize('definition', ['role', 'permission'])
def test_deactivation_revokes_all_resolvers_and_reactivation_restores(scene, definition):
    assert_access(scene, True)
    obj = scene[1 if definition == 'role' else 2]
    obj.is_active = False
    obj.save(update_fields=['is_active'])
    assert_access(scene, False)
    obj.is_active = True
    obj.save(update_fields=['is_active'])
    assert_access(scene, True)


@pytest.mark.parametrize('definition', ['role', 'permission'])
def test_unscoped_and_my_permissions_do_not_keep_disabled_definitions(scene, definition):
    user, role, permission, _ = scene
    UserRole.objects.filter(user_id=str(user.pk)).update(scope_division_id=None)
    api = APIClient()
    api.force_authenticate(user)
    assert permission.code in api.get('/api/operations/my-permissions/').data['permissions']
    obj = role if definition == 'role' else permission
    obj.is_active = False
    obj.save(update_fields=['is_active'])
    assert PermissionService.unscoped_permissions(str(user.pk)) == set()
    response = api.get('/api/operations/my-permissions/')
    assert response.status_code == 200
    assert permission.code not in response.data['permissions']
    assert permission.code not in response.data['global_permissions']
    if definition == 'role':
        assert not response.data['roles']


def test_disabled_temporary_role_cannot_create_derived_overview_grant(scene):
    user, _, _, department = scene
    UserRole.objects.filter(user_id=str(user.pk)).delete()
    directorate = Division.objects.create(name='Scoped directorate', division_type='directorate', parent=department)
    role, _ = Role.objects.update_or_create(code='HEAD_DIRECTORATE_LINE', defaults={'name': 'Head', 'is_active': False})
    overview, _ = Role.objects.update_or_create(code='OVERVIEW_DEPARTMENT', defaults={'name': 'Overview', 'is_active': True})
    view, _ = Permission.objects.get_or_create(code='orgstructure.view', defaults={'name': 'Overview'})
    RolePermission.objects.get_or_create(role_code=overview, permission_code=view)
    TemporaryDutyPermission.objects.create(user_id=str(user.pk), duty_role_code=role.code, scope_division_id=directorate.pk, starts_at=Clock.now()-timedelta(hours=1), ends_at=Clock.now()+timedelta(hours=1), created_by='fixture')
    assert not PermissionService.has_permission(str(user.pk), view.code, department.pk)
    assert not PermissionService.active_grants_for_permission_many([user.pk], view.code)[str(user.pk)]


@pytest.mark.parametrize('definition', ['role', 'permission'])
def test_disabled_wildcard_grant_stops_granting_everything(scene, definition):
    user, role, _, _ = scene
    wildcard, _ = Permission.objects.get_or_create(code='*', defaults={'name': 'All'})
    RolePermission.objects.create(role_code=role, permission_code=wildcard)
    assert PermissionService.has_permission(str(user.pk), 'unregistered.example')
    obj = role if definition == 'role' else wildcard
    obj.is_active = False
    obj.save(update_fields=['is_active'])
    assert not PermissionService.has_permission(str(user.pk), 'unregistered.example')
    assert role.code not in PermissionService.roles_holding('unregistered.example')

