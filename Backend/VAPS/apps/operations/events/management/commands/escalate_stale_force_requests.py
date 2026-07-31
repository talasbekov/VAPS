"""Story 15.10 — beat-ready entrypoint for the FR-42 escalation catch-up job.

Runnable and testable WITHOUT Celery, same split as `check_lagging_submissions`
(5.7b2): a future story wraps `escalate_stale_force_requests()` in a Celery
`@shared_task` and registers it in the beat schedule — Celery is NOT imported
here and is NOT a dependency.
"""

from django.core.management.base import BaseCommand

from apps.operations.events.services import escalate_stale_force_requests


class Command(BaseCommand):
    help = (
        "Escalate GroupForceRequest rows stuck SENT/PARTIALLY_ALLOCATED past "
        "VAPS_FORCE_REQUEST_ESCALATION_DAYS (Story 15.10, FR-42). Idempotent "
        "per row (escalated_at); beat-ready, Celery is NOT imported."
    )

    def handle(self, *args, **options):
        escalated = escalate_stale_force_requests()
        if not escalated:
            self.stdout.write("escalation: no stale force requests found")
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"escalation: {len(escalated)} force request(s) escalated"
            )
        )
