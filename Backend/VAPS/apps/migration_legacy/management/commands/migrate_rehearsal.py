"""Story 7.6 — репетиция дня X: полный прогон на копии выгрузки ДВАЖДЫ
подряд, с замером времени и программной проверкой идемпотентности.

Вызывает ``full_import.run_full_import`` (та же логика, что
``import_donor_slice``, Story 1.6/7.6) напрямую, не через subprocess/
call_command+stdout — получает реальные ``EntityReport`` объекты
(``.created``), не парсит текст regex'ом.

AC-1 "второй прогон 0 изменений" проверяется ДВУМЯ независимыми способами
(ревью-фикс — 0 created одно не доказывает "0 изменений" буквально):

1. 0 СОЗДАННЫХ записей на втором прогоне (быстрый, точный fail с указанием
   какая сущность создала лишнее).
2. Фингерпринт значимых полей БД (не только количества строк, а сами
   значения) СРАЗУ ПОСЛЕ прогона 1 и СРАЗУ ПОСЛЕ прогона 2 — если
   ``update_or_create`` на прогоне 2 молча перезаписал строку ДРУГИМИ
   значениями (created=0, но данные изменились), это ловит проверка 2, не
   проверка 1.
"""

import copy
import hashlib
import json
import time

from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Division, DivisionHistoricalSlot, Employee, Organization
from apps.core.models import Position, Rank
from apps.migration_legacy.full_import import FullImportError, run_full_import
from apps.operations.statuses.models import EmployeeStatus


def _db_fingerprint():
    """Хэш значимых полей всех сущностей, которые трогают импортёры E7 —
    ловит "0 created, но значения изменились" (ревью-фикс)."""
    parts = []

    def add(label, rows):
        parts.append(label)
        for row in rows:
            parts.append("|".join(str(v) for v in row))

    add(
        "org",
        Organization.objects.order_by("code").values_list("code", "name"),
    )
    add(
        "div",
        Division.objects.order_by("organization_id", "code").values_list(
            "organization_id", "code", "name", "type_code_id", "parent_id"
        ),
    )
    add(
        "slot",
        DivisionHistoricalSlot.objects.order_by(
            "division_id", "valid_from"
        ).values_list("division_id", "valid_from", "allocated_slots"),
    )
    add("rank", Rank.objects.order_by("code").values_list("code", "name", "rank_index"))
    add(
        "pos",
        Position.objects.order_by("code").values_list("code", "name", "level"),
    )
    add(
        "emp",
        Employee.objects.order_by("external_id").values_list(
            "external_id",
            "iin",
            "personnel_number",
            "last_name",
            "first_name",
            "middle_name",
            "birth_date",
            "hire_date",
            "dismissal_date",
            "employment_status",
            "rank_code",
            "position_code",
            "division_id",
        ),
    )
    add(
        "status",
        EmployeeStatus.objects.order_by(
            "employee_id", "date_start", "status_type_code"
        ).values_list(
            "employee_id",
            "status_type_code",
            "date_start",
            "date_end",
            "cancelled_at",
        ),
    )
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


class Command(BaseCommand):
    help = (
        "Репетиция миграции (Story 7.6): полный импорт дважды подряд на "
        "одной выгрузке, замер времени, программная проверка идемпотентности "
        "(0 created + фингерпринт значений БД на втором прогоне). "
        "CommandError, если идемпотентность нарушена."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="path to donor dumpdata JSON export (копия)")
        parser.add_argument(
            "--days",
            type=int,
            default=3650,
            help=(
                "Окно импорта в днях (default: 3650 — фактически весь "
                "диапазон дат экспорта, не 5-7-дневное окно walking-skeleton)."
            ),
        )
        parser.add_argument("--until", default=None)

    def handle(self, *args, **options):
        try:
            with open(options["file"], encoding="utf-8") as fh:
                rows = json.load(fh)
        except (OSError, ValueError) as exc:
            raise CommandError(f"cannot read export: {exc}") from exc

        self.stdout.write(self.style.SUCCESS("=== Прогон 1 ==="))
        # deepcopy: rows передаются в общие импортёры, которые исторически
        # не обещают read-only доступ к 'fields' — общий mutable объект
        # между двумя прогонами сделал бы находку 2-го прогона недоказательной,
        # если бы прогон 1 когда-нибудь начал мутировать входные dict'ы
        # (ревью-фикс, защита от будущей регрессии, не текущий баг).
        result1, elapsed1 = self._timed_run(copy.deepcopy(rows), options)
        self._print_summary(result1, elapsed1)
        fingerprint1 = _db_fingerprint()

        self.stdout.write(self.style.SUCCESS("=== Прогон 2 (идемпотентность) ==="))
        result2, elapsed2 = self._timed_run(copy.deepcopy(rows), options)
        self._print_summary(result2, elapsed2)
        fingerprint2 = _db_fingerprint()

        created_on_rerun = {
            name: report.created for name, report in result2.reports.items()
        }
        total_created = sum(created_on_rerun.values())
        if total_created:
            offenders = ", ".join(
                f"{name}={count}" for name, count in created_on_rerun.items() if count
            )
            raise CommandError(
                f"ИДЕМПОТЕНТНОСТЬ НАРУШЕНА: второй прогон создал "
                f"{total_created} новых записей ({offenders}) — день X НЕ "
                "отрепетирован (AC-1)"
            )
        if fingerprint1 != fingerprint2:
            raise CommandError(
                "ИДЕМПОТЕНТНОСТЬ НАРУШЕНА: 0 created, но значения в БД "
                "изменились между прогонами (фингерпринт не совпал) — день "
                "X НЕ отрепетирован (AC-1)"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"✓ идемпотентность подтверждена: 0 created И фингерпринт БД "
                f"совпал на втором прогоне. Прогон 1: {elapsed1:.2f}s, "
                f"Прогон 2: {elapsed2:.2f}s"
            )
        )

    def _timed_run(self, rows, options):
        start = time.monotonic()
        try:
            result = run_full_import(rows, options["days"], options["until"])
        except FullImportError as exc:
            raise CommandError(str(exc)) from exc
        elapsed = time.monotonic() - start
        return result, elapsed

    def _print_summary(self, result, elapsed):
        write = self.stdout.write
        write(f"время: {elapsed:.2f}s")
        for name, report in result.reports.items():
            write(
                f"  {name}: read {report.read}, created {report.created}, "
                f"updated {report.updated}, skipped {report.skipped}"
            )
