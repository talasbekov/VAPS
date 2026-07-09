from django.core.management.base import BaseCommand, CommandError

from apps.operations.statuses.tasks import run_status_effects_catchup


class Command(BaseCommand):
    help = "Materialize status effects from the watermark up to today (FR-41)."

    def handle(self, *args, **options):
        result = run_status_effects_catchup()
        summary = (
            f"status={result.status} "
            f"days={len(result.processed)} "
            f"remaining={result.remaining}"
        )
        if result.status == "halted":
            # The wall clock is behind the watermark. Exiting 0 here would bury
            # the alert in a cron log that nobody reads.
            raise CommandError(f"catch-up halted: clock behind watermark ({summary})")
        self.stdout.write(self.style.SUCCESS(summary))
