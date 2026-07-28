"""Story 7.1 — CLI-обвязка над ``donor_profile.profile_export``.

В отличие от stdlib-only ``spikes/1.11-donor-export/profile_export.py`` —
здесь ORM-окружение уже доступно (management-команда), но сам профиль
считается чистой функцией (``donor_profile.py`` — без ORM).
"""

import json
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError

from apps.migration_legacy.donor_profile import profile_export


class Command(BaseCommand):
    help = (
        "Профиль качества полной выгрузки донора (Story 7.1): категории "
        "грязи (дубли ИИН/табельных, NULL, битые даты, кодировки, "
        "осиротевшие ссылки), количества, PII-маскированные примеры, "
        "правило обработки на каждую категорию."
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
            # Строка без 'model' — структурная порча дампа, а не одна из
            # категорий грязи (у неё даже нет модели, чтобы её посчитать);
            # profile_export дальше ловит порчу ВНУТРИ каждой модели
            # (malformed_row), это — порча ДО распределения по моделям.
            if isinstance(row, dict) and isinstance(row.get("model"), str):
                by_model[row["model"]].append(row)
            else:
                malformed_top_level += 1

        report = profile_export(by_model)

        self.stdout.write(f"# Профиль выгрузки: {options['file']}")
        if malformed_top_level:
            self.stdout.write(
                self.style.WARNING(
                    f"⚠ {malformed_top_level} строк(и) без 'model' проигнорированы "
                    "(структурная порча дампа, до распределения по моделям)"
                )
            )
        self.stdout.write("== объём по модели ==")
        for model, count in report.volume.items():
            self.stdout.write(f"  {model}: {count}")
        self.stdout.write(
            f"\nemployees: {report.employee_count}  statuses: {report.status_count}\n"
        )
        for category, finding in report.categories.items():
            self.stdout.write(f"== {category}: {finding.count} ==")
            self.stdout.write(f"  правило: {finding.rule}")
            if finding.examples:
                self.stdout.write(f"  примеры: {', '.join(finding.examples)}")
            self.stdout.write("")
