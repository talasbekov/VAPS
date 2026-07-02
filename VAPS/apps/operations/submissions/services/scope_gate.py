"""Story 5.8a — division-scope gate for the submissions API («scope в сервисе»).

Lives in the service LAYER, deliberately OUTSIDE submit_day/amend_day: the
domain services keep their 5.3b/5.4a permission-free contracts (a bare actor
string, no RBAC seed in their tests), and the system path — the 5.4b
enforcement hook calling amend_day with no HTTP actor — must never hit a
permission gate. The API view calls this guard between form validation and
the domain service; 5.8b/6.10 reuse it for their write endpoints.
"""

import uuid

from apps.core.exceptions import DomainError
from apps.operations.services import PermissionService


def ensure_division_scope(actor, permission_code, division_id):
    """Raise 403 unless *actor* holds *permission_code* for *division_id*.

    The check is subtree-aware: a role scoped to a division grants its whole
    subtree (``PermissionService._scope_matches``); a global role (scope NULL)
    and the ADMIN ``*`` wildcard pass for any division.

    ``_scope_matches`` treats ``division_id=None`` as «scope does not narrow»
    (and a falsy ``""`` still passes for global roles) — the check would PASS
    without any division, so a guard called with a blank one would be a silent
    hole. A missing/blank division_id is therefore a caller bug and fails loud
    (mirror of notify()'s blank-recipient guard). A str division_id is
    normalized to UUID: subtree membership is type-sensitive (a set of UUIDs),
    so a raw string would silently 403 scoped roles while global ones pass.
    The API path can't hit either — the form serializer yields a UUID.
    """
    if not division_id:
        raise ValueError("ensure_division_scope requires a division_id")
    if not isinstance(division_id, uuid.UUID):
        # ValueError on garbage — the same fail-loud caller-bug contract.
        division_id = uuid.UUID(str(division_id))
    if not PermissionService.has_permission(
        actor, permission_code, division_id=division_id
    ):
        raise DomainError(
            "PERMISSION_DENIED", 403, detail={"division_id": str(division_id)}
        )
