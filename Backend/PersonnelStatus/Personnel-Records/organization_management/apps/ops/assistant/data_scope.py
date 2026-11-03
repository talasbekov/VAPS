"""Read-only authority, retaining temporary event boundaries and permission scopes.

Central grants are never changed. Event-specific temporary grants are deliberately
not promoted to general personnel/status access by the assistant.
"""
import hashlib
import json
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Role, TemporaryDutyPermission
from organization_management.apps.operations.selectors import OpsUserRoleSelector, DivisionTreeSelector
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.divisions.models import Division


class DataAuthority:
    def __init__(self, request):
        self.user = request.user
        self.actor = resolve_actor_id(request)
        topology = list(Division.objects.order_by('pk').values_list('id', 'parent_id', 'division_type'))
        parent_tree={pk:(parent,kind) for pk,parent,kind in topology}
        self.tree={}
        for pk,parent,kind in topology:
            self.tree.setdefault(parent,[]).append(pk)
        self.base = [(g.scope_division_id, g.role_code_id) for g in OpsUserRoleSelector.active_for_user(self.actor)]
        now = Clock.now()
        temporary = list(TemporaryDutyPermission.objects.filter(user_id=self.actor, is_active=True,
            starts_at__lte=now, ends_at__gte=now, duty_role_code__in=Role.objects.filter(is_active=True).values('code'))
            .order_by('pk').values_list('scope_division_id', 'duty_role_code', 'event_id', 'starts_at', 'ends_at'))
        self.base += [(scope, code) for scope, code, event, start, end in temporary if event is None]
        self.base += PermissionService.derived_grants(self.base,tree=parent_tree)
        self.events = {}
        for scope, code, event, start, end in temporary:
            if event is not None:
                self.events.setdefault(event, []).append((scope, code))
        for key in self.events:
            self.events[key] += PermissionService.derived_grants(self.events[key],tree=parent_tree)
        self.role_permissions = {}
        for role, code in PermissionService._active_role_permissions().values_list('role_code_id', 'permission_code_id'):
            self.role_permissions.setdefault(role, set()).add(code)
        self.stamp = hashlib.sha256(json.dumps([self.actor, sorted(self.base, key=str), temporary,
            sorted((code, sorted(values)) for code, values in self.role_permissions.items()), topology], default=str).encode()).hexdigest()

    def grants(self, permission, event_id=None):
        pairs = self.base + self.events.get(event_id, [])
        return [(scope, role) for scope, role in pairs
                if {permission, '*'} & self.role_permissions.get(role, set())]

    def has(self, permission, event_id=None):
        return bool(self.grants(permission, event_id))

    def scope(self, permission, event_id=None):
        result = set()
        for scope, role in self.grants(permission, event_id):
            if scope is None:
                return None
            result |= DivisionTreeSelector.subtree_ids(scope, children_map=self.tree)
        return result

    def intersection(self, *permissions):
        result = None
        for permission in permissions:
            scope = self.scope(permission)
            if scope is not None:
                result = set(scope) if result is None else result & scope
        return result

    def event_ids(self, permission):
        return {key for key, grants in self.events.items()
                if any({permission, '*'} & self.role_permissions.get(role, set()) for scope, role in grants)}
