"""Story 7.7 — ночной инкремент: обёртка над ``full_import.run_full_import``
(Story 7.6) с узким окном (default: вчера) — закрывает TODO из Dev Notes
Story 7.0 ("инкремент-импорт... заглушка до 7.7").

Идемпотентность повторного инкремента УЖЕ гарантирована существующей
инфраструктурой (``update_or_create``/natural-key dedup, Story 1.6/7.2-7.4)
— эта команда не добавляет новой write-логики, только узкое окно + CLI.

Связь с ``parallel_run_mode`` (ревью-фикс — были функционально не связаны,
только общий номер стори): команда ОТКАЗЫВАЕТСЯ бежать, если режим
выключен, — тот же контракт, что epics.md уже фиксирует для Story 7.10
("cutover включает обязательный шаг «инкремент-импорт ОТКЛЮЧЁН»; запуск
импорта после cutover невозможен без явного флага --force-pre-cutover").
``--force-pre-cutover`` — тот же флаг по имени, форвард-совместимый с 7.10.
"""

import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from apps.core import parallel_run_mode
from apps.core.clock import Clock
from apps.migration_legacy.full_import import FullImportError, run_full_import
from apps.migration_legacy.import_orgstructure import EXAMPLE_LIMIT


class Command(BaseCommand):
    help = (
        "Ночной инкрементальный импорт (Story 7.7): узкое окно (default — "
        "вчера) поверх той же идемпотентной инфраструктуры, что и "
        "import_donor_slice (Story 1.6/7.2-7.4)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "file", help="path to donor dumpdata JSON export (инкремент)"
        )
        parser.add_argument(
            "--days",
            type=int,
            default=1,
            help="Ширина окна в днях (default: 1 — только вчерашний день).",
        )
        parser.add_argument(
            "--until",
            default=None,
            help="Конец окна YYYY-MM-DD (default: Clock.today_local() - 1 день).",
        )
        parser.add_argument(
            "--force-pre-cutover",
            action="store_true",
            help=(
                "Разрешить запуск при выключенном режиме (default: команда "
                "отказывается — donor больше не источник ввода после cutover, "
                "Story 7.10)."
            ),
        )

    def handle(self, *args, **options):
        if not parallel_run_mode.is_enabled() and not options["force_pre_cutover"]:
            raise CommandError(
                "режим «без двойного ввода» выключен — инкремент-импорт "
                "отказывается бежать без --force-pre-cutover (см. "
                "docstring, Story 7.10 semantics)"
            )

        try:
            with open(options["file"], encoding="utf-8") as fh:
                rows = json.load(fh)
        except (OSError, ValueError) as exc:
            raise CommandError(f"cannot read export: {exc}") from exc

        until = options["until"]
        if not until:
            until = (Clock.today_local() - timedelta(days=1)).isoformat()

        try:
            result = run_full_import(rows, options["days"], until)
        except FullImportError as exc:
            raise CommandError(str(exc)) from exc

        write = self.stdout.write
        for name, report in result.reports.items():
            write(
                self.style.SUCCESS(
                    f"{name}: read {report.read}, created {report.created}, "
                    f"updated {report.updated}, skipped {report.skipped}"
                )
            )
            for reason, pks in sorted(report.skips.items()):
                examples = ", ".join(str(pk) for pk in pks[:EXAMPLE_LIMIT])
                write(f"  - {reason}: {len(pks)} (examples: {examples})")
        write(
            self.style.SUCCESS(
                f"window [{result.window_start.isoformat()}.."
                f"{result.until.isoformat()}]"
            )
        )
