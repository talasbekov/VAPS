"""Import the personnel-system roster. Default mode is a read-only preview."""

import json
import os
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from organization_management.apps.staff_unit.roster_import import (
    apply_import,
    prepare_import,
)
from organization_management.apps.staff_unit.roster_photos import (
    PhotoError,
    scan_photos,
)
from organization_management.apps.staff_unit.roster_xlsx import (
    infer_divisions,
    read_roster,
)

CONFIG_KEYS = {
    "divisions",
    "division_codes",
    "position_codes",
    "rank_codes",
    "position_levels",
    "rank_levels",
    "iin_overrides",
}


def read_config(path):
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise CommandError("Не удалось прочитать JSON-настройки.") from exc
    if not isinstance(data, dict) or set(data) - CONFIG_KEYS:
        raise CommandError(
            "Неизвестные ключи настроек. Допустимы: " + ", ".join(sorted(CONFIG_KEYS))
        )
    for key, values in data.items():
        if not isinstance(values, dict):
            raise CommandError(f"{key} должен быть объектом JSON.")
        if key.endswith("_codes") and any(
            not isinstance(v, str) or not v.strip() for v in values.values()
        ):
            raise CommandError(f"{key}: коды должны быть непустыми строками.")
        if key == "iin_overrides" and any(
            v is not None and not isinstance(v, str) for v in values.values()
        ):
            raise CommandError(
                "iin_overrides: исправленный ИИН должен быть строкой либо null."
            )
        if key == "divisions":
            for code, node in values.items():
                if not isinstance(node, dict) or any(
                    v is not None and not isinstance(v, str) for v in node.values()
                ):
                    raise CommandError(
                        f"divisions.{code}: значения должны быть строками либо null."
                    )
                if any(
                    node.get(k) is None for k in ("name", "division_type") if k in node
                ):
                    raise CommandError(
                        f"divisions.{code}: name/division_type не могут быть null."
                    )
    return data


class Command(BaseCommand):
    help = "Штатка XLSX: проверка дерева/сотрудников, затем явное --apply; без удаления отсутствующих строк."
    requires_system_checks = ()

    def add_arguments(self, parser):
        parser.add_argument("xlsx_path")
        parser.add_argument(
            "--photos-dir",
            help="Папка с фото: ИИН.jpg/jpeg/png; отсутствие файла сохраняет прежнее фото.",
        )
        parser.add_argument(
            "--sheet", help="Имя листа; обязательно для книги с несколькими листами."
        )
        parser.add_argument(
            "--config",
            help="JSON: подразделения, сопоставления кодов, уровни, исправления ИИН.",
        )
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--apply",
            action="store_true",
            help="Применить весь проверенный файл одной транзакцией.",
        )
        mode.add_argument(
            "--check-file",
            action="store_true",
            help="Только файл и предложенное дерево, без обращения к БД.",
        )
        parser.add_argument(
            "--skip-invalid-iin",
            action="store_true",
            help="Явно оставить неверный ИИН пустым; существующий ИИН не стирается.",
        )
        parser.add_argument(
            "--match-dictionary-names",
            action="store_true",
            help="Использовать существующий код по единственному точному названию должности/звания.",
        )
        parser.add_argument(
            "--report",
            help="Новый JSON-файл отчёта (права 600); существующий файл не перезаписывается.",
        )

    def handle(self, *args, **options):
        config = read_config(options["config"])
        roster = read_roster(
            options["xlsx_path"],
            sheet=options["sheet"],
            skip_invalid_iin=options["skip_invalid_iin"],
            iin_overrides=config.get("iin_overrides"),
        )
        if options["check_file"]:
            tree, errors, warnings = infer_divisions(roster.rows)
            photos = scan_photos(roster.rows, options["photos_dir"])
            report = {
                "errors": roster.errors + errors + photos.errors,
                "photos": photos.counts,
                "warnings": roster.warnings + warnings + photos.warnings,
                "divisions": list(tree.values()),
                "counts": {},
                "actions": [],
                "applied": False,
            }
            self.stdout.write(
                "ПРОВЕРКА ФАЙЛА — без БД; настройки дерева сверяются при обычной проверке."
            )
        else:
            report = None
        output = None
        if options["report"]:
            try:
                fd = os.open(
                    options["report"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
                )
                output = os.fdopen(fd, "w", encoding="utf-8")
            except OSError as exc:
                raise CommandError(
                    "Не удалось создать новый файл отчёта; существующий файл не перезаписывается."
                ) from exc
        try:
            if report is None:
                try:
                    plan = (
                        apply_import(
                            roster,
                            config,
                            match_dictionary_names=options["match_dictionary_names"],
                            photos_dir=options["photos_dir"],
                        )
                        if options["apply"]
                        else prepare_import(
                            roster,
                            config,
                            match_dictionary_names=options["match_dictionary_names"],
                            photos_dir=options["photos_dir"],
                        )
                    )
                except (DatabaseError, ValidationError, PhotoError) as exc:
                    # Avoid dumping SQL parameters (including personal identifiers).
                    raise CommandError(
                        f"Импорт не выполнен ({type(exc).__name__}); проверьте миграции и ограничения данных. Транзакция записи отменена."
                    ) from exc
                report = plan.report()
                report["applied"] = bool(options["apply"] and not report["errors"])
                self.stdout.write(
                    "ПРИМЕНЕНО"
                    if report["applied"]
                    else "ПРОВЕРКА — данные не изменены"
                )
            report["rows"] = len(roster.rows)
            for node in report["divisions"]:
                self.stdout.write(
                    f"{node['code']}: {node['name']} [{node['division_type'] or 'тип не определён'}] → родитель {node['parent_code'] or '—'}"
                )
            counts = report["counts"]
            if options["check_file"]:
                self.stdout.write(
                    f"Строк: {len(roster.rows)}; предложено узлов: {len(report['divisions'])}."
                )
            else:
                self.stdout.write(
                    f"Строк: {len(roster.rows)}; создать: {counts.get('create', 0)}; обновить: {counts.get('update', 0)}; без изменений: {counts.get('keep', 0)}."
                )
            if report.get("photos"):
                self.stdout.write(
                    f"Фото сопоставлено: {report['photos'].get('matched', 0)}."
                )
            for warning in report["warnings"]:
                self.stdout.write(self.style.WARNING(warning))
            if output:
                json.dump(report, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
            if report["errors"]:
                raise CommandError("\n".join(report["errors"]))
        finally:
            if output:
                output.close()
