"""Story 7.9/AC-1 — выгрузка «как в системе» для построчной сверки владельцем
расхода пилотного подразделения (CSV: табельный, ФИО, звание, должность)."""

import csv
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.migration_legacy.roster_export import (
    build_roster_export_rows,
    resolve_division_by_code,
)


class Command(BaseCommand):
    help = (
        "Выгрузка ростера подразделения «как в системе» на дату (Story 7.9) "
        "— CSV для построчной сверки владельцем расхода с реальностью."
    )

    def add_arguments(self, parser):
        parser.add_argument("--division", required=True, help="код подразделения")
        parser.add_argument("--date", required=True, help="YYYY-MM-DD")
        parser.add_argument("--out", required=True, help="путь для CSV")

    def handle(self, *args, **options):
        try:
            business_date = date.fromisoformat(options["date"])
        except ValueError as exc:
            raise CommandError(f"невалидный --date: {exc}") from exc

        try:
            division = resolve_division_by_code(options["division"])
        except LookupError as exc:
            raise CommandError(str(exc)) from exc

        rows = build_roster_export_rows(division.id, business_date)

        with open(options["out"], "w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(
                ["personnel_number", "full_name", "rank_name", "position_name"]
            )
            for row in rows:
                writer.writerow(
                    [
                        row.personnel_number,
                        row.full_name,
                        row.rank_name,
                        row.position_name,
                    ]
                )

        self.stdout.write(
            self.style.SUCCESS(f"выгружено {len(rows)} строк -> {options['out']}")
        )
