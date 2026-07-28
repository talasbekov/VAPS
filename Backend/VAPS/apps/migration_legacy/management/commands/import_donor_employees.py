"""Story 7.3 — самостоятельный импорт сотрудников с identity mapping и
явной детекцией кандидатов на слияние дублей (AC-1: санкция человеком, не
автослияние).

Сотрудники ссылаются на УЖЕ импортированную оргструктуру (Division/Rank/
Position, Story 7.2). Эта команда резолвит division/rank/position map ТЕМ
ЖЕ путём, что ``import_donor_orgstructure`` — повторный вызов
``import_divisions``/``import_ranks``/``import_positions`` на той же
выгрузке идемпотентен (``update_or_create``), поэтому безопасно вызывать их
здесь снова вместо похода в БД за уже импортированными записями.
"""

import json
from collections import defaultdict

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


class Command(BaseCommand):
    help = (
        "Идемпотентный импорт сотрудников с identity mapping (Story 7.3). "
        "Дубли ИИН — кандидаты на слияние в отчёте, НЕ автослияние (AC-1). "
        "Требует оргструктуру в той же выгрузке (divisions/ranks/positions "
        "резолвятся повторным идемпотентным вызовом 7.2)."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="path to donor dumpdata JSON export")

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
                "ranks",
                "positions",
                "employees",
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

        self._print_report(
            reports,
            merge_candidates,
            malformed_top_level,
            employee_map,
            division_map,
            rank_map,
            position_pks,
        )

    def _print_report(
        self,
        reports,
        merge_candidates,
        malformed_top_level,
        employee_map,
        division_map,
        rank_map,
        position_pks,
    ):
        write = self.stdout.write
        if not division_map and not rank_map and not position_pks:
            # Ревью-фикс: "успешный" прогон с 0 сотрудников на пустой
            # оргструктуре неотличим от реального провала без явного
            # предупреждения — employees-only выгрузка (без секций
            # divisions/ranks/positions) технически валидна, но операторy
            # нужно явно знать, что это ОНА, а не битый файл.
            write(
                self.style.WARNING(
                    "⚠ выгрузка не содержит divisions/ranks/positions — "
                    "все сотрудники, скорее всего, уйдут в no_division "
                    "(это employees-only выгрузка?)"
                )
            )
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
        write(self.style.SUCCESS(f"employees imported: {len(employee_map)}"))
        # AC-1: кандидаты на слияние — отчёт на ручную санкцию, не автослияние.
        if merge_candidates:
            write(self.style.SUCCESS("merge candidates (AC-1, needs sanction):"))
            for candidate in merge_candidates:
                pks = ", ".join(str(pk) for pk in candidate["donor_pks"])
                write(f"  - iin {candidate['iin_masked']}: donor_pks [{pks}]")
