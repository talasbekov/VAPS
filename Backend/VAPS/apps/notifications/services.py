"""Story 5.7a — emit a notification (idempotent, in the caller's transaction).

``notify()`` is the single write-primitive behind FR-13. It writes synchronously
inside the caller's transaction (Review D1 → variant B): the row is visible at
once, ``notify()`` returns it, and a rolled-back business transaction takes the
notification with it (no phantom — via the insert's own rollback, not a discarded
commit hook). Idempotent on ``(recipient, kind, business_date)`` via
``get_or_create`` — a repeat call (or a concurrent race) is a no-op, never a raw
``IntegrityError`` (``get_or_create`` absorbs the ``UniqueConstraint`` hit inside
its own savepoint, so it never poisons the enclosing transaction — lesson 5.6b).

Emission is a non-fatal side-channel (Review D2): a blank ``recipient`` is a
programming error and raises loudly, but any infrastructure failure (DB down,
serialization) is logged and swallowed so a notification never breaks an
already-valid business operation.

Story 11.2 — WS delivery (FR-35). A newly created row is ALSO announced on the
websocket, and the split is the whole point: the DB write stays synchronous and
inside the caller's transaction (variant B, unchanged), while the ``group_send``
is registered through ``transaction.on_commit`` — so a rolled-back business
transaction cannot emit a signal about a row that will never exist. The non-fatal
contract extends to this branch verbatim: an unreachable channel layer is logged
and swallowed, and it can NEVER change what ``notify()`` returns — the caller
(``lagging_check``) reads that return value to decide whether to roll a whole day
back.

Scope (5.7a/11.2): the write-primitive plus its WS signal. Lagging detection and
recipient resolution are Story 5.7b; the read-API is 5.7c; the WS client is 11.3;
the notification centre UI and mark-as-read are 11.4. The WS kill-switch landed
in 11.5: ``settings.VAPS_WS_ENABLED=0`` silences ``_publish`` entirely (see its
docstring) while leaving the row, the return value and the read-API untouched.
"""

import logging
from functools import partial

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.notifications.groups import NOTIFY_MESSAGE_TYPE, group_name_for
from apps.notifications.models import Notification
from apps.notifications.selectors import NotificationSelector

logger = logging.getLogger(__name__)


def _local_isoformat(value) -> str:
    """*value* rendered exactly as the read-API renders it (5.7c parity, AC-9).

    This IS what DRF's ``DateTimeField`` does: ``enforce_timezone`` converts to
    ``timezone.get_current_timezone()`` and calls ``.isoformat()``. Written as
    ``astimezone`` rather than ``timezone.localtime(value)`` — which is the same
    operation — because ``localtime()`` defaults its argument to ``now()`` and is
    therefore on the wall-clock denylist (ARCH-DATA-022, enforced by
    ``core/tests/test_isolation.py``). The guard cannot tell the two call shapes
    apart, and it should not have to: spelling the conversion this way leaves no
    code path here that could read a clock at all, instead of asking a reader to
    trust that the argument is always supplied.
    """
    return value.astimezone(timezone.get_current_timezone()).isoformat()


def _publish(notification: Notification) -> None:
    """Announce *notification* to its recipient's channel-layer group (11.2).

    Runs as a ``transaction.on_commit`` callback, never inline — see ``notify()``.

    Carries its OWN ``try/except`` rather than leaning on the one in ``notify()``,
    and the two execution branches need it for different reasons:

    * inside a transaction the callback fires AFTER the commit, by which time
      ``notify()`` has long returned — its ``except`` is not on the stack at all,
      so an escaping exception would surface in the caller *after* the business
      change was applied (the worst outcome, banned by architecture.md#L327);
    * outside a transaction (autocommit) ``on_commit`` runs the callback
      IMMEDIATELY and inline — that is, inside ``notify()``'s ``try``. Without a
      local guard a dead channel layer would be swallowed *there*, making
      ``notify()`` return ``None``, which ``lagging_check._emit_lagging`` reads as
      «the notice did not persist» → ``LaggingNotifyError`` → catch-up stops. An
      outage of the SIGNAL would have halted a BUSINESS operation.

    The envelope carries the read-API's projection by value, so a row arriving
    over WS drops straight into the same query cache as rows from
    ``GET /api/notifications/`` (11.4). ``api.serializers`` is deliberately NOT
    imported — that would invert the layer contract (architecture.md#L444-454);
    the parity is held by a test instead.

    Story 11.5 — the kill-switch (``settings.VAPS_WS_ENABLED``) is checked as the
    very FIRST statement, deliberately before the ``try`` below. The point of the
    switch is to not touch the risky infrastructure at all — not to swallow its
    failure neatly, which this function already does. A guard placed after
    ``get_channel_layer()`` would still open a connection to Redis and would be
    indistinguishable, in every green test, from one that works. Silence here is
    also the whole log policy for the disabled state: an administrator's decision
    is not an error, and ``notify()`` is called on the catch-up schedule, so a
    warning per call would flood the journal. ``notify()`` itself is untouched by
    the flag (AC-5): switching off the SIGNAL must never stop the BUSINESS
    operation that ``lagging_check`` runs on its return value.
    """
    if not settings.VAPS_WS_ENABLED:
        return

    try:
        # Two different «type» fields live here (groups.py, consumers.py): the
        # OUTER one below is channel-layer routing, THIS one is the registry code
        # the client sees. The nested "payload" is likewise not a typo — the
        # outer dict is the WS envelope, the inner one the row's domain payload.
        envelope = {
            "type": notification.kind,
            "payload": {
                "id": notification.id,
                "recipient": notification.recipient,
                "kind": notification.kind,
                # Every value has to be a JSON primitive: channels_redis packs
                # the envelope with msgpack (which cannot serialize
                # date/datetime) and the consumer then runs json.dumps over it.
                # A bare date blows up at runtime, on the real layer only.
                "business_date": notification.business_date.isoformat(),
                "payload": notification.payload,
                # None on a just-created row; normalised the same way as
                # created_at so this stays a primitive if it ever is not.
                "read_at": (
                    _local_isoformat(notification.read_at)
                    if notification.read_at
                    else None
                ),
                # NOT a bare .isoformat(): created_at is stored in UTC while DRF
                # renders in the active timezone (Asia/Qyzylorda), so the bare
                # form yields a DIFFERENT string than the read-API for the same
                # instant — breaking both the 11.4 cache ordering and the 11.3
                # `?since=` cursor.
                "created_at": _local_isoformat(notification.created_at),
            },
        }
        async_to_sync(get_channel_layer().group_send)(
            group_name_for(notification.recipient),
            {"type": NOTIFY_MESSAGE_TYPE, "message": envelope},
        )
    except Exception:
        # Best-effort by contract (architecture.md#L327): the row in the DB is
        # the truth, WS is only an «обнови» signal. Same structured fields
        # notify() already logs, no PII. `request_id` is empty on this branch —
        # the WS path has no middleware (known, accepted gap from 11.1).
        logger.exception(
            "WS publish failed for recipient=%r kind=%r business_date=%r",
            notification.recipient,
            notification.kind,
            notification.business_date,
        )


