"""Story 6.9 — beat-ready entrypoint for the parallel-run diff catch-up job.

Runnable and testable WITHOUT Celery. Story 12.6 wraps ``run_parallel_run_diff``
in a Celery ``@shared_task`` and registers it in the beat schedule — Celery is
NOT imported here and is NOT a dependency.

NON-BLOCKING (AC-5): the command NEVER exits non-zero on discrepancies, a halt,
an unreadable baseline, or a per-day crash — parallel-run is a background mode,
not a CI gate. It prints the outcome (watermark move, green-day streak, and any
blocking «tickets») and returns. The only hard errors are a malformed or future
``--today`` argument.
"""

from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.core.clock import Clock
from apps.parallel_run.models import ParallelRunDiff
from apps.parallel_run.services import run_parallel_run_diff


class Command(BaseCommand):
    help = (
        "Run the parallel-run diff catch-up job (Story 6.9): from its watermark, "
        "chronologically day-by-day, compute the VAPS расход, classify each "
        "discrepancy against the frozen donor baseline (timing/model/"
        "unclassified), persist the registry and count consecutive green days. "
        "Idempotent, catch-up-safe, NON-blocking. Beat-ready (12.6 registers it); "
        "Celery is NOT imported."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--today",
            help="Business date (YYYY-MM-DD) for a manual/test/catch-up run; the "
            "real beat run uses Clock.today_local() when omitted.",
        )
        parser.add_argument(
            "--baseline",
            help="Path to the frozen donor baseline JSON; defaults to the "
            "synthetic seed sample (real freeze = Story 7.0/7.8).",
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
            # later real run would halt clock_behind_watermark. Block the foot-gun.
            real_today = Clock.today_local()
            if today > real_today:
                raise CommandError(
                    f"--today {today.isoformat()} в будущем (сегодня "
                    f"{real_today.isoformat()}) — отравит watermark; флаг только "
                    "для тестов/догона прошлого."
                )

        result = run_parallel_run_diff(
            today=today, baseline_path=options.get("baseline")
        )

        if result.skipped:
            self.stdout.write("parallel-run diff skipped: another run holds the lock")
            return
        if result.halted:
            # Surfaced but NON-blocking (exit 0): parallel-run is not a CI gate.
            watermark_note = (
                f"watermark unchanged at {result.watermark_before}"
                if result.watermark_before
                else "watermark untouched"
            )
            self.stdout.write(
                self.style.WARNING(
                    f"parallel-run diff halted ({result.halt_reason}); "
                    f"{watermark_note}. See logs."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"parallel-run diff: watermark {result.watermark_before} -> "
                f"{result.watermark_after}, {len(result.processed_days)} day(s), "
                f"green-streak {result.green_streak}"
            )
        )
        if result.remaining_backlog:
            self.stdout.write(
                self.style.WARNING(
                    f"backlog truncated: {result.remaining_backlog} date(s) "
                    "beyond the per-run cap remain — run again to continue"
                )
            )

        blocking = ParallelRunDiff.objects.filter(
            run_date__in=result.processed_days, is_blocking=True
        ).order_by("run_date", "division_code", "column_code")
        if blocking:
            self.stdout.write("UNCLASSIFIED / DATA-LOSS (тикеты, НЕ блокер мержа):")
            for row in blocking:
                self.stdout.write(
                    f"  {row.run_date.isoformat()} {row.division_code} "
                    f"{row.column_code} [{row.category}]: VAPS {row.vaps_value} "
                    f"vs донор {row.donor_value} (Δ {row.delta:+d})"
                )
