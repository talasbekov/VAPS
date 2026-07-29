"""Story 12.6 — Celery wrapper for the lagging-submission catch-up job (5.7b2).

Bare call, no ``today`` argument — see apps/operations/statuses/tasks.py's
docstring for the same reasoning (both services default identically).
"""

from celery import shared_task

from apps.operations.submissions.services.lagging_check import (
    check_lagging_submissions,
)
from apps.operations.submissions.services.threshold_check import (
    check_submission_threshold,
)


@shared_task(name="apps.operations.submissions.tasks.check_lagging_submissions_task")
def check_lagging_submissions_task():
    check_lagging_submissions()


@shared_task(
    name="apps.operations.submissions.tasks.check_submission_threshold_task"
)
def check_submission_threshold_task():
    # Story 13.5b — bare call, same reasoning as check_lagging_submissions_task
    # above: the service defaults `today` to Clock.today_local() itself.
    check_submission_threshold()
