"""Scoped manual reminders; automatic lagging retains its own daily key."""
from collections import defaultdict

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector, DivisionTreeSelector, NotifyRecipientSelector,
)
from organization_management.apps.operations.summary_service import _required_children


@transaction.atomic
def remind_daily_summary(*, division_id, business_date, actor):
    """Notify once per recipient/department/day; count existing deliveries too.

    The API checks actor scope before invoking this service. Notifications and
    audit commit together: failure of even one delivery rolls back the request.
    """
    if not DivisionTreeSelector.exists(division_id):
        raise DomainError("ENTITY_NOT_FOUND", 404, message="Подразделение не найдено.")
    children = _required_children(
        division_id, children_map=DivisionTreeSelector.children_map()
    )
    submitted = DailySubmissionSelector.current_for_many(children, business_date)
    laggards = sorted(child for child in children if child not in submitted)
    recipients = NotifyRecipientSelector.resolve_many(laggards) if laggards else {}
    by_recipient = defaultdict(list)
    unresolved = []
    for child in laggards:
        recipient = recipients.get(child)
        if recipient:
            by_recipient[recipient].append(child)
        else:
            unresolved.append(child)
    for recipient, division_ids in by_recipient.items():
        row = notify(
            recipient, OpsNotification.Kind.SUBMISSION_LAGGING, business_date,
            payload={"laggard_division_ids": division_ids},
            dedupe_key=f"manual:{division_id}",
        )
        if row is None:
            raise DomainError(
                "REMINDER_DELIVERY_FAILED", 503,
                message="Не удалось отправить напоминания. Повторите попытку.",
            )
    result = {
        "business_date": business_date.isoformat(),
        "laggard_division_ids": laggards,
        "notified_recipient_count": len(by_recipient),
        "unresolved_division_ids": unresolved,
    }
    audit_service.record(
        actor=actor, action=audit_service.DAILY_SUMMARY_REMINDED,
        entity_type=audit_service.ENTITY_SUBMISSION,
        entity_key=f"manual:{division_id}:{business_date.isoformat()}",
        new_value=result,
    )
    return result
