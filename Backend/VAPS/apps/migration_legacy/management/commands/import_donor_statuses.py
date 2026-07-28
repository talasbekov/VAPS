"""Story 7.4 — самостоятельный импорт статусов (интервальная модель +
convergence-проверка derived-статуса, AC-1).

Статусы ссылаются на УЖЕ импортированных сотрудников (Story 7.3). Эта
команда резолвит employee_map ТЕМ ЖЕ путём, что ``import_donor_employees``
— повторный вызов ``import_divisions``/``import_ranks``/``import_positions``/
``import_employees`` на той же выгрузке идемпотентен, поэтому безопасно
вызывать их здесь снова.
"""

import json
from collections import defaultdict
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.migration_legacy.import_employees import import_employees
from apps.migration_legacy.import_orgstructure import (
    EXAMPLE_LIMIT,
    EntityReport,
    import_divisions,
    import_positions,
    import_ranks,
)
from apps.migration_legacy.import_statuses import import_statuses


class Command(BaseCommand):
    help = (
        "Идемпотентный импорт статусов (Story 7.4): интервальная модель, "
        "секондменты (ATTACHED/DETACHED уже покрыты transform.py), "
        "convergence-проверка derived-статуса на дату (AC-1)."
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
        if not isinstance(rows, list):
            raise CommandError(
                "ожидался JSON-массив dumpdata [{model, pk, fields}, ...]"
            )
        if options["days"] < 1:
            raise CommandError("--days must be >= 1")

        by_model = defaultdict(list)
        malformed_top_level = 0
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("model"), str):
                by_model[row["model"]].append(row)
            else:
                malformed_top_level += 1

        status_rows = by_model["statuses.employeestatus"]
        until = self._resolve_until(options["until"], status_rows)
        window_start = until - timedelta(days=options["days"] - 1)

        reports = {
            name: EntityReport()
            for name in (
                "organizations",
                "divisions",
                "ranks",
                "positions",
                "employees",
                "statuses",
            )
        }

        with transaction.atomic():
            division_map = import_divisions(
                by_model["divisions.division"],
                reports["organizations"],
                reports["divisions"],
            )
            rank_map = import_ranks(by_model["dictionaries.rank"], reports["ranks"])
            position_pks = import_positions(
                by_model["dictionaries.position"], reports["positions"]
            )
            employee_map, merge_candidates = import_employees(
                by_model["employees.employee"],
                by_model["staff_unit.staffunit"],
                division_map,
                rank_map,
                position_pks,
                reports["employees"],
            )
            clamped, derived_mismatches = import_statuses(
                status_rows,
                employee_map,
                window_start,
                until,
                reports["statuses"],
            )

        self._print_report(
            reports,
            window_start,
            until,
            clamped,
            merge_candidates,
            derived_mismatches,
            malformed_top_level,
        )

    def _resolve_until(self, until_option, status_rows):
        if until_option:
            try:
                return date.fromisoformat(until_option)
            except ValueError as exc:
                raise CommandError(
                    f"--until is not a date: {until_option!r}"
                ) from exc
        # Deterministic from data, never from the wall clock (same contract
        # as import_donor_slice — the donor is historical).
        all_dates = []
        for row in status_rows:
            if not isinstance(row, dict) or not isinstance(row.get("fields"), dict):
                continue
            for key in ("start_date", "end_date", "actual_end_date"):
                value = row["fields"].get(key)
                if not value:
                    continue
                try:
                    all_dates.append(date.fromisoformat(value))
                except (TypeError, ValueError):
                    continue
        if not all_dates:
            raise CommandError("export has no status dates; pass --until")
        return max(all_dates)

    def _print_report(
        self,
        reports,
        window_start,
        until,
        clamped,
        merge_candidates,
        derived_mismatches,
        malformed_top_level,
    ):
        write = self.stdout.write
        if malformed_top_level:
            write(
                self.style.WARNING(
                    f"⚠ {malformed_top_level} строк(и) без 'model' проигнорированы"
                )
            )
        for name, report in reports.items():
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
        write(self.style.SUCCESS(f"open_end_clamped: {clamped}"))
        write(
            self.style.SUCCESS(
                f"window [{window_start.isoformat()}..{until.isoformat()}]"
            )
        )
        if merge_candidates:
            write(self.style.SUCCESS("merge candidates (AC-1, needs sanction):"))
            for candidate in merge_candidates:
                pks = ", ".join(str(pk) for pk in candidate["donor_pks"])
                write(f"  - iin {candidate['iin_masked']}: donor_pks [{pks}]")
        if derived_mismatches:
            write(self.style.WARNING("derived status mismatches (AC-1):"))
            for m in derived_mismatches:
                write(
                    f"  - employee {m['employee_id']} on {m['date']}: "
                    f"wrote {m['written']}, resolved {m['resolved']}"
                )
