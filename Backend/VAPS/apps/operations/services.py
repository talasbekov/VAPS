from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.clock import Clock
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.rbac.models import (
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
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
    def _active_grants(cls, user_id) -> list:
        """``(scope_division_id, role_code)`` pairs from BOTH grant sources —
        active role assignments and active (time-windowed) temporary duties.
        The single enumeration behind ``effective_permissions`` AND
        ``visible_division_ids``: the point-check and the visibility
        resolution read the same grants by construction, not by convention.
        """
        grants = [
            (ur.scope_division_id, ur.role_code_id)
            for ur in OpsUserRoleSelector.active_for_user(user_id)
        ]
        now = Clock.now()
        active_duties = TemporaryDutyPermission.objects.filter(
            user_id=user_id, is_active=True, starts_at__lte=now, ends_at__gte=now
        )
        grants += [(d.scope_division_id, d.duty_role_code) for d in active_duties]
        return grants

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        matching_role_codes = [
            role_code
            for scope_division_id, role_code in cls._active_grants(user_id)
            if cls._scope_matches(scope_division_id, division_id)
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

    @classmethod
    def visible_division_ids(cls, user_id, permission_code):
        """The INVERSE question to ``has_permission`` for list selectors
        (architecture.md#L451): which divisions may this user see under
        ``permission_code``? Returns ``None`` for global visibility (an
        unscoped grant or the ADMIN wildcard) or a set of division ids —
        empty when no grant carries the code (fail-closed on its own, even
        though the view's coarse gate rejects non-holders earlier).

        Shares ``_active_grants`` with ``effective_permissions`` — the
        point-check and the visibility resolution cannot drift because they
        enumerate the same grants. One call feeds one ``division_id__in`` —
        never call per division in a loop; one adjacency scan covers all
        scoped grants (``children_map`` reuse).
        """
        grants = cls._active_grants(user_id)
        if not grants:
            return set()

        holding_roles = set(
            RolePermission.objects.filter(
                role_code_id__in={code for _, code in grants},
                permission_code_id__in=[permission_code, WILDCARD],
            ).values_list("role_code_id", flat=True)
        )
        visible = set()
        children_map = None
        for scope_division_id, role_code in grants:
            if role_code not in holding_roles:
                continue
            if scope_division_id is None:
                return None
            if children_map is None:
                children_map = CoreDivisionTreeSelector.children_map()
            visible |= CoreDivisionTreeSelector.subtree_ids(
                scope_division_id, children_map=children_map
            )
        return visible


class RoleAdminService:
    """Write-side wrappers for RBAC administration."""

    @staticmethod
    @transaction.atomic
    def assign_role(user_id, role_code, scope_division_id=None, *, actor: str):
        # Blank actor would blur the "NULL = honestly actorless" convention.
        if not actor or not actor.strip():
            raise ValidationError("actor must be a non-empty string")
        # created_by records who created the ROW (append-once): reactivating
        # an existing assignment must not rewrite the original creator, hence
        # create_defaults (Django 5.0+), not defaults.
        user_role, _ = UserRole.objects.update_or_create(
            user_id=user_id,
            role_code_id=role_code,
            scope_division_id=scope_division_id,
            defaults={"is_active": True},
            create_defaults={"is_active": True, "created_by": actor},
        )
        return user_role

    @staticmethod
    @transaction.atomic
    def revoke_role(user_id, role_code, scope_division_id=None):
        UserRole.objects.filter(
            user_id=user_id, role_code_id=role_code, scope_division_id=scope_division_id
        ).update(is_active=False)

    @staticmethod
    @transaction.atomic
    def grant_temporary_duty(
        *,
        user_id,
        duty_role_code,
        starts_at,
        ends_at,
        created_by,
        employee_id=None,
        scope_division_id=None,
        event_id=None,
    ):
        grant = TemporaryDutyPermission(
            user_id=user_id,
            duty_role_code=duty_role_code,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=created_by,
            employee_id=employee_id,
            scope_division_id=scope_division_id,
            event_id=event_id,
        )
        grant.full_clean()
        grant.save()
        return grant

    @staticmethod
    @transaction.atomic
    def expire_temporary_duty(grant_id):
        TemporaryDutyPermission.objects.filter(id=grant_id).update(is_active=False)
