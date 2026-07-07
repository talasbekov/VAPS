"""Story 4.3 — the SINGLE audit write point.

architecture.md §Communication Patterns: "Аудит: единый сервис записи …
MUST NOT: raw insert в аудит-таблицу." Every audit row goes through ``record()``;
no module outside ``apps/audit`` may import ``apps.audit.models`` to write
(enforced by the AST boundary test, ``test_audit_write_boundary``).

``request_id`` / ``ip_address`` / ``user_agent`` are NOT parameters — they are
request-scoped infrastructure read from the request-context contextvar
(architecture.md §Service Patterns: "request_id: middleware → contextvar;
аудит-сервис читает сам"). ``created_at`` flows through ``Clock.now()``, the one
controllable clock (ARCH-DATA-022), never ``auto_now_add``.

The row is written in the CALLER's ambient transaction (synchronous-on-mutation,
E3 retro): if the mutation rolls back, its audit row rolls back with it — we
audit SUCCESSFUL mutations. ``record()`` does NOT open its own transaction.
"""

from apps.audit.models import AuditLog
from apps.core.clock import Clock
from apps.core.middleware import get_request_context

# audit_logs.ip_address is NOT NULL (§4.6). System-initiated events (catch-up,
# COMPLETED/APPLIED with actor=SYSTEM) have no client IP — record a sentinel.
_SYSTEM_IP = "0.0.0.0"


def record(
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id,
    old_value=None,
    new_value=None,
    reason: str = "",
) -> AuditLog:
    """Append one ``AuditLog`` row and return it.

    ``actor`` is the authenticated actor id (string) the calling service already
    holds — never read from the request here (the identity header is read only
    by core/auth, ARCH-SEC-030). ``action`` is an UPPER_SNAKE code from
    ``docs/registries/audit-events.yaml``; the closed world is enforced by tests
    (the audit-coverage test, 4.6), not at runtime.
    """
    if not actor:
        raise ValueError("audit.record requires a non-empty actor")
    ctx = get_request_context()
    return AuditLog.objects.create(
        actor_user_id=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        request_id=ctx.request_id,
        ip_address=ctx.ip_address or _SYSTEM_IP,
        user_agent=ctx.user_agent,
        created_at=Clock.now(),
    )


def record_many(entries):
    """Append many ``AuditLog`` rows in ONE bulk INSERT (story 4.4).

    A bulk mutation (e.g. ``bulk_create_statuses``) writes N domain rows in one
    query (NFR-4: constant query count); auditing it must not degrade into N
    INSERTs. ``record_many`` reads the request context + ``Clock.now()`` ONCE and
    bulk-creates all rows. Same contract as ``record()``: the caller's ambient
    transaction, no runtime registry validation, request-infra from the contextvar.

    ``entries``: an iterable of dicts with keys ``actor``, ``action``,
    ``entity_type``, ``entity_id`` and optional ``old_value``/``new_value``/
    ``reason``. Returns the created rows (empty list for empty input).
    """
    entries = list(entries)
    if not entries:
        return []
    ctx = get_request_context()
    ip_address = ctx.ip_address or _SYSTEM_IP
    created_at = Clock.now()
    rows = []
    for entry in entries:
        actor = entry["actor"]
        if not actor:
            raise ValueError(
                "audit.record_many requires a non-empty actor in every entry"
            )
        rows.append(
            AuditLog(
                actor_user_id=actor,
                action=entry["action"],
                entity_type=entry["entity_type"],
                entity_id=entry["entity_id"],
                old_value=entry.get("old_value"),
                new_value=entry.get("new_value"),
                reason=entry.get("reason", ""),
                request_id=ctx.request_id,
                ip_address=ip_address,
                user_agent=ctx.user_agent,
                created_at=created_at,
            )
        )
    return AuditLog.objects.bulk_create(rows)
