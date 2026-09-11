"""Portable per-login access transfer. Synthetic users only (Plane1193)."""
import copy
import importlib.util
from pathlib import Path

import pytest
from django.contrib.auth.models import Group, User
from django.contrib.auth.models import Permission as DjangoPermission
from django.utils import timezone

from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.services import PermissionService

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'deploy').is_dir())


def module():
    path = ROOT / 'deploy/access-portable/access_transfer.py'
    assert path.exists(), 'portable access transfer is not implemented'
    spec = importlib.util.spec_from_file_location('access_transfer', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def source(db):
    a = User.objects.create_user('transfer-a', password='keep-password', is_staff=True)
    b = User.objects.create_user('transfer-b', password='other-password')
    for code, permission in [('TRANSFER-A', 'personnel.view'), ('TRANSFER-B', 'status.manage')]:
        r = Role.objects.create(code=code, name=code)
        p, _ = Permission.objects.get_or_create(code=permission, defaults={'name': permission})
        RolePermission.objects.create(role_code=r, permission_code=p)
    UserRole.objects.create(user_id=str(a.pk), role_code_id='TRANSFER-A', scope_division_id=87654)
    UserRole.objects.create(user_id=str(a.pk), role_code_id='TRANSFER-A', scope_division_id=87655)
    UserRole.objects.create(user_id=str(b.pk), role_code_id='TRANSFER-B')
    group = Group.objects.create(name='transfer-group')
    perm = DjangoPermission.objects.first()
    group.permissions.add(perm)
    a.groups.add(group)
    b.user_permissions.add(perm)
    return a, b


def dump(m, source):
    return m.export_data([u.username for u in source])


def mutate(source):
    a, b = source
    UserRole.objects.filter(user_id__in=[str(a.pk), str(b.pk)]).delete()
    UserRole.objects.create(user_id=str(a.pk), role_code_id='TRANSFER-B')
    a.is_staff = False
    a.save(update_fields=['is_staff'])
    a.groups.clear()
    b.user_permissions.clear()


@pytest.mark.django_db
def test_individual_roles_flags_groups_and_repeat(source):
    m = module()
    data = dump(m, source)
    assert 'password' not in str(data)
    assert 'scope_division_id' not in str(data)
    passwords = [u.password for u in source]
    mutate(source)
    preview = m.transfer(data)
    assert preview['applied'] is False
    assert PermissionService.effective_permissions(str(source[0].pk)) == {'status.manage'}
    result = m.transfer(data, apply=True)
    assert result['applied'] is True and result['matched'] == 2
    a, b = source
    assert PermissionService.effective_permissions(str(a.pk)) == {'personnel.view'}
    assert PermissionService.effective_permissions(str(b.pk)) == {'status.manage'}
    assert a.groups.get().name == 'transfer-group'
    assert b.user_permissions.count() == 1
    for u, password in zip(source, passwords):
        u.refresh_from_db()
        assert u.password == password
    assert a.is_staff
    grants = list(UserRole.objects.filter(user_id__in=[str(a.pk), str(b.pk)]).values())
    assert all(g['scope_division_id'] is None for g in grants)
    assert len(grants) == 2
    second = m.transfer(data, apply=True)
    assert second['changed_users'] == 0
    assert grants == list(UserRole.objects.filter(user_id__in=[str(a.pk), str(b.pk)]).values())
    assert result['backup']['users']


@pytest.mark.django_db
def test_username_mapping_missing_user_empty_roles_and_extra_user(source):
    m = module()
    data = dump(m, source)
    data['users'][0]['roles'] = []
    data['users'].append(dict(data['users'][0], username='not-on-server'))
    old = source[1].pk
    source[1].delete()
    b = User.objects.create_user('transfer-b', password='target-only-password')
    assert b.pk != old
    extra = User.objects.create_user('server-only')
    UserRole.objects.create(user_id=str(extra.pk), role_code_id='TRANSFER-B')
    result = m.transfer(data, apply=True)
    assert result['missing_users'] == ['not-on-server']
    assert not UserRole.objects.filter(user_id=str(source[0].pk), is_active=True).exists()
    assert PermissionService.effective_permissions(str(b.pk)) == {'status.manage'}
    assert b.check_password('target-only-password')
    assert PermissionService.effective_permissions(str(extra.pk)) == {'status.manage'}


@pytest.mark.django_db
def test_conflicting_shared_role_blocks_before_any_write(source):
    m = module()
    data = dump(m, source)
    extra = User.objects.create_user('server-only')
    UserRole.objects.create(user_id=str(extra.pk), role_code_id='TRANSFER-A')
    RolePermission.objects.filter(role_code_id='TRANSFER-A').delete()
    before = m.backup_data()
    with pytest.raises(ValueError, match='пользовател'):
        m.transfer(data, apply=True)
    assert m.backup_data() == before


@pytest.mark.django_db
def test_invalid_data_and_unknown_django_permission_are_atomic(source):
    m = module()
    data = dump(m, source)
    data['users'][1]['permissions'].append(['missing-app', 'missing-model', 'missing-permission'])
    before = m.backup_data()
    with pytest.raises(ValueError):
        m.transfer(data, apply=True)
    assert m.backup_data() == before
    duplicate = dump(m, source)
    duplicate['users'].append(copy.deepcopy(duplicate['users'][0]))
    with pytest.raises(ValueError):
        m.transfer(duplicate, apply=True)
    assert m.backup_data() == before


@pytest.mark.django_db
def test_temporary_grants_block_exact_transfer(source):
    m = module()
    data = dump(m, source)
    TemporaryDutyPermission.objects.create(user_id=str(source[0].pk), duty_role_code='x',
        starts_at=timezone.now(), ends_at=timezone.now()+timezone.timedelta(days=1), created_by='test')
    with pytest.raises(ValueError, match='временн'):
        m.export_data([source[0].username])
    with pytest.raises(ValueError, match='временн'):
        m.transfer(data, apply=True)


@pytest.mark.django_db
def test_restore_retains_original_scopes_and_flags(source):
    m = module()
    before = m.backup_data()
    data = dump(m, source)
    m.transfer(data, apply=True)
    m.restore(before)
    assert before == m.backup_data()


@pytest.mark.django_db
def test_backup_failure_prevents_changes_and_new_catalogs_are_created(source):
    m = module()
    data = dump(m, source)
    data['roles'].append({'code': 'TRANSFER-NEW', 'name': 'New role', 'description': '',
                              'is_active': True, 'permissions': ['personnel.view']})
    data['users'][0]['roles'] = [{'code': 'TRANSFER-NEW', 'is_active': True}]
    before = m.backup_data()
    def fail(_):
        raise OSError('disk full')
    with pytest.raises(OSError):
        m.transfer(data, apply=True, before_write=fail)
    assert before == m.backup_data()
    m.transfer(data, apply=True)
    assert PermissionService.effective_permissions(str(source[0].pk)) == {'personnel.view'}
    assert UserRole.objects.filter(user_id=str(source[0].pk)).get().role_code_id == 'TRANSFER-NEW'


@pytest.mark.django_db
def test_write_failure_rolls_back_flags_catalogs_and_grants(source, monkeypatch):
    m = module()
    data = dump(m, source)
    mutate(source)
    before = m.backup_data()
    def fail(*args, **kwargs):
        raise RuntimeError('audit unavailable')
    monkeypatch.setattr(m.audit, 'record', fail)
    with pytest.raises(RuntimeError):
        m.transfer(data, apply=True)
    assert before == m.backup_data()


@pytest.mark.django_db
def test_preview_counts_permissions_changed_via_role(source):
    m = module()
    data = dump(m, source)
    m.transfer(data, apply=True)
    RolePermission.objects.filter(role_code_id='TRANSFER-A').delete()
    preview = m.transfer(data)
    assert preview['changed_users'] == 1
    assert preview['changed_roles'] == 1
    assert preview['changed_assignments'] == 0


@pytest.mark.django_db
def test_missing_users_incompatible_permissions_are_skipped(source):
    m = module()
    data = dump(m, source)
    data['users'].append(dict(data['users'][0], username='not-on-server',
                             permissions=[['unknown', 'model', 'permission']]))
    result = m.transfer(data, apply=True)
    assert result['missing_users'] == ['not-on-server']


@pytest.mark.django_db
def test_restore_removes_new_role_permission_and_group(source):
    m = module()
    before = m.backup_data()
    data = dump(m, source)
    data['roles'].append({'code':'NEW-RESTORE','name':'New','description':'','is_active':True,
                          'permissions':['new.restore.permission']})
    data['permissions'].append({'code':'new.restore.permission','name':'New','description':'','is_active':True})
    data['groups'].append({'name':'NewRestoreGroup','permissions':[]})
    data['users'][0]['roles']=[{'code':'NEW-RESTORE','is_active':True}]
    data['users'][0]['groups']=['NewRestoreGroup']
    m.transfer(data, apply=True)
    m.restore(before)
    assert m.backup_data() == before
