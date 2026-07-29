"""Story 13.5b — intraday partial-shortfall alert (FR-13, epics.md#L1380-1387).

Distinct from ``lagging_check.py`` (5.7b2/12.6): that job is a multi-day
CATCH-UP over FULL missing days, checked the next morning, with its own
watermark + advisory lock. This is a SAME-DAY, single-shot check — "is the
fraction of required divisions that have submitted below the configured
threshold, once we're past the configured alert hour" — with no watermark or
lock: idempotency comes for free from ``notify()``'s own
``get_or_create(recipient, kind, business_date)`` (13.5a). A repeat call
within the same day, after the alert already fired, is simply a no-op.

Scope (13.5b): detection + emission only. The model fields
(``alert_hour``/``alert_threshold_pct``/``Notification.Kind.
SUBMISSION_THRESHOLD_ALERT``) are 13.5a. The Celery/beat wrapper is this
story too (``tasks.py`` + ``config/settings.py``). The "pilot pulse" daily
digest is a separate story, 13.5c.
"""

import logging
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.core.clock import Clock
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.operations.submissions.selectors import (
    DailySubmissionSelector,
    SubmissionControlSettingsSelector,
)

logger = logging.getLogger(__name__)


def check_submission_threshold(*, today=None) -> None:
    """Run one intraday threshold check; emit at most one alert for ``today``.

    ``today`` defaults to ``Clock.today_local()`` (the only legitimate
    wall-clock read — mirror ``check_lagging_submissions``). No watermark, no
    lock: see the module docstring for why none is needed here.
    """
    real_today = today if today is not None else Clock.today_local()

    required = SubmissionControlSettingsSelector.required_division_ids()
    if not required:
        # AC-2: nothing required → nothing can be "behind". Mirror
        # _emit_lagging's "if not laggards: return" — no alert about 0-of-0.
        return

    alert_hour = SubmissionControlSettingsSelector.alert_hour()
    local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
    if local_now.time() < alert_hour:
        # AC-3: too early today — do not even read submission state yet.
        return

    submitted = DailySubmissionSelector.current_for_many(required, real_today)
    required_count = len(required)
    submitted_count = len(submitted)
    submitted_pct = (submitted_count / required_count) * 100

    threshold_pct = SubmissionControlSettingsSelector.alert_threshold_pct()
    if submitted_pct >= threshold_pct:
        return

    recipient = SubmissionControlSettingsSelector.get().default_notify_recipient
    if not recipient or not recipient.strip():
        # AC-5: notify() raises ValueError on a blank recipient — gate BEFORE
        # calling it (mirror _emit_lagging's per-division "no recipient →
        # log + skip", here for the single aggregate recipient instead).
        logger.warning(
            "submission-threshold alert would fire but no default_notify_"
            "recipient is configured",
            extra={
                "business_date": str(real_today),
                "required_count": required_count,
                "submitted_count": submitted_count,
            },
        )
        return

    notify(
        recipient,
        Notification.Kind.SUBMISSION_THRESHOLD_ALERT,
        real_today,
        payload={
            "required_count": required_count,
            "submitted_count": submitted_count,
            "threshold_pct": threshold_pct,
        },
    )
