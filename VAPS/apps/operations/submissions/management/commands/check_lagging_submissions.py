"""Story 5.7b2 — beat-ready entrypoint for the lagging-submission catch-up job.

Runnable and testable WITHOUT Celery. Story 12.6 wraps
``check_lagging_submissions`` in a Celery ``@shared_task`` and registers it in the
beat schedule — Celery is NOT imported here and is NOT a dependency.
"""

from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.core.clock import Clock
from apps.operations.submissions.services.lagging_check import (
    check_lagging_submissions,
)


class Command(BaseCommand):
    help = (
        "Run the lagging-submission catch-up job (Story 5.7b2, FR-13): from the "
        "watermark, once a day's control hour has passed, find the required "
        "divisions that have not submitted and notify their recipient, "
        "chronologically, idempotently, under an advisory lock. Beat-ready "
        "(12.6 registers it); Celery is NOT imported."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--today",
            help="Business date (YYYY-MM-DD) for a manual/test/catch-up run; the "
            "real beat run uses Clock.today_local() when omitted.",
        )

    def handle(self, *args, **options):
        today = None
        if options.get("today"):
            try:
                today = date.fromisoformat(options["today"])
            except ValueError as exc:
                raise CommandError(
                    f"неверный --today {options['today']!r}: ожидается YYYY-MM-DD"
                ) from exc
            # A future --today would push the watermark ahead of real time → every
            # later real run would halt clock_behind_watermark (recovery = manual
            # DB edit). The real beat takes the date itself; block the foot-gun.
            real_today = Clock.today_local()
            if today > real_today:
                raise CommandError(
                    f"--today {today.isoformat()} в будущем (сегодня "
                    f"{real_today.isoformat()}) — отравит watermark; флаг только "
                    "для тестов/догона прошлого."
                )

        result = check_lagging_submissions(today=today)

        if result.skipped:
            self.stdout.write("lagging-check skipped: another run holds the lock")
            return
        if result.halted:
            # Surface halt loudly (non-zero exit) so an operator / CI notices.
            raise CommandError(
                f"lagging-check HALTED ({result.halt_reason}); watermark unchanged "
                f"at {result.watermark_before}. See logs."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"lagging-check ok: watermark {result.watermark_before} -> "
                f"{result.watermark_after}, {len(result.processed_days)} day(s), "
                f"{result.notified_count} notice(s)"
            )
        )
