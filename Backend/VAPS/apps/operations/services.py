from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.clock import Clock
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.models import RolePermission, TemporaryDutyPermission, UserRole
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

        now = Clock.now()
        active_duties = TemporaryDutyPermission.objects.filter(
            user_id=user_id, is_active=True, starts_at__lte=now, ends_at__gte=now
        )
        for duty in active_duties:
            if cls._scope_matches(duty.scope_division_id, division_id):
                matching_role_codes.append(duty.duty_role_code)

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
    def grant_temporary_duty(*, user_id, duty_role_code, starts_at, ends_at, created_by,
                             employee_id=None, scope_division_id=None, event_id=None):
        grant = TemporaryDutyPermission(
            user_id=user_id, duty_role_code=duty_role_code, starts_at=starts_at,
            ends_at=ends_at, created_by=created_by, employee_id=employee_id,
            scope_division_id=scope_division_id, event_id=event_id,
        )
        grant.full_clean()
        grant.save()
        return grant

    @staticmethod
    @transaction.atomic
    def expire_temporary_duty(grant_id):
        TemporaryDutyPermission.objects.filter(id=grant_id).update(is_active=False)
