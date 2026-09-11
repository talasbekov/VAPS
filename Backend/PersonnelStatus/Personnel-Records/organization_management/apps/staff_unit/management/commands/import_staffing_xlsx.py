"""Import the personnel-system roster. Default mode is a read-only preview."""

import json
import os
import sys
import tempfile
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError
from openpyxl.utils.exceptions import IllegalCharacterError

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
    parent_replacement_warnings,
    read_roster,
    replace_missing_parents,
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


def read_account_password(path):
    if not path:
        return None
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(1025)
        password = raw.decode("utf-8-sig").removesuffix("\n").removesuffix("\r")
    except (OSError, UnicodeError) as exc:
        raise CommandError("Не удалось прочитать файл пароля.") from exc
    if not password or len(raw) > 1024 or any(c in password for c in "\r\n\0"):
        raise CommandError(
            "Файл пароля должен содержать одну непустую строку, не более 1024 байт."
        )
    return password


def write_accounts_export(path, logins, password):
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Учётные записи"
    sheet.freeze_panes = "A2"
    sheet.column_dimensions["A"].width = 36
    sheet.column_dimensions["B"].width = 28
    sheet.append(["Логин", "Пароль"])
    for row, login in enumerate(logins, 2):
        for column, value in enumerate((login, password), 1):
            cell = sheet.cell(row, column, value)
            # Literal text preserves leading zeros and prevents Excel formulas.
            cell.data_type = "s"
            cell.number_format = "@"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".accounts-", suffix=".xlsx", delete=False
        ) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            book.save(stream)
            stream.flush()
            os.fsync(stream.fileno())
        # Publish a complete file without replacing any existing export/symlink.
        os.link(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
        book.close()


class Command(BaseCommand):
    help = "Штатка XLSX: проверка дерева/сотрудников, затем явное --apply; без удаления отсутствующих строк."
    requires_system_checks = ()

    def add_arguments(self, parser):
        parser.add_argument("xlsx_path")
        parser.add_argument(
            "--accounts-export",
            help="Новый XLSX с логинами и установленным паролем всех учёток; только после успешного --apply, права600.",
        )
        parser.add_argument(
            "--account-password-file",
            help="Файл пароля для ВСЕХ учётных записей, включая администраторов; запись только с --apply.",
        )
        parser.add_argument(
            "--missing-parent-code",
            help="Код для отсутствующих родителей; родитель0 у этого кода означает корень.",
        )
        parser.add_argument(
            "--skip-invalid-photos",
            action="store_true",
            help="Пропускать повреждённые/неоднозначные фото, сохраняя сотрудника и прежнее фото.",
        )
        parser.add_argument(
            "--photos-dir",
            help="Папка с фото: ИИН.jpg/jpeg/png; отсутствие файла сохраняет прежнее фото.",
        )
        parser.add_argument(
            "--default-division-type",
            choices=["organization", "department", "directorate", "division"],
            help="Тип для подразделений без распознанного или существующего типа.",
        )
        parser.add_argument(
            "--root-division-code",
            help="Указанному коду назначить тип organization; явный config имеет приоритет.",
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
        account_password = read_account_password(options["account_password_file"])
        export_path = (
            Path(options["accounts_export"]).absolute()
            if options["accounts_export"]
            else None
        )
        if export_path:
            if account_password is None:
                raise CommandError(
                    "Для выгрузки учётных записей нужен файл устанавливаемого пароля."
                )
            if os.path.lexists(export_path):
                raise CommandError("Файл выгрузки уже существует; выберите новый путь.")
            if export_path.suffix.lower() != ".xlsx" or not export_path.parent.is_dir():
                raise CommandError(
                    "Для выгрузки нужен новый файл .xlsx в существующем каталоге."
                )
            if (
                options["report"]
                and Path(options["report"]).resolve() == export_path.resolve()
            ):
                raise CommandError(
                    "Файл выгрузки и JSON-отчёт должны иметь разные пути."
                )
        config = read_config(options["config"])
        roster = read_roster(
            options["xlsx_path"],
            sheet=options["sheet"],
            skip_invalid_iin=options["skip_invalid_iin"],
            iin_overrides=config.get("iin_overrides"),
        )
        if options["check_file"]:
            tree, errors, warnings = infer_divisions(
                roster.rows, explicit_hierarchy=bool(options["missing_parent_code"])
            )
            changes, replacement_errors = replace_missing_parents(
                tree, set(tree), options["missing_parent_code"], require_target=False
            )
            errors.extend(replacement_errors)
            warnings.extend(parent_replacement_warnings(changes))
            if options["missing_parent_code"]:
                warnings.append(
                    "Замены родителей при проверке файла предварительные: существующие родители в БД будут сохранены при сверке."
                )
            for code, node in tree.items():
                override = config.get("divisions", {}).get(code, {})
                node["division_type"] = (
                    override.get("division_type")
                    or (
                        "organization"
                        if code == options["root_division_code"]
                        else None
                    )
                    or node["division_type"]
                    or options["default_division_type"]
                )
            photos = scan_photos(
                roster.rows,
                options["photos_dir"],
                skip_invalid=options["skip_invalid_photos"],
            )
            report = {
                "errors": roster.errors + errors + photos.errors,
                "photos": photos.counts,
                "parent_replacements": changes,
                "password_reset": {
                    "scope": "all",
                    "accounts": None,
                    "updated": 0,
                    "unchanged": 0,
                }
                if account_password is not None
                else {},
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
        export_error = None

        def report_failure_message():
            if export_error:
                state = export_error
            elif report and report.get("applied"):
                state = (
                    "Импорт и смена паролей выполнены."
                    if account_password is not None
                    else "Импорт выполнен."
                )
                if report.get("accounts_export", {}).get("written"):
                    state += " Выгрузка сохранена."
            else:
                state = "Импорт не применён."
            return state + " JSON-отчёт сохранить не удалось."

        try:
            if report is None:
                try:
                    plan = (
                        apply_import(
                            roster,
                            config,
                            match_dictionary_names=options["match_dictionary_names"],
                            default_division_type=options["default_division_type"],
                            root_division_code=options["root_division_code"],
                            photos_dir=options["photos_dir"],
                            skip_invalid_photos=options["skip_invalid_photos"],
                            missing_parent_code=options["missing_parent_code"],
                            account_password=account_password,
                        )
                        if options["apply"]
                        else prepare_import(
                            roster,
                            config,
                            match_dictionary_names=options["match_dictionary_names"],
                            default_division_type=options["default_division_type"],
                            root_division_code=options["root_division_code"],
                            photos_dir=options["photos_dir"],
                            skip_invalid_photos=options["skip_invalid_photos"],
                            missing_parent_code=options["missing_parent_code"],
                            reset_account_passwords=account_password is not None,
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
            if export_path:
                report["accounts_export"] = {
                    "file": str(export_path),
                    "rows": 0,
                    "written": False,
                }
                if report["applied"]:
                    try:
                        write_accounts_export(
                            export_path, plan.account_logins, account_password
                        )
                    except (OSError, ValueError, IllegalCharacterError):
                        # The database transaction has committed. Never claim a rollback
                        # or include values from a workbook exception in the message.
                        export_error = "Импорт и смена паролей выполнены; не удалось сохранить выгрузку учётных записей. Проверьте доступ и свободное место, затем повторите запуск с новым путём выгрузки."
                    else:
                        report["accounts_export"].update(
                            rows=len(plan.account_logins), written=True
                        )
                        self.stdout.write(
                            f"Выгрузка учётных записей: {export_path}; строк: {len(plan.account_logins)}."
                        )
                else:
                    self.stdout.write(
                        "Выгрузка логинов и паролей будет создана только после успешного --apply."
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
                    f"Фото сопоставлено: {report['photos'].get('matched', 0)}; "
                    f"пропущено: {report['photos'].get('skipped', 0)}."
                )
            if report.get("password_reset"):
                reset = report["password_reset"]
                if report["applied"]:
                    self.stdout.write(
                        f"Пароли всех учётных записей: изменено {reset['updated']}; уже совпадали {reset['unchanged']}."
                    )
                else:
                    count = reset["accounts"]
                    self.stdout.write(
                        f"Планируется смена пароля ВСЕХ учётных записей, включая администраторов: {count if count is not None else 'число уточнится при сверке с БД'}. Пароли пока не изменены."
                    )
            for warning in report["warnings"]:
                self.stdout.write(self.style.WARNING(warning))
            if output:
                try:
                    json.dump(report, output, ensure_ascii=False, indent=2)
                    output.write("\n")
                    output.flush()
                except OSError:
                    raise CommandError(report_failure_message()) from None
            if report["errors"]:
                raise CommandError("\n".join(report["errors"]))
            if export_error:
                raise CommandError(export_error)
        finally:
            if output:
                error_in_flight = sys.exc_info()[0] is not None
                try:
                    output.close()
                except OSError:
                    if not error_in_flight:
                        raise CommandError(report_failure_message()) from None
