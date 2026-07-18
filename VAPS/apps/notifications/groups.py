"""Story 11.1 — channel-layer group name for a notification recipient.

Shared contract, not a helper: story 11.2 wires ``group_send`` into ``notify()``
and MUST call THIS function to address the recipient. Two implementations of
"the group name for X" that disagree do not raise — they silently deliver to a
group nobody is listening on.
"""

from hashlib import sha256

# The channel-layer envelope ``type`` that routes to
# ``NotificationConsumer.notify_message`` (Channels replaces the dots with
# underscores to pick the handler). Shared for the same reason group_name_for
# is: story 11.2 must SEND this exact string from ``notify()``, and a typo there
# is not an error — it crashes the consumer on an unroutable envelope at
# runtime. Import it; never retype it. The client-facing UPPER_SNAKE registry
# code is a different field and travels INSIDE ``event["message"]``.
NOTIFY_MESSAGE_TYPE = "notify.message"


def group_name_for(recipient: str) -> str:
    """Deterministic, always-valid channel-layer group name for *recipient*.

    Hashed rather than used raw because Channels validates group names against
    ``^[a-zA-Z\\d\\-_.]+$`` with a 100-char cap (``BaseChannelLayer.valid_group_name``)
    while a ``recipient``/JWT ``sub`` is an arbitrary printable string of up to 100
    chars — ``@``, ``:`` and Cyrillic are all reachable, and each of them makes
    ``group_add`` blow up at runtime.

    Sanitising (replacing the offending characters) was rejected: ``a@b`` and
    ``a_b`` would collapse onto one name, cross-delivering one actor's
    notifications to another. sha256 is collision-free for this purpose; 32 hex
    chars keep the name well under the cap.

    Raises ``ValueError`` on a blank recipient — mirror of the ``notify()``
    blank-guard (a blank recipient is a caller bug, not a runtime condition).
    """
    if not recipient or not recipient.strip():
        raise ValueError("group_name_for requires a recipient")
    digest = sha256(recipient.strip().encode("utf-8")).hexdigest()
    return f"notif.{digest[:32]}"
