"""Story 7.2 — самостоятельный импорт дерева подразделений, ставок и
справочников (звания/должности) из ПОЛНОЙ выгрузки донора.

В отличие от ``import_donor_slice`` (Story 1.6, walking skeleton) — здесь
НЕТ временного окна employees/statuses: это отдельный importer только для
оргструктуры, вызывающий ТЕ ЖЕ функции из ``import_orgstructure.py`` (не
копию — паритет с 1.6 гарантирован общим кодом, тем же путём, что 7.1
переиспользовал ``transform.transform_employee``).
"""

import json
from collections import defaultdict
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import DataError, IntegrityError, transaction

from apps.core.clock import Clock
from apps.migration_legacy.import_orgstructure import (
    EXAMPLE_LIMIT,
    EntityReport,
    import_divisions,
    import_positions,
    import_ranks,
    import_staffing_slots,
)


class Command(BaseCommand):
    help = (
        "Идемпотентный импорт дерева подразделений, должностей/званий и "
        "StaffingSlot из полной выгрузки донора (Story 7.2). Diff-отчёт: "
        "создано/обновлено/пропущено с причинами. Без employees/statuses — "
        "те импортёры 7.3/7.4."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="path to donor dumpdata JSON export")
        parser.add_argument(
            "--as-of",
            default=None,
            help=(
                "Дата точки отсчёта для DivisionHistoricalSlot.valid_from "
                "(YYYY-MM-DD, default: Clock.today_local()). У оргструктуры "
                "нет employee/status окна, откуда бы дата бралась иначе."
            ),
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

        if options["as_of"]:
            try:
                as_of = date.fromisoformat(options["as_of"])
            except ValueError as exc:
                raise CommandError(
                    f"--as-of is not a date: {options['as_of']!r}"
                ) from exc
        else:
            as_of = Clock.today_local()

        by_model = defaultdict(list)
        malformed_top_level = 0
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("model"), str):
                by_model[row["model"]].append(row)
            else:
                malformed_top_level += 1

        reports = {
            name: EntityReport()
            for name in (
                "organizations",
                "divisions",
                "staffing_slots",
                "ranks",
                "positions",
            )
        }

        try:
            with transaction.atomic():
                division_map = import_divisions(
                    by_model["divisions.division"],
                    reports["organizations"],
                    reports["divisions"],
                )
                slot_divisions_covered = import_staffing_slots(
                    by_model["staff_unit.staffunit"],
                    division_map,
                    as_of,
                    reports["staffing_slots"],
                )
                import_ranks(by_model["dictionaries.rank"], reports["ranks"])
                import_positions(
                    by_model["dictionaries.position"], reports["positions"]
                )
        except (DataError, IntegrityError) as exc:
            # Симметрично import_donor_slice: DB-уровневый сбой — чистый
            # CommandError, не сырой traceback (весь прогон атомарен и уже
            # откатился к этому моменту).
            raise CommandError(
                f"import failed, transaction rolled back: {exc}"
            ) from exc

        self._print_report(
            reports, as_of, slot_divisions_covered, malformed_top_level
        )

    def _print_report(
        self, reports, as_of, slot_divisions_covered, malformed_top_level
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
        write(
            self.style.SUCCESS(
                f"staffing divisions covered: {slot_divisions_covered}"
            )
        )
        write(self.style.SUCCESS(f"as-of: {as_of.isoformat()}"))
