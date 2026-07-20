"""Story 3.12 — beat-ready entrypoint for the status-effects catch-up engine.

Runnable and testable WITHOUT Celery. Registered in the contour scheduler as
a systemd timer (deploy/systemd/vaps-beat.*, Story 12.6); Celery is NOT used
(ARCH-DEFERRED-048).
"""

from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.core.clock import Clock
from apps.operations.statuses.services.catch_up import materialize_status_effects


class Command(BaseCommand):
    help = (
        "Run the status-effects catch-up engine (Story 3.12, FR-41 core): "
        "materialize transition effects from the watermark, chronologically, "
        "idempotently, under an advisory lock. Scheduled by the vaps-beat "
        "systemd timer (12.6)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--today",
            help="Business date (YYYY-MM-DD) for a manual/test run; the real "
            "beat run uses Clock.today_local() when omitted.",
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
            # --today — ручной/тестовый/догоночный флаг. Будущая дата сдвинула бы
            # watermark ВПЕРЁД реального времени → каждый последующий реальный
            # прогон halt'ил бы clock_behind_watermark (восстановление = ручная
            # правка БД). Реальный beat берёт дату сам (Clock.today_local()); не
            # пускаем foot-gun.
            real_today = Clock.today_local()
            if today > real_today:
                raise CommandError(
                    f"--today {today.isoformat()} в будущем (сегодня "
                    f"{real_today.isoformat()}) — отравит watermark; флаг только "
                    "для тестов/догона прошлого."
                )
        result = materialize_status_effects(today=today)

        if result.skipped:
            self.stdout.write("catch-up skipped: another run holds the lock")
            return
        if result.halted:
            # Surface halt loudly (non-zero exit) so an operator / CI notices.
            # Admin procedure for clock-backwards is spike 3.13.
            raise CommandError(
                f"catch-up HALTED ({result.halt_reason}); watermark unchanged at "
                f"{result.watermark_before}. See logs."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"catch-up ok: watermark {result.watermark_before} -> "
                f"{result.watermark_after}, {len(result.processed_days)} day(s)"
            )
        )
