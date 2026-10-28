"""Read-only explanation of the same grants used by PermissionService."""
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Role, UserRole, TemporaryDutyPermission
from organization_management.apps.operations.services import LegacyRoleSync, PermissionService

def account_effective_access(user):
    actor = LegacyRoleSync.actor_id_for_user(user)
    now = Clock.now()
    grants = sorted(set(PermissionService._active_grants(actor, at=now)), key=lambda row: (row[1], row[0] or 0))
    roles = {row.code: row.name for row in Role.objects.filter(code__in=[code for _, code in grants])}
    scopes = dict(Division.objects.filter(pk__in=[scope for scope, _ in grants if scope is not None]).values_list("pk", "name"))
    assigned = set(UserRole.objects.filter(user_id=actor, is_active=True, role_code__is_active=True).values_list("scope_division_id", "role_code_id"))
    temporary = {}
    for row in TemporaryDutyPermission.objects.filter(user_id=actor, is_active=True, starts_at__lte=now, ends_at__gte=now, duty_role_code__in=roles):
        temporary.setdefault((row.scope_division_id, row.duty_role_code), []).append(row.ends_at.isoformat())
    permissions = {}
    for row in PermissionService._active_role_permissions().filter(role_code_id__in=roles).select_related("permission_code"):
        permissions.setdefault(row.role_code_id, []).append({"code":row.permission_code_id, "name":row.permission_code.name})
    effective = {row["code"] for _, code in grants for row in permissions.get(code, [])}
    global_permissions = {row["code"] for scope, code in grants if scope is None for row in permissions.get(code, [])}
    return {
        "userId": user.pk, "isActive": user.is_active, "checkedAt": now.isoformat(),
        "permissions": sorted(effective) if user.is_active else [],
        "globalPermissions": sorted(global_permissions) if user.is_active else [],
        "grants": [{
            "roleCode":code, "roleName":roles.get(code, code),
            "scopeDivisionId":scope, "scopeName":scopes.get(scope, str(scope)) if scope is not None else "Вся служба",
            "sources": (["permanent"] if (scope, code) in assigned else []) + (["temporary"] if (scope, code) in temporary else []) or ["derived"],
            "temporaryEndsAt": sorted(temporary.get((scope, code), [])),
            "permissions": sorted(permissions.get(code, []), key=lambda value:value["code"]),
        } for scope, code in grants],
        "scopeNotice": "Область применяется по правилам конкретного раздела. Право event.view открывает общий реестр ОМ; полномочия по назначению в мероприятии проверяются отдельно.",
    }

