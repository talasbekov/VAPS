"""Scheduled current-day submission reminders; legacy catch-up stays separate."""
from celery import shared_task

from organization_management.apps.operations.submission_reminders import (
    SubmissionReminderDeliveryError, remind_daily_submissions,
)


@shared_task(
    name="operations.remind_daily_submissions",
    autoretry_for=(SubmissionReminderDeliveryError,), retry_backoff=True, max_retries=3,
)
def remind_daily_submissions_task():
    return remind_daily_submissions()
