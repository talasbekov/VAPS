"""Definition deactivation must not bypass the last-own-admin-grant guard."""
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.services import PermissionService, RoleAdminService

pytestmark = pytest.mark.django_db


def grant(user, role_code, permission_code, *, role_active=True, assignment_active=True, permission_active=True, scope=None):
    role = Role.objects.create(code=role_code, name=role_code, is_active=role_active)
    permission, _ = Permission.objects.update_or_create(
        code=permission_code, defaults={'name': permission_code, 'is_active': permission_active},
    )
    RolePermission.objects.create(role_code=role, permission_code=permission)
    assignment = UserRole.objects.create(user_id=str(user.pk), role_code=role,
                                         scope_division_id=scope, is_active=assignment_active)
    return role, permission, assignment


@pytest.fixture
def scene(request):
    entity = request.param
    user = User.objects.create_user(username='definition-admin-guard')
    code = '*' if entity == 'wildcard' else 'admin.roles'
    role, permission, assignment = grant(user, 'GUARD_SOLE_ADMIN', code)
    api = APIClient()
    api.force_authenticate(user)
    target = role if entity == 'role' else permission
    return SimpleNamespace(entity=entity, user=user, api=api, target=target,
                           role=role, permission=permission, assignment=assignment)


def change(subject, entry, *, actor=None, is_active=False):
    if entry == 'api':
        collection = 'roles' if isinstance(subject.target, Role) else 'permissions'
        return subject.api.patch(f'/api/operations/{collection}/{subject.target.pk}/',
                                 {'is_active': is_active, 'name': 'Changed definition'}, format='json')
    save = RoleAdminService.save_role if isinstance(subject.target, Role) else RoleAdminService.save_permission
    return save(subject.target.pk, name='Changed definition', description='Changed description',
                is_active=is_active, actor=actor or str(subject.user.pk))


def assert_rejected_without_changes(subject, entry):
    before = type(subject.target).objects.filter(pk=subject.target.pk).values().get()
    assignments = list(UserRole.objects.filter(user_id=str(subject.user.pk)).order_by('pk').values())
    history = list(OpsAuditLog.objects.order_by('pk').values())
    if entry == 'api':
        response = change(subject, entry)
        assert response.status_code == 422, response.data
        assert response.data['error_code'] == 'LAST_ACCESS_ADMIN_ROLE'
    else:
        with pytest.raises(DomainError) as error:
            change(subject, entry)
        assert error.value.code == 'LAST_ACCESS_ADMIN_ROLE'
        assert error.value.http_status == 422
    assert type(subject.target).objects.filter(pk=subject.target.pk).values().get() == before
    assert list(UserRole.objects.filter(user_id=str(subject.user.pk)).order_by('pk').values()) == assignments
    assert list(OpsAuditLog.objects.order_by('pk').values()) == history
    assert PermissionService.unscoped_permissions(str(subject.user.pk)) & {'admin.roles', '*'}


@pytest.mark.parametrize('scene', ['role', 'permission', 'wildcard'], indirect=True)
@pytest.mark.parametrize('entry', ['api', 'service'])
def test_last_own_admin_definition_cannot_be_deactivated(scene, entry):
    assert_rejected_without_changes(scene, entry)


@pytest.mark.parametrize('scene', ['role', 'permission', 'wildcard'], indirect=True)
@pytest.mark.parametrize('entry', ['api', 'service'])
def test_alternative_active_global_admin_allows_definition_deactivation(scene, entry):
    alternative = 'admin.roles' if scene.entity == 'wildcard' else '*'
    grant(scene.user, 'GUARD_ALTERNATIVE_ADMIN', alternative)
    response = change(scene, entry)
    if entry == 'api':
        assert response.status_code == 200, response.data
    scene.target.refresh_from_db()
    assert scene.target.is_active is False
    assert alternative in PermissionService.unscoped_permissions(str(scene.user.pk))
    assert OpsAuditLog.objects.filter(entity_key=scene.target.pk).exists()


@pytest.mark.parametrize('scene', ['role', 'permission', 'wildcard'], indirect=True)
@pytest.mark.parametrize('alternative_state', ['inactive_role', 'inactive_assignment', 'inactive_permission', 'scoped'])
def test_inactive_or_scoped_alternative_does_not_prevent_self_lockout(scene, alternative_state):
    alternative = 'admin.roles' if scene.entity == 'wildcard' else '*'
    scope = Division.objects.create(name='Scoped admin fallback').pk if alternative_state == 'scoped' else None
    grant(scene.user, 'GUARD_INVALID_ALTERNATIVE', alternative,
          role_active=alternative_state != 'inactive_role',
          assignment_active=alternative_state != 'inactive_assignment',
          permission_active=alternative_state != 'inactive_permission', scope=scope)
    assert_rejected_without_changes(scene, 'api')


@pytest.mark.parametrize('scene', ['permission', 'wildcard'], indirect=True)
def test_other_active_role_using_the_same_disabled_permission_is_not_an_alternative(scene):
    grant(scene.user, 'GUARD_SAME_PERMISSION', scene.permission.code)
    assert_rejected_without_changes(scene, 'api')


@pytest.mark.parametrize('entry', ['api', 'service'])
def test_deactivating_another_actors_last_admin_role_remains_allowed(entry):
    actor = User.objects.create_user(username='definition-other-admin')
    victim = User.objects.create_user(username='definition-victim-admin')
    grant(actor, 'GUARD_ACTOR_ADMIN', 'admin.roles')
    target, _, _ = grant(victim, 'GUARD_VICTIM_ADMIN', 'admin.roles')
    api = APIClient()
    api.force_authenticate(actor)
    subject = SimpleNamespace(user=actor, api=api, target=target)
    response = change(subject, entry)
    if entry == 'api':
        assert response.status_code == 200, response.data
    target.refresh_from_db()
    assert target.is_active is False
    assert PermissionService.unscoped_permissions(str(actor.pk)) & {'admin.roles', '*'}
    assert not PermissionService.unscoped_permissions(str(victim.pk))


@pytest.mark.parametrize('scene', ['role'], indirect=True)
@pytest.mark.parametrize('entity', ['role', 'permission'])
@pytest.mark.parametrize('initially_active', [True, False])
def test_non_admin_definition_can_be_deactivated_or_left_inactive(scene, entity, initially_active):
    role, permission, _ = grant(scene.user, 'GUARD_ORDINARY_ROLE', 'guard.ordinary.view')
    scene.target = role if entity == 'role' else permission
    scene.target.is_active = initially_active
    scene.target.save(update_fields=['is_active'])
    response = change(scene, 'api')
    assert response.status_code == 200, response.data
    scene.target.refresh_from_db()
    assert scene.target.is_active is False
    assert 'admin.roles' in PermissionService.unscoped_permissions(str(scene.user.pk))


@pytest.mark.parametrize('scene', ['role', 'permission', 'wildcard'], indirect=True)
def test_editing_active_admin_definition_without_disabling_is_allowed(scene):
    response = change(scene, 'api', is_active=True)
    assert response.status_code == 200, response.data
    scene.target.refresh_from_db()
    assert scene.target.is_active is True
    assert scene.target.name == 'Changed definition'
