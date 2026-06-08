from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.models import RolePermission
from apps.operations.selectors import OpsUserRoleSelector

WILDCARD = "*"


class PermissionService:
    """Stateless authorization resolution (spec §1254). All checks go through here."""

    @staticmethod
    def _scope_matches(scope_division_id, division_id) -> bool:
        if scope_division_id is None:
            return True
        if division_id is None:
            # Scope only narrows division-specific checks; global checks still pass.
            return True
        return division_id in CoreDivisionTreeSelector.subtree_ids(scope_division_id)

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        user_roles = OpsUserRoleSelector.active_for_user(user_id)
        matching_role_codes = [
            ur.role_code_id
            for ur in user_roles
            if cls._scope_matches(ur.scope_division_id, division_id)
        ]
        if not matching_role_codes:
            return set()
        return set(
            RolePermission.objects.filter(
                role_code_id__in=matching_role_codes
            ).values_list("permission_code_id", flat=True)
        )

    @classmethod
    def has_permission(cls, user_id, permission_code, division_id=None) -> bool:
        perms = cls.effective_permissions(user_id, division_id=division_id)
        if WILDCARD in perms:
            return True
        return permission_code in perms
