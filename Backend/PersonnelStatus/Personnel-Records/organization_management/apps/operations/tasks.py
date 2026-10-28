"""Scheduled current-day submission reminders; legacy catch-up stays separate."""
from celery import shared_task


@shared_task(name="operations.interpret_assistant_task", acks_late=True, reject_on_worker_lost=True, soft_time_limit=100, time_limit=115)
def interpret_assistant_task(task_id, generation):
    from organization_management.apps.ops.assistant.dialogue import process_task
    process_task(task_id, generation)

from organization_management.apps.operations.submission_reminders import (
    SubmissionReminderDeliveryError, remind_daily_submissions,
)


@shared_task(
    name="operations.remind_daily_submissions",
    autoretry_for=(SubmissionReminderDeliveryError,), retry_backoff=True, max_retries=3,
)
def remind_daily_submissions_task():
    return remind_daily_submissions()
