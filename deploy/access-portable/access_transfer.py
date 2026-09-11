"""Per-account access snapshot; runs inside existing Django (Plane1193)."""
import json

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.models import Permission as AuthPermission
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.utils import timezone
from organization_management.apps.operations import audit_service as audit
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)

FLAGS = ('is_active', 'is_staff', 'is_superuser')
ACTOR = 'portable-access:1193'
FORMAT = 'smart-josparlau-access-v1-global'


def lock_access():
    # Serialize administrative writes while retaining ordinary SELECT access.
    if connection.vendor != 'postgresql':
        raise ValueError('Нужен PostgreSQL.')
    models = [get_user_model(), Group, Role, Permission, RolePermission, UserRole,
              TemporaryDutyPermission, Group.permissions.through,
              get_user_model().groups.through, get_user_model().user_permissions.through]
    tables = sorted({connection.ops.quote_name(m._meta.db_table) for m in models})
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout = '10s'")
        cursor.execute('LOCK TABLE ' + ', '.join(tables) + ' IN SHARE ROW EXCLUSIVE MODE')


def no_temporary(ids):
    if TemporaryDutyPermission.objects.filter(user_id__in=ids, is_active=True,
                                              ends_at__gt=timezone.now()).exists():
        raise ValueError('Есть действующие или будущие временные полномочия; точный перенос остановлен.')


def auth_keys(manager):
    return sorted([list(x) for x in manager.values_list(
        'content_type__app_label', 'content_type__model', 'codename')])


@transaction.atomic
def export_data(usernames=None):
    lock_access()
    users = get_user_model().objects.order_by('username')
    if usernames is not None:
        users = users.filter(username__in=usernames)
    users = list(users)
    no_temporary([str(u.pk) for u in users])
    records = []
    used_roles, used_groups = set(), set()
    for u in users:
        grants = {}
        for r in UserRole.objects.filter(user_id=str(u.pk)):
            grants[r.role_code_id] = grants.get(r.role_code_id, False) or r.is_active
        groups = list(u.groups.order_by('name').values_list('name', flat=True))
        records.append(dict(username=u.get_username(), **{k: getattr(u, k) for k in FLAGS},
                            roles=[{'code': c, 'is_active': a} for c, a in sorted(grants.items())],
                            groups=groups, permissions=auth_keys(u.user_permissions)))
        used_roles.update(grants)
        used_groups.update(groups)
    roles = []
    for r in Role.objects.filter(pk__in=used_roles).order_by('code'):
        roles.append({'code': r.code, 'name': r.name, 'description': r.description, 'is_active': r.is_active,
                          'permissions': sorted(r.role_permissions.values_list('permission_code_id', flat=True))})
    permissions = list(Permission.objects.filter(permission_roles__role_code_id__in=used_roles)
                       .distinct().order_by('code').values('code', 'name', 'description', 'is_active'))
    groups = [{'name': g.name, 'permissions': auth_keys(g.permissions)}
              for g in Group.objects.filter(name__in=used_groups).order_by('name')]
    return {'format': FORMAT, 'users': records, 'roles': roles, 'permissions': permissions, 'groups': groups}


def backup_data():
    """Same-database recovery snapshot, excludes passwords and personal fields."""
    users = [dict(id=u.pk, username=u.get_username(), **{k: getattr(u, k) for k in FLAGS},
                  groups=list(u.groups.order_by('pk').values_list('pk', flat=True)),
                  permissions=list(u.user_permissions.order_by('pk').values_list('pk', flat=True)))
             for u in get_user_model().objects.order_by('pk')]
    data = {'format': 'smart-josparlau-access-backup-v1', 'users': users,
            'database': connection.settings_dict['NAME']}
    for key, model in [('roles', Role), ('permissions', Permission),
                       ('role_permissions', RolePermission), ('user_roles', UserRole), ('groups', Group)]:
        data[key] = list(model.objects.order_by('pk').values())
    data['group_permissions'] = list(Group.permissions.through.objects.order_by('pk').values())
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def unique(items, key):
    result = {}
    for item in items:
        value = item[key]
        if not isinstance(value, str) or not value or value in result:
            raise ValueError('Пустой/повторный ключ в выгрузке: ' + key)
        result[value] = item
    return result


def validate(data):
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise ValueError('Неверный формат выгрузки прав.')
    users = unique(data['users'], 'username')
    roles = unique(data['roles'], 'code')
    perms = unique(data['permissions'], 'code')
    groups = unique(data['groups'], 'name')
    for record in list(users.values()) + list(roles.values()) + list(perms.values()):
        for key in (FLAGS if 'username' in record else ('is_active',)):
            if type(record[key]) is not bool:
                raise ValueError('Флаги должны быть true/false.')
    for role in roles.values():
        if not set(role['permissions']) <= perms.keys():
            raise ValueError('Роль ссылается на отсутствующее право.')
    auth = {tuple(k): pk for *k, pk in AuthPermission.objects.values_list(
        'content_type__app_label', 'content_type__model', 'codename', 'pk')}
    for u in users.values():
        grants = unique(u['roles'], 'code')
        if not grants.keys() <= roles.keys() or not set(u['groups']) <= groups.keys():
            raise ValueError('Учётка ссылается на отсутствующую роль/группу.')
        if any(type(r['is_active']) is not bool for r in grants.values()):
            raise ValueError('Неверный флаг назначения роли.')
    return users, roles, perms, groups, auth


