import uuid

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.selectors import CoreDivisionTreeSelector
from apps.notifications.services import notify
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
        restricted — see ``_duty_read_only_scopes``.
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
    def _scope_covers(outer_scope_division_id, inner_scope_division_id) -> bool:
        """Does a grant scoped at *outer_scope_division_id* fully cover a
        grant scoped at *inner_scope_division_id*? ``None`` outer = global,
        covers anything. ``None`` inner (a global grant) is covered ONLY by
        another global (``None``) outer — a division-scoped grant can never
        cover a global one."""
        if outer_scope_division_id is None:
            return True
        if inner_scope_division_id is None:
            return False
        return inner_scope_division_id in CoreDivisionTreeSelector.subtree_ids(
            outer_scope_division_id
        )

    @classmethod
    def _duty_read_only_scopes(cls, grants) -> set:
        """``(scope_division_id, role_code)`` pairs — from *this user's*
        ``"duty"``-sourced grants in ``_DUTY_READ_ONLY_ROLE_CODES`` — that
        are NOT covered by any of the user's own ``"role"``-sourced grants
        of the same role_code (FR-34's "ОРГД read-only").

        Deliberately scope-aware, not merely "does this user hold the role
        code permanently ANYWHERE": a permanent ORGD assignment in one
        division must not exempt an unrelated temporary ORGD duty grant in
        a different division from the read-only restriction (review finding,
        15.11b — the naive per-user/per-role_code version leaked full
        mutate rights system-wide off a single unrelated permanent grant).
        A permanent grant only exempts a duty grant it actually covers
        (same division, an ancestor division, or itself global).
        """
        permanent_scopes = [
            (scope_division_id, role_code)
            for scope_division_id, role_code, source in grants
            if source == "role"
        ]
        restricted = set()
        for scope_division_id, role_code, source in grants:
            if source != "duty" or role_code not in _DUTY_READ_ONLY_ROLE_CODES:
                continue
            covered = any(
                perm_role_code == role_code
                and cls._scope_covers(perm_scope_division_id, scope_division_id)
                for perm_scope_division_id, perm_role_code in permanent_scopes
            )
            if not covered:
                restricted.add((scope_division_id, role_code))
        return restricted

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        grants = cls._active_grants(user_id)
        matching = [
            (scope_division_id, role_code)
            for scope_division_id, role_code, _source in grants
            if cls._scope_matches(scope_division_id, division_id)
        ]
        if not matching:
            return set()
        restricted_scopes = cls._duty_read_only_scopes(grants)
        perms_by_role = {}
        for role_code, permission_code in RolePermission.objects.filter(
            role_code_id__in={role_code for _, role_code in matching}
        ).values_list("role_code_id", "permission_code_id"):
            perms_by_role.setdefault(role_code, set()).add(permission_code)
        result = set()
        for scope_division_id, role_code in matching:
            codes = perms_by_role.get(role_code, set())
            if (scope_division_id, role_code) in restricted_scopes:
                codes = {c for c in codes if c == WILDCARD or c.endswith(".view")}
            result |= codes
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

        Story 15.11b: a specific ``(scope_division_id, role_code)`` duty
        grant restricted by ``_duty_read_only_scopes`` (FR-34's duty-ORGD
        read-only) contributes no divisions when *permission_code* itself is
        a mutating (non-``.view``) code — kept consistent with
        ``effective_permissions`` so a duty-ORGD holder never sees a
        "visible for mutation" division their ``has_permission`` check would
        then reject. Scope-aware per grant (not per role_code globally) —
        see ``_duty_read_only_scopes`` for why.
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
        is_write_permission = (
            permission_code != WILDCARD and not permission_code.endswith(".view")
        )
        restricted_scopes = (
            cls._duty_read_only_scopes(grants) if is_write_permission else set()
        )
        visible = set()
        children_map = None
        for scope_division_id, role_code, _source in grants:
            if role_code not in holding_roles:
                continue
            if (scope_division_id, role_code) in restricted_scopes:
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


def process_temp_duty_transitions():
    """Story 15.11c (FR-34): catch-up for the two boundaries a
    `TemporaryDutyPermission` window crosses — "started" and "ended".

    `PermissionService` already enforces the window live, per request
    (ARCH-SEC-031) — this function does NOT touch authorization. It closes
    two separate gaps: (1) `is_active` never auto-flips on `ends_at` without
    a manual `POST /expire`, and (2) `TEMP_PERMISSION_ACTIVE`/
    `TEMP_PERMISSION_EXPIRED` are registered in `ws-message-types.yaml` but
    had zero emitters anywhere in the codebase.

    Activation: a grant with `starts_at <= now <= ends_at` and
    `activated_notified_at IS NULL` gets notified once and marked — the
    ONLY idempotency signal available for this direction, since nothing
    else about the row changes when it merely "becomes" active.

    Expiry: reuses `RoleAdminService.expire_temporary_duty(actor="SYSTEM")`
    literally (15.11a) rather than re-implementing the `is_active` flip —
    its own `is_active=True` filter is already the idempotency guard for
    this direction, and it already writes the `TEMP_DUTY_EXPIRED` audit row.
    A grant that expires before ever being caught by the activation branch
    (e.g. the first catch-up run after a long gap) is expired without ever
    receiving a `TEMP_PERMISSION_ACTIVE` notification — not a bug, just a
    boundary the "activation" signal never crossed while being watched.

    Per-grant (not digest, unlike 15.10's `escalate_stale_force_requests`):
    the registry's `recipients: "duty user"` means the grant holder
    themselves, not a role-wide audience, so `notify()`'s
    `(recipient, kind, business_date)` collision is a rare, accepted edge
    (two grants for the same user activating/expiring the same day) — see
    the story's Out of Scope.

    Returns `{"activated": [...], "expired": [...]}` — the two lists of
    `TemporaryDutyPermission` rows touched this run.
    """
    now = Clock.now()
    today = Clock.today_local()

    activating = list(
        TemporaryDutyPermission.objects.filter(
            is_active=True,
            activated_notified_at__isnull=True,
            starts_at__lte=now,
            ends_at__gte=now,
        )
    )
    activated = []
    for grant in activating:
        result = notify(
            recipient=grant.user_id,
            kind="TEMP_PERMISSION_ACTIVE",
            business_date=today,
            payload={
                "grant_id": grant.pk,
                "duty_role_code": grant.duty_role_code,
                "ends_at": grant.ends_at.isoformat(),
            },
        )
        if result is not None:
            TemporaryDutyPermission.objects.filter(pk=grant.pk).update(
                activated_notified_at=now
            )
            activated.append(grant)

    expiring = list(
        TemporaryDutyPermission.objects.filter(is_active=True, ends_at__lt=now)
    )
    expired = []
    for grant in expiring:
        RoleAdminService.expire_temporary_duty(grant.pk, actor="SYSTEM")
        result = notify(
            recipient=grant.user_id,
            kind="TEMP_PERMISSION_EXPIRED",
            business_date=today,
            payload={"grant_id": grant.pk, "duty_role_code": grant.duty_role_code},
        )
        if result is not None:
            expired.append(grant)

    return {"activated": activated, "expired": expired}