def notify(recipient, kind, business_date, payload=None) -> Notification | None:
    """Idempotently emit a notification inside the caller's transaction.

    «Одно уведомление на день»: the first call for a given
    ``(recipient, kind, business_date)`` creates the row (with ``payload``);
    later calls are no-ops (the first payload wins). ``recipient`` is stripped so
    whitespace variants cannot defeat the one-per-day key (lesson 5.6b). Returns
    the row (created or existing), or ``None`` if emission failed (logged,
    non-fatal). Raises ``ValueError`` on a blank recipient (caller bug).

    A newly created row is additionally published to the recipient's WS group on
    commit (11.2); a repeat call is not — see the comment on ``on_commit`` below.
    """
    if not recipient or not recipient.strip():
        raise ValueError("notify requires a recipient")
    recipient = recipient.strip()
    payload = payload or {}

    try:
        notification, created = Notification.objects.get_or_create(
            recipient=recipient,
            kind=kind,
            business_date=business_date,
            defaults={"payload": payload},
        )
        if created:
            # ONLY the signal is deferred, never the write. The write staying
            # synchronous IS variant B (5.7a Review D1), and the discriminating
            # test test_notify_visible_within_caller_transaction names
            # `on_commit` as the very thing that would break it — if that test
            # goes red, this line moved something it must not.
            #
            # And the signal MUST be deferred: sending inline would announce a
            # row to the client that a rollback then removes — precisely the
            # phantom architecture.md#L459 bans («отправка только через
            # transaction.on_commit»). Inline passes every happy-path test and
            # fails only on rollback, in production.
            #
            # `partial`, not a lambda: the AST guard
            # test_group_send_only_inside_on_commit looks for the function
            # OBJECT handed to on_commit, and a lambda hides `_publish` from it
            # (it also sidesteps the classic late-binding trap).
            #
            # Guarded by `created` because the WS signal tracks a STATE CHANGE,
            # not a call: lagging_check.catch_up re-asks about already-notified
            # days by construction (idempotency-by-watermark), so «send on every
            # call» would turn one retry into a storm of duplicates about rows
            # that did not change.
            #
            # Registered INSIDE this try so a failure of the registration itself
            # falls under the same non-fatal contract.
            transaction.on_commit(partial(_publish, notification))
        return notification
    except Exception:
        # Side-channel (FR-13) must never break an already-valid business op:
        # get_or_create's savepoint already absorbs the duplicate/race
        # IntegrityError (5.6b); anything else (DB down, serialization) is logged
        # and swallowed rather than propagated.
        logger.exception(
            "notify() failed for recipient=%r kind=%r business_date=%r",
            recipient,
            kind,
            business_date,
        )
        return None


def mark_read(*, notification_id, actor_id) -> Notification:
    """Story 11.4a — record that *actor_id* has read *notification_id*.

    Mirrors ``DailySubmissionViewSet.amend``'s order of operations (resolve
    pk → 404 if missing → scope-check → mutate): existence is checked BEFORE
    ownership, so a phantom id is 404 to any caller, not a 403 that would leak
    whether the id exists. Ownership here is a flat actor-id equality
    (``recipient == actor_id``), not an RBAC code — the same self-scope
    philosophy the read-API already documents (``NotificationViewSet``).

    Idempotent: a second call on an already-read row is a no-op that returns
    the row unchanged — the FIRST read wins, not the last click. Overwriting
    ``read_at`` on every call would let a double-click or a refocused tab
    silently move "when this was actually read" forward each time.

    The check-then-set runs under ``select_for_update`` inside this function's
    OWN ``transaction.atomic()`` (review 11.4a): without a lock, two
    concurrent calls can both observe ``read_at IS NULL`` before either
    writes, and the later ``.save()`` would win — breaking the idempotency
    contract above under a real race (double-click, or a click racing a
    background poll), not just under sequential calls.
    """
    with transaction.atomic():
        notification = NotificationSelector.by_id(notification_id, lock=True)
        if notification is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"notification_id": str(notification_id)},
                message="Уведомление не найдено.",
            )
        if notification.recipient != actor_id:
            raise DomainError(
                "PERMISSION_DENIED",
                403,
                detail={"notification_id": str(notification_id)},
            )
        if notification.read_at is not None:
            return notification
        notification.read_at = Clock.now()
        notification.save(update_fields=["read_at"])
        return notification
