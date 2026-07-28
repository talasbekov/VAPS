"""Story 7.9/AC-1 — фиксация подписи владельца расхода: «список подтверждён
человеком, а не только донором». Append-only — повторная подпись на ту же
пару (division, date) после исправлений создаёт НОВУЮ строку (follow-up),
не перезаписывает предыдущую."""

from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.migration_legacy.roster_export import resolve_division_by_code
from apps.migration_legacy.roster_signature import record_signature


class Command(BaseCommand):
    help = (
        "Фиксация подписи владельца расхода по сверке ростера (Story 7.9): "
        "actor + число расхождений + опциональные заметки."
    )

    def add_arguments(self, parser):
        parser.add_argument("--division", required=True, help="код подразделения")
        parser.add_argument("--date", required=True, help="YYYY-MM-DD")
        parser.add_argument("--actor", required=True)
        parser.add_argument("--discrepancy-count", required=True, type=int)
        parser.add_argument("--notes", default="")

    def handle(self, *args, **options):
        try:
            business_date = date.fromisoformat(options["date"])
        except ValueError as exc:
            raise CommandError(f"невалидный --date: {exc}") from exc

        try:
            division = resolve_division_by_code(options["division"])
        except LookupError as exc:
            raise CommandError(str(exc)) from exc

        try:
            record_signature(
                division.id,
                business_date,
                actor=options["actor"],
                discrepancy_count=options["discrepancy_count"],
                notes=options["notes"],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"подпись зафиксирована: {options['division']} {business_date} "
                f"discrepancies={options['discrepancy_count']}"
            )
        )
