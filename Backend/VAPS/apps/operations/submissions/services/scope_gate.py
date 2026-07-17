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


def ensure_own_submission(actor, submission):
    """Raise 403 unless *actor* is the literal author of *submission* (10.8).

    A deliberately NARROWER check than ``ensure_division_scope``: the division
    gate admits any holder of the permission over the subtree («any в scope»),
    while the personal export is the author's own proof of submission — so the
    criterion is ``submitted_by == actor``, nothing wider (Q2 decision: the
    literal epics reading «у МЕНЯ есть личное доказательство»). Called AFTER
    the division-scope guard (AC-2): a foreign-subtree 403 stays primary and
    keeps carrying the division_id detail; this one fires on «своё поддерево,
    чужой автор» and carries the submission_id instead.

    A blank actor is a caller bug (the API path always has one — the mixin
    rejects anonymous requests first) and fails loud, mirror of
    ``ensure_division_scope``'s blank-division guard.
    """
    if not actor:
        raise ValueError("ensure_own_submission requires an actor")
    if submission.submitted_by != actor:
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"submission_id": str(submission.pk)},
            message="Экспорт доступен только автору сдачи.",
        )
