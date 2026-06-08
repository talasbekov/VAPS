from apps.operations.models import RolePermission
from apps.operations.selectors import OpsUserRoleSelector

WILDCARD = "*"


class PermissionService:
    """Stateless authorization resolution (spec §1254). All checks go through here."""

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        user_roles = OpsUserRoleSelector.active_for_user(user_id)
        if not user_roles:
            return set()
        role_codes = [ur.role_code_id for ur in user_roles]
        perms = set(
            RolePermission.objects.filter(role_code_id__in=role_codes).values_list(
                "permission_code_id", flat=True
            )
        )
        return perms

    @classmethod
    def has_permission(cls, user_id, permission_code, division_id=None) -> bool:
        perms = cls.effective_permissions(user_id, division_id=division_id)
        if WILDCARD in perms:
            return True
        return permission_code in perms