def record(action, entity, key, old, new):
    audit.record(actor=ACTOR, action=action, entity_type=entity,
                 entity_key=str(key), old_value=old, new_value=new)


def sync_catalog(roles, perms, groups, auth):
    for code, p in perms.items():
        values = {k: p[k] for k in ('name', 'description', 'is_active')}
        old = Permission.objects.filter(pk=code).values(*values).first()
        if old != values:
            Permission.objects.update_or_create(pk=code, defaults=values)
            record(audit.ACCESS_PERMISSION_SAVED, audit.ENTITY_PERMISSION, code, old, values)
    for code, r in roles.items():
        values = {k: r[k] for k in ('name', 'description', 'is_active')}
        old = Role.objects.filter(pk=code).values(*values).first()
        if old != values:
            Role.objects.update_or_create(pk=code, defaults=values)
            record(audit.ACCESS_ROLE_SAVED, audit.ENTITY_ROLE, code, old, values)
        qs = RolePermission.objects.filter(role_code_id=code)
        before = set(qs.values_list('permission_code_id', flat=True))
        after = set(r['permissions'])
        if before != after:
            qs.exclude(permission_code_id__in=after).delete()
            RolePermission.objects.bulk_create([RolePermission(role_code_id=code, permission_code_id=p,
                                                               created_by=ACTOR) for p in sorted(after-before)])
            record(audit.ACCESS_ROLE_PERMISSIONS_CHANGED, audit.ENTITY_ROLE, code,
                   {'permissions': sorted(before)}, {'permissions': sorted(after)})
    for name, g in groups.items():
        group, _ = Group.objects.get_or_create(name=name)
        group.permissions.set([auth[tuple(k)] for k in g['permissions']])


def check_outside_conflicts(target_ids, roles, groups):
    # A shared definition must not silently change server-only accounts.
    outside_ids = [str(pk) for pk in get_user_model().objects.exclude(pk__in=target_ids).values_list('pk', flat=True)]
    outside = UserRole.objects.filter(user_id__in=outside_ids, is_active=True)
    outside_role_codes = set(outside.values_list('role_code_id', flat=True))
    outside_role_codes.update(TemporaryDutyPermission.objects.filter(user_id__in=outside_ids)
                             .filter(is_active=True, ends_at__gt=timezone.now())
                             .values_list('duty_role_code', flat=True))
    for code in outside_role_codes & roles.keys():
        current = set(RolePermission.objects.filter(role_code_id=code).values_list('permission_code_id', flat=True))
        if current != set(roles[code]['permissions']):
            raise ValueError('Изменение общей роли затронет пользователей вне выгрузки: ' + code)
    outside_users = get_user_model().objects.exclude(pk__in=target_ids)
    for name in outside_users.values_list('groups__name', flat=True).distinct():
        if name in groups and auth_keys(Group.objects.get(name=name).permissions) != sorted(groups[name]['permissions']):
            raise ValueError('Изменение общей группы затронет пользователей вне выгрузки: ' + name)


def user_state(u):
    return dict(**{k: getattr(u, k) for k in FLAGS}, groups=sorted(u.groups.values_list('name', flat=True)),
                permissions=auth_keys(u.user_permissions),
                roles=list(UserRole.objects.filter(user_id=str(u.pk)).order_by('role_code_id', 'scope_division_id', 'pk')
                           .values('role_code_id', 'scope_division_id', 'is_active')))


def catalog_changes(roles, perms, groups):
    changed_permissions = set()
    changed_roles = set()
    changed_groups = set()
    fields = ('name', 'description', 'is_active')
    for code, p in perms.items():
        if Permission.objects.filter(pk=code).values(*fields).first() != {k:p[k] for k in fields}:
            changed_permissions.add(code)
    for code, r in roles.items():
        actual = set(RolePermission.objects.filter(role_code_id=code).values_list('permission_code_id', flat=True))
        if (actual != set(r['permissions']) or set(r['permissions']) & changed_permissions
                or Role.objects.filter(pk=code).values(*fields).first() != {k:r[k] for k in fields}):
            changed_roles.add(code)
    for name, g in groups.items():
        current = Group.objects.filter(name=name).first()
        if current is None or auth_keys(current.permissions) != sorted(g['permissions']):
            changed_groups.add(name)
    return changed_roles, changed_groups, changed_permissions


