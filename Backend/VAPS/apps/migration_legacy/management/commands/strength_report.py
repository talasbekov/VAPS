"""Read-only strength report for a date/period: text table + simple .xlsx,
plus an optional diff against frozen donor numbers (story 1.8).

Thin orchestration over the 1.7 contract ``StrengthReportService.compute``
and the pure ``strength_render`` / ``donor_diff`` modules (style sibling:
``import_donor_slice``). READ-ONLY: never writes the DB, never reads the
Clock (business_date is an explicit argument; the range is expanded with
plain ``timedelta`` arithmetic), never takes an actor. ``CommandError`` is
the CLI boundary — it is allowed here; ``DomainError``/exception handlers
are E6/3.1.

The DoD gate is mechanical (AC-5): if any day's diff carries an
``unclassified`` (or data-loss) discrepancy the command prints the
``UNCLASSIFIED`` block and exits non-zero via ``CommandError`` — "расхождение
без объяснения = эпик не закрыт" stops being a verbal promise.
"""

import json
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Division
from apps.migration_legacy.donor_diff import diff_day, load_baseline, render_diff
from apps.migration_legacy.strength_render import build_workbook, render_table
from apps.operations.statuses.services import StrengthReportService


class Command(BaseCommand):
    help = (
        "Read-only strength report for a date or period: text table + "
        "simple .xlsx, plus an optional categorized diff against frozen "
        "donor numbers. Exits non-zero on unclassified discrepancies."
    )

    def add_arguments(self, parser):
        parser.add_argument("--date", help="single business date YYYY-MM-DD")
        parser.add_argument("--from", dest="from_date", help="range start YYYY-MM-DD")
        parser.add_argument("--to", dest="to_date", help="range end YYYY-MM-DD")
        parser.add_argument(
            "--division",
            dest="division",
            help="optional Division UUID (subtree); whole DB if omitted",
        )
        parser.add_argument("--xlsx", help="optional path to write a simple .xlsx")
        parser.add_argument(
            "--diff-baseline",
            dest="diff_baseline",
            help="optional path to ONE JSON baseline covering every day",
        )

    def handle(self, *args, **options):
        dates = self._resolve_dates(options)
        division_id = self._resolve_division(options["division"])

        baseline_by_date = None
        if options["diff_baseline"]:
            baseline_by_date = self._load_baseline(options["diff_baseline"])
            code_by_division_id = dict(Division.objects.values_list("id", "code"))

        results = []
        any_unclassified = False
        for business_date in dates:
            result = StrengthReportService.compute(business_date, division_id)
            results.append(result)
            self.stdout.write(render_table(result))
            self.stdout.write("")

            if baseline_by_date is not None:
                if business_date not in baseline_by_date:
                    raise CommandError(
                        f"baseline has no day {business_date.isoformat()}"
                    )
                diff = diff_day(
                    result, baseline_by_date[business_date], code_by_division_id
                )
                self.stdout.write(render_diff(diff))
                self.stdout.write("")
                if diff.has_unclassified:
                    any_unclassified = True

        if options["xlsx"]:
            workbook = build_workbook(results)
            workbook.save(options["xlsx"])
            self.stdout.write(self.style.SUCCESS(f"xlsx written: {options['xlsx']}"))

        if any_unclassified:
            # AC-5: the gate is the exit code. The UNCLASSIFIED block was
            # already printed per day above.
            raise CommandError(
                "DoD gate: unclassified discrepancies present — эпик не закрыт"
            )

    def _resolve_dates(self, options):
        single = options["date"]
        from_date = options["from_date"]
        to_date = options["to_date"]

        has_single = single is not None
        has_range = from_date is not None or to_date is not None
        if has_single and has_range:
            raise CommandError("--date and --from/--to are mutually exclusive")
        if not has_single and not has_range:
            raise CommandError("pass --date or --from/--to")

        if has_single:
            return [self._parse_date(single, "--date")]

        if from_date is None or to_date is None:
            raise CommandError("--from and --to must be given together")
        start = self._parse_date(from_date, "--from")
        end = self._parse_date(to_date, "--to")
        if start > end:
            raise CommandError("--from must not be after --to")
        # Inclusive on both ends; expanded by explicit arithmetic (the lint
        # of 1.3 forbids any wall-clock call here).
        span = (end - start).days
        return [start + timedelta(days=offset) for offset in range(span + 1)]

    def _parse_date(self, value, flag):
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError):
            raise CommandError(f"{flag} is not a date: {value!r}")

    def _resolve_division(self, division):
        if division is None:
            return None
        # Validate BEFORE compute (Решение №7): a silent empty report is
        # indistinguishable from a legitimately empty subtree, and
        # subtree_ids seeds a non-existent id unconditionally.
        if not Division.objects.filter(id=division).exists():
            raise CommandError(f"division {division} not found")
        return division

    def _load_baseline(self, path):
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f"cannot read baseline: {exc}")
        try:
            return load_baseline(data)
        except ValueError as exc:
            raise CommandError(f"invalid baseline: {exc}")
