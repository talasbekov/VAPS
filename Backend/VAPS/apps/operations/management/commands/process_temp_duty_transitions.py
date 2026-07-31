"""Story 15.11c — beat-ready entrypoint for the FR-34 temp-duty catch-up job.

Runnable and testable WITHOUT Celery, same split as `check_lagging_submissions`
(5.7b2) / `escalate_stale_force_requests` (15.10): a future story wraps
`process_temp_duty_transitions()` in a Celery `@shared_task` and registers it
in the beat schedule — Celery is NOT imported here and is NOT a dependency.
"""

from django.core.management.base import BaseCommand

from apps.operations.services import process_temp_duty_transitions


class Command(BaseCommand):
    help = (
        "Notify+mark TemporaryDutyPermission grants crossing their starts_at/"
        "ends_at boundary (Story 15.11c, FR-34). Idempotent per grant "
        "(activated_notified_at / is_active); beat-ready, Celery is NOT "
        "imported."
    )

    def handle(self, *args, **options):
        result = process_temp_duty_transitions()
        activated = result["activated"]
        expired = result["expired"]
        if not activated and not expired:
            self.stdout.write("temp-duty transitions: no boundary crossings found")
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"temp-duty transitions: {len(activated)} activated, "
                f"{len(expired)} expired"
            )
        )
