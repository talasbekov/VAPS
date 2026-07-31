import uuid

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.rbac.models import (
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
from apps.operations.selectors import OpsUserRoleSelector

WILDCARD = "*"

# Story 15.11b (FR-34, "ОРГД read-only"): a role_code whose read-only
# restriction applies ONLY when granted through a temporary duty window,
# never a permanent UserRole. ORGD staff have full (mutate-capable)
# permissions permanently; FR-34's "read-only" clause is specifically about
# the URGENT/temporary duty path, not the standing role.
_DUTY_READ_ONLY_ROLE_CODES = {"ORGD"}


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
        """``(scope_division_id, role_code, source)`` triples from BOTH grant
        sources — active role assignments (``source="role"``) and active
        (time-windowed) temporary duties (``source="duty"``). The single
        enumeration behind ``effective_permissions`` AND
        ``visible_division_ids``: the point-check and the visibility
        resolution read the same grants by construction, not by convention.

        ``source`` exists for FR-34's "ОРГД read-only" (15.11b): the same
        role_code can arrive via either path, and only the ``duty`` path is
        restricted — see ``_duty_only_role_codes``.
        """
        grants = [
            (ur.scope_division_id, ur.role_code_id, "role")
            for ur in OpsUserRoleSelector.active_for_user(user_id)
        ]
        now = Clock.now()
        active_duties = TemporaryDutyPermission.objects.filter(
            user_id=user_id, is_active=True, starts_at__lte=now, ends_at__gte=now
        )
        grants += [
            (d.scope_division_id, d.duty_role_code, "duty") for d in active_duties
        ]
        return grants

    @staticmethod
    def _duty_only_role_codes(grants) -> set:
        """role_codes present in *grants* EXCLUSIVELY via the ``"duty"``
        source (never also via a permanent ``"role"`` grant) — the set FR-34's
        read-only restriction may apply to. A user holding BOTH a permanent
        ORGD role and a temporary ORGD duty grant keeps full permissions:
        the temporary grant must never downgrade an already-standing one.
        """
        sources_by_role = {}
        for _, role_code, source in grants:
            sources_by_role.setdefault(role_code, set()).add(source)
        return {
            role_code
            for role_code, sources in sources_by_role.items()
            if sources == {"duty"}
        }

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        grants = cls._active_grants(user_id)
        matching_role_codes = {
            role_code
            for scope_division_id, role_code, _source in grants
            if cls._scope_matches(scope_division_id, division_id)
        }
        if not matching_role_codes:
            return set()
        read_only_role_codes = (
            cls._duty_only_role_codes(grants) & _DUTY_READ_ONLY_ROLE_CODES
        )
        result = set()
        for role_code, permission_code in RolePermission.objects.filter(
            role_code_id__in=matching_role_codes
        ).values_list("role_code_id", "permission_code_id"):
            if (
                role_code in read_only_role_codes
                and permission_code != WILDCARD
                and not permission_code.endswith(".view")
            ):
                continue
            result.add(permission_code)
        return result

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

        Story 15.11b: a role_code restricted to ``.view``-only via
        ``_duty_only_role_codes`` (FR-34's duty-ORGD read-only) is excluded
        from ``holding_roles`` when *permission_code* itself is a mutating
        (non-``.view``) code — kept consistent with ``effective_permissions``
        so a duty-ORGD holder never sees a "visible for mutation" division
        their ``has_permission`` check would then reject.
        """
        grants = cls._active_grants(user_id)
        if not grants:
            return set()

        holding_roles = set(
            RolePermission.objects.filter(
                role_code_id__in={code for _, code, _source in grants},
                permission_code_id__in=[permission_code, WILDCARD],
            ).values_list("role_code_id", flat=True)
        )
        if permission_code != WILDCARD and not permission_code.endswith(".view"):
            holding_roles -= (
                cls._duty_only_role_codes(grants) & _DUTY_READ_ONLY_ROLE_CODES
            )
        visible = set()
        children_map = None
        for scope_division_id, role_code, _source in grants:
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
        record(
            actor=created_by,
            action="TEMP_DUTY_GRANTED",
            entity_type="temporary_duty_permission",
            entity_id=uuid.UUID(int=grant.pk),
            new_value={
                "user_id": grant.user_id,
                "duty_role_code": grant.duty_role_code,
                "starts_at": grant.starts_at.isoformat(),
                "ends_at": grant.ends_at.isoformat(),
                "scope_division_id": str(grant.scope_division_id)
                if grant.scope_division_id
                else None,
                "event_id": str(grant.event_id) if grant.event_id else None,
            },
        )
        return grant

    @staticmethod
    @transaction.atomic
    def expire_temporary_duty(grant_id, *, actor):
        # Idempotent audit: only a REAL is_active True→False transition is
        # worth a row (mirrors notify.mark_read's "first call wins" — a
        # repeat expire() on an already-gone/already-expired grant is a
        # no-op, not a second audit entry for nothing).
        updated = TemporaryDutyPermission.objects.filter(
            id=grant_id, is_active=True
        ).update(is_active=False)
        if updated:
            record(
                actor=actor,
                action="TEMP_DUTY_EXPIRED",
                entity_type="temporary_duty_permission",
                entity_id=uuid.UUID(int=int(grant_id)),
                new_value={"is_active": False},
            )