@transaction.atomic
def transfer(data, apply=False, before_write=None):
    lock_access()
    users, roles, perms, groups, auth = validate(data)
    targets = list(get_user_model().objects.filter(username__in=users).order_by('username'))
    if not targets:
        raise ValueError('Ни один логин из выгрузки не найден на сервере.')
    selected = [users[u.get_username()] for u in targets]
    role_codes = {r['code'] for u in selected for r in u['roles']}
    group_names = {g for u in selected for g in u['groups']}
    roles = {k: v for k, v in roles.items() if k in role_codes}
    groups = {k: v for k, v in groups.items() if k in group_names}
    permission_codes = {p for r in roles.values() for p in r['permissions']}
    perms = {k: v for k, v in perms.items() if k in permission_codes}
    for entry in selected + list(groups.values()):
        for key in entry['permissions']:
            if not isinstance(key, list) or len(key) != 3 or tuple(key) not in auth:
                raise ValueError('В серверной схеме отсутствует Django-разрешение: ' + str(key))
    ids = [str(u.pk) for u in targets]
    no_temporary(ids)
    check_outside_conflicts(ids, roles, groups)
    missing = sorted(set(users)-{u.get_username() for u in targets})
    changes = []
    for u in targets:
        desired = users[u.get_username()]
        wanted = {k: desired[k] for k in FLAGS}
        wanted.update(groups=sorted(set(desired['groups'])), permissions=sorted(desired['permissions']),
                      roles=[{'role_code_id': r['code'], 'scope_division_id': None, 'is_active': r['is_active']}
                             for r in sorted(desired['roles'], key=lambda r:r['code'])])
        old = user_state(u)
        if old != wanted:
            changes.append((u, desired, old, wanted))
    changed_roles, changed_groups, changed_permissions = catalog_changes(roles, perms, groups)
    affected = {u.pk for u, *_ in changes}
    for u in targets:
        desired = users[u.get_username()]
        if (any(r['code'] in changed_roles for r in desired['roles'])
                or set(desired['groups']) & changed_groups):
            affected.add(u.pk)
    result = {'applied': False, 'matched': len(targets), 'missing_users': missing,
              'changed_users': len(affected), 'changed_assignments': len(changes),
              'changed_roles': len(changed_roles), 'changed_groups': len(changed_groups),
              'changed_permissions': len(changed_permissions),
              'roles': len(roles), 'without_division_scope': True}
    if not apply:
        return result
    backup = backup_data()
    if before_write:
        before_write(backup)
    sync_catalog(roles, perms, groups, auth)
    for u, desired, old, wanted in changes:
        for key in FLAGS:
            setattr(u, key, desired[key])
        u.save(update_fields=FLAGS)
        u.groups.set(Group.objects.filter(name__in=desired['groups']))
        u.user_permissions.set([auth[tuple(k)] for k in desired['permissions']])
        UserRole.objects.filter(user_id=str(u.pk)).delete()
        UserRole.objects.bulk_create([UserRole(user_id=str(u.pk), role_code_id=r['code'],
                                              is_active=r['is_active'], created_by=ACTOR)
                                      for r in desired['roles']])
        record(audit.ACCESS_ACCOUNT_SAVED, audit.ENTITY_ACCOUNT, u.pk, old, wanted)
    result.update(applied=True, backup=backup)
    return result


@transaction.atomic
def restore(data, before_write=None):
    """Explicit same-database rollback of a saved access snapshot (not passwords)."""
    lock_access()
    if data.get('format') != 'smart-josparlau-access-backup-v1' or data['database'] != connection.settings_dict['NAME']:
        raise ValueError('Резервный снимок относится к другой базе.')
    current_users = {u.pk: u.get_username() for u in get_user_model().objects.all()}
    if current_users != {u['id']: u['username'] for u in data['users']}:
        raise ValueError('Состав пользователей изменился: автоматический откат остановлен.')
    before = backup_data()
    if before_write:
        before_write(before)
    for key, model in [('permissions', Permission), ('roles', Role), ('groups', Group)]:
        for row in data[key]:
            pk = model._meta.pk.attname
            values = {k: v for k, v in row.items() if k != pk}
            model.objects.update_or_create(pk=row[pk], defaults=values)
    for key, model in [('role_permissions', RolePermission), ('user_roles', UserRole),
                       ('group_permissions', Group.permissions.through)]:
        model.objects.all().delete()
        with connection.cursor() as cursor:
            for row in data[key]:
                fields = {f.attname: f.column for f in model._meta.fields}
                columns = ','.join(connection.ops.quote_name(fields[k]) for k in row)
                slots = ','.join(['%s'] * len(row))
                cursor.execute(f'INSERT INTO {connection.ops.quote_name(model._meta.db_table)} ({columns}) VALUES ({slots})', list(row.values()))
    for entry in data['users']:
        u = get_user_model().objects.get(pk=entry['id'])
        old = user_state(u)
        get_user_model().objects.filter(pk=u.pk).update(**{k: entry[k] for k in FLAGS})
        u.groups.set(entry['groups'])
        u.user_permissions.set(entry['permissions'])
        record(audit.ACCESS_ACCOUNT_SAVED, audit.ENTITY_ACCOUNT, u.pk, old, {'restore': True})
    # Definitions introduced after the snapshot must not survive an explicit rollback.
    Group.objects.exclude(pk__in=[g['id'] for g in data['groups']]).delete()
    Role.objects.exclude(pk__in=[r['code'] for r in data['roles']]).delete()
    Permission.objects.exclude(pk__in=[p['code'] for p in data['permissions']]).delete()
    return {'applied': True, 'restored': len(data['users']), 'backup': before}
