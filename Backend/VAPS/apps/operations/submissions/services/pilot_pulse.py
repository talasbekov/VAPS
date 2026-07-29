"""Story 13.5c — daily "pilot pulse" digest (epics.md#L1380-1387, last third).

Distinct trigger and aggregation from ``threshold_check.py`` (13.5b): that
service alerts only on a shortfall, gated by an Admin-configurable
``alert_hour``. This one emits EVERY day after a fixed cutoff (20:00 local,
a literal — not a settings field, see the story's Dev Notes for why a third
configurable hour would be over-engineering here), regardless of whether the
day went well — the pulse itself, present or absent, is the signal that the
day's cycle reached the check. "Alarm the same day" (epics.md#L1387) is
realized simply by keying the notification's ``business_date`` on the day
being reported, not by a second notification kind.

Same idempotency story as 13.5b: no watermark, no lock — ``notify()``'s own
``get_or_create(recipient, kind, business_date)`` makes a repeat call within
the same day a no-op.

Scope (13.5c): "cycle time" is explicitly OUT of scope (resolved via
AskUserQuestion at create-story: epics.md#L1341-1343 shows it's a manually
recorded baseline against the old Excel process, not something this data
model tracks) — the pulse reports only submission counts, active users, and
a silent-day flag.
"""

import logging
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.core.clock import Clock
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import (
    DailySubmissionSelector,
    SubmissionControlSettingsSelector,
)

logger = logging.getLogger(__name__)

# Literal, not a settings field (Dev Notes): the pulse is background
# diagnostics for the developer, not an operational SLA like alert_hour
# (13.5a) — a third configurable hour for something the letter never asks
# to be configurable would be over-engineering.
PULSE_CUTOFF_HOUR = 20


def pilot_pulse_digest(*, today=None) -> None:
    """Emit one "pilot pulse" digest for ``today``, once past the cutoff hour.

    Unlike ``check_submission_threshold`` (13.5b), this ALWAYS emits after
    the cutoff — including when ``required_division_ids`` is empty or when
    nothing was submitted at all (that IS the silent-day signal, epics.md
    #L1387 — a silent pilot with no configured required list is a more
    likely early scenario than a fully configured one, and must not go
    unnoticed).
    """
    local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
    real_today = today if today is not None else local_now.date()

    if local_now.hour < PULSE_CUTOFF_HOUR:
        return

    required = SubmissionControlSettingsSelector.required_division_ids()
    if required:
        submitted = DailySubmissionSelector.current_for_many(required, real_today)
        required_count = len(required)
        submitted_rows = list(submitted.values())
    else:
        # No required list configured — the pulse still has to say something
        # about the day rather than staying silent (see docstring). Falls
        # back to ALL current submissions of the day, not current_for_many
        # (which returns {} on an empty division_ids input).
        required_count = 0
        submitted_rows = list(
            DailySubmission.objects.filter(
                business_date=real_today, is_current=True
            )
        )

    submitted_count = len(submitted_rows)
    active_user_count = len({row.submitted_by for row in submitted_rows})
    silent_day = submitted_count == 0

    recipient = SubmissionControlSettingsSelector.get().default_notify_recipient
    if not recipient or not recipient.strip():
        # AC-5: notify() raises ValueError on a blank recipient — gate BEFORE
        # calling it (mirror threshold_check.py's identical guard).
        logger.warning(
            "pilot-pulse digest would fire but no default_notify_recipient "
            "is configured",
            extra={
                "business_date": str(real_today),
                "required_count": required_count,
                "submitted_count": submitted_count,
            },
        )
        return

    notify(
        recipient,
        Notification.Kind.PILOT_PULSE_DIGEST,
        real_today,
        payload={
            "required_count": required_count,
            "submitted_count": submitted_count,
            "active_user_count": active_user_count,
            "silent_day": silent_day,
        },
    )
