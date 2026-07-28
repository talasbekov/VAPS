"""Import a 5-7 day slice of donor data into the walking skeleton (1.6).

Reads a donor ``manage.py dumpdata`` JSON export, creates Employee rows
(identity mapping donor_pk -> uuid via Employee.external_id) and interval
EmployeeStatus rows. Idempotent; every skip is reported with a reason —
the skips are the first data-quality findings for the 1.8 diff and E7.

No wall clock anywhere: the window is derived from the data (--until
defaults to the max date in the export) — the donor is historical.

Orchestration lives in ``full_import.run_full_import`` (Story 7.6) — this
command is now a thin CLI wrapper so ``migrate_rehearsal`` can call the same
logic twice in one process without shelling out / parsing stdout.
"""

import json

from django.core.management.base import BaseCommand, CommandError

from apps.migration_legacy.full_import import FullImportError, run_full_import
from apps.migration_legacy.import_orgstructure import EXAMPLE_LIMIT


class Command(BaseCommand):
    help = (
        "Import a donor dumpdata slice: employees (external_id = donor pk) "
        "and statuses for a 5-7 day window. Idempotent, reports every skip."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="path to donor dumpdata JSON export")
        parser.add_argument("--days", type=int, default=7)
        parser.add_argument(
            "--until",
            default=None,
            help="window end YYYY-MM-DD (default: max date in the export)",
        )

    def handle(self, *args, **options):
        try:
            with open(options["file"], encoding="utf-8") as fh:
                rows = json.load(fh)
        except (OSError, ValueError) as exc:
            raise CommandError(f"cannot read export: {exc}") from exc

        try:
            result = run_full_import(rows, options["days"], options["until"])
        except FullImportError as exc:
            raise CommandError(str(exc)) from exc

        self._print_report(result)

    def _print_report(self, result):
        write = self.stdout.write
        for name, report in result.reports.items():
            line = (
                f"{name}: read {report.read}, created {report.created}, "
                f"updated {report.updated}, skipped {report.skipped}"
            )
            write(self.style.SUCCESS(line))
            for reason, pks in sorted(report.skips.items()):
                examples = ", ".join(str(pk) for pk in pks[:EXAMPLE_LIMIT])
                write(f"  - {reason}: {len(pks)} (examples: {examples})")
            for reason, pks in sorted(report.warnings.items()):
                examples = ", ".join(str(pk) for pk in pks[:EXAMPLE_LIMIT])
                write(f"  ~ {reason}: {len(pks)} (examples: {examples})")
        # Explicit lines for 1.8 (diff reads these).
        statuses = result.reports["statuses"]
        write(
            self.style.SUCCESS(
                f"staffing divisions covered: {result.slot_divisions_covered}"
            )
        )
        write(self.style.SUCCESS(f"open_end_clamped: {result.clamped}"))
        write(
            self.style.SUCCESS(
                f"hard_overlap: {len(statuses.skips.get('hard_overlap', []))}"
            )
        )
        # The window is the closing line of the report (Task 3).
        write(
            self.style.SUCCESS(
                f"window [{result.window_start.isoformat()}.."
                f"{result.until.isoformat()}]"
            )
        )
        # AC-1 (7.3): кандидаты на слияние — отчёт на ручную санкцию, не
        # автослияние. Отдельная секция, не просто skip-счётчик.
        if result.merge_candidates:
            write(self.style.SUCCESS("merge candidates (AC-1, needs sanction):"))
            for candidate in result.merge_candidates:
                pks = ", ".join(str(pk) for pk in candidate["donor_pks"])
                write(f"  - iin {candidate['iin_masked']}: donor_pks [{pks}]")
        # AC-1 (7.4): derived-статус на дату ≠ только что записанный —
        # другой факт того же сотрудника перекрывает по приоритету.
        if result.derived_mismatches:
            write(self.style.WARNING("derived status mismatches (AC-1):"))
            for m in result.derived_mismatches:
                write(
                    f"  - employee {m['employee_id']} on {m['date']}: "
                    f"wrote {m['written']}, resolved {m['resolved']}"
                )
