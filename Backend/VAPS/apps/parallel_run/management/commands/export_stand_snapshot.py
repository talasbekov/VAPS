"""Story 7.0 — минимальный экспорт-CLI: снимок результатов diff-джобы на
носитель. Без сетевого выхода из контура — пишет ТОЛЬКО на локальный путь
(volume/USB-точка монтирования, ``VAPS_STAND_EXPORT_DIR``).

Формат — json (простой, достаточный для ручного переноса; обобщается
переиспользуемой точкой расширения 13.2, здесь — не зависимость).
"""

import json
import os
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from apps.parallel_run.models import ParallelRunDay, ParallelRunDiff


class Command(BaseCommand):
    help = (
        "Экспорт снимка последних N дней diff-джобы (Story 6.9) в json-файл "
        "на локальный носитель (--out-dir, по умолчанию $VAPS_STAND_EXPORT_DIR). "
        "Без сети — только локальная запись."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--out-dir",
            help="Каталог назначения; по умолчанию $VAPS_STAND_EXPORT_DIR.",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Сколько последних (по run_date) ParallelRunDay включить "
            "(default: 30).",
        )

    def handle(self, *args, **options):
        out_dir = options.get("out_dir") or os.environ.get("VAPS_STAND_EXPORT_DIR")
        if not out_dir:
            raise CommandError(
                "--out-dir не задан и VAPS_STAND_EXPORT_DIR не установлена в окружении"
            )
        if options["days"] <= 0:
            raise CommandError(f"--days должен быть > 0, получено {options['days']}")
        try:
            os.makedirs(out_dir, exist_ok=True)
        except OSError as exc:
            raise CommandError(
                f"не удалось создать --out-dir {out_dir!r}: {exc}"
            ) from exc

        days = ParallelRunDay.objects.order_by("-run_date")[: options["days"]]
        day_rows = list(days)
        run_dates = [d.run_date for d in day_rows]
        diffs = ParallelRunDiff.objects.filter(run_date__in=run_dates).order_by(
            "run_date", "division_code", "column_code"
        )

        snapshot = {
            "exported_at": datetime.now().astimezone().isoformat(),
            "days": [
                {
                    "run_date": d.run_date.isoformat(),
                    "status": d.status,
                    "blocking_count": d.blocking_count,
                    "total_diffs": d.total_diffs,
                    "ran_at": d.ran_at.isoformat(),
                }
                for d in day_rows
            ],
            "diffs": [
                {
                    "run_date": row.run_date.isoformat(),
                    "division_code": row.division_code,
                    "column_code": row.column_code,
                    "donor_value": row.donor_value,
                    "vaps_value": row.vaps_value,
                    "delta": row.delta,
                    "category": row.category,
                    "is_blocking": row.is_blocking,
                    "pending_signature": row.pending_signature,
                }
                for row in diffs
            ],
        }

        filename = f"stand-snapshot-{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
        out_path = os.path.join(out_dir, filename)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)

        self.stdout.write(
            self.style.SUCCESS(
                f"Снимок сохранён: {out_path} "
                f"({len(day_rows)} дней, {len(snapshot['diffs'])} diff-строк)"
            )
        )
