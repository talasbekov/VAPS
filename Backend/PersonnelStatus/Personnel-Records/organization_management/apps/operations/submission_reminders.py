"""Current-day reminders before the submission deadline and when it expires.

The default reminder window is the final 60 minutes before the existing
control hour. Each phase has its own key, independent of manual reminders and
the historical lagging catch-up. Missing submissions and active deputies are
read again on each tick; a successful submission cancels the later reminder.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import TemporaryDutyPermission, UserRole
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import OpsDivisionNotifyRecipient
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector, DivisionTreeSelector, SubmissionControlSettingsSelector,
)
from organization_management.apps.operations.services import PermissionService

logger = logging.getLogger(__name__)
REMINDER_LEAD = timedelta(minutes=60)


class SubmissionReminderDeliveryError(RuntimeError):
    """A failed delivery rolls back the phase so a later tick can retry it."""


def resolve_submission_recipients(division_ids, *, control):
    """Explicit recipients plus scoped submission grants, resolved in batches.

    Permanent and temporary deputies use the same submission permission and
    scope rule as the API. Global administrators are not broadcast recipients.
    The configured duty recipient remains a fallback for an unresolved division.
    """
    division_ids = sorted(set(division_ids))
    recipients = {division_id: set() for division_id in division_ids}
    if not division_ids:
        return recipients
    for division_id, recipient in OpsDivisionNotifyRecipient.objects.filter(
        division_id__in=division_ids
    ).values_list("division_id", "recipient"):
        if recipient.strip():
            recipients[division_id].add(recipient.strip())

    roles = PermissionService.roles_holding("daily_report.mark_update")
    grants = list(UserRole.objects.filter(
        is_active=True, scope_division_id__isnull=False, role_code_id__in=roles,
    ).values_list("scope_division_id", "user_id"))
    now = Clock.now()
    grants += list(TemporaryDutyPermission.objects.filter(
        is_active=True, scope_division_id__isnull=False, duty_role_code__in=roles,
        starts_at__lte=now, ends_at__gte=now,
    ).values_list("scope_division_id", "user_id"))
    # Grants store strings; only live local accounts can sign in and read them.
    user_ids = {
        int(user_id.strip()) for _, user_id in grants
        if user_id.strip().isdecimal() and 0 < int(user_id.strip()) <= 2**63 - 1
    }
    active_users = {
        str(pk) for pk in get_user_model().objects.filter(
            pk__in=user_ids, is_active=True
        ).values_list("pk", flat=True)
    }
    children = DivisionTreeSelector.children_map()
    for scope, user_id in grants:
        user_id = user_id.strip()
        if user_id not in active_users:
            continue
        for division_id in division_ids:
            if PermissionService.scope_matches(scope, division_id, children_map=children):
                recipients[division_id].add(user_id)

    duty = (control.default_notify_recipient or "").strip()
    if duty:
        for resolved in recipients.values():
            if not resolved:
                resolved.add(duty)
    return recipients


@transaction.atomic
def remind_daily_submissions():
    """Deliver due phases, including a next-day deadline's evening window."""
    now = Clock.local_now()
    day = now.date()
    control = SubmissionControlSettingsSelector.get()
    result = _remind_for_day(control, now, day)
    tomorrow = day + timedelta(days=1)
    tomorrow_deadline = datetime.combine(tomorrow, control.control_hour, tzinfo=now.tzinfo)
    if tomorrow_deadline - REMINDER_LEAD <= now < tomorrow_deadline:
        result["upcoming"] = _remind_for_day(control, now, tomorrow)
    return result


def _remind_for_day(control, now, day):
    deadline = datetime.combine(day, control.control_hour, tzinfo=now.tzinfo)
    phase = (
        "overdue" if now >= deadline else
        "before_deadline" if now >= deadline - REMINDER_LEAD else None
    )
    result = {
        "business_date": day.isoformat(), "phase": phase,
        "deadline_at": deadline.isoformat(), "laggard_division_ids": [],
        "notified_recipient_count": 0, "unresolved_division_ids": [],
    }
    if phase is None or not control.required_division_ids:
        return result

    required = set(control.required_division_ids)
    submitted = DailySubmissionSelector.current_for_many(required, day)
    laggards = sorted(required - set(submitted))
    result["laggard_division_ids"] = laggards
    recipients = resolve_submission_recipients(laggards, control=control)
    by_recipient = defaultdict(list)
    for division_id in laggards:
        if not recipients[division_id]:
            result["unresolved_division_ids"].append(division_id)
            logger.warning(
                "No submission reminder recipient for division %s on %s", division_id, day,
            )
        for recipient in sorted(recipients[division_id]):
            by_recipient[recipient].append(division_id)
    for recipient, division_ids in sorted(by_recipient.items()):
        row = notify(
            recipient, OpsNotification.Kind.SUBMISSION_LAGGING, day,
            payload={"phase": phase, "laggard_division_ids": division_ids,
                     "deadline_at": deadline.isoformat()},
            dedupe_key=f"submission:{phase}",
        )
        if row is None:
            raise SubmissionReminderDeliveryError(
                f"Submission reminder delivery failed for {recipient!r} on {day} ({phase})"
            )
    result["notified_recipient_count"] = len(by_recipient)
    return result
