"""Story 7.6 — репетиция миграции: полный прогон дважды, замер времени,
программная проверка идемпотентности (AC-1: второй прогон 0 изменений)."""

import io
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.models import Employee
from apps.operations.statuses.models import EmployeeStatus

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"

pytestmark = pytest.mark.django_db


def run_rehearsal(*extra):
    out = io.StringIO()
    call_command("migrate_rehearsal", str(FIXTURE), *extra, stdout=out)
    return out.getvalue()


class TestHappyPath:
    def test_second_run_creates_nothing(self):
        out = run_rehearsal("--days", "3650")
        assert "идемпотентность подтверждена: 0 created" in out
        # Итоговое состояние — как один прогон, не удвоенное (с --days 3650
        # окно шире, чем в 5-7-дневных тестах import_donor_slice, поэтому
        # больше donor-статусов попадает в окно — числа здесь СВОИ, не
        # копия test_import_command.py).
        assert Employee.objects.count() == 3
        assert EmployeeStatus.objects.count() == 7

    def test_both_runs_timed(self):
        out = run_rehearsal("--days", "3650")
        assert "время:" in out
        assert out.count("время:") == 2  # оба прогона замерены

    def test_first_run_actually_created_records(self):
        """Санити: если бы прогон 1 тоже ничего не создавал, "0 created на
        втором" был бы вакуумным — прогон 1 должен реально что-то создать."""
        out = run_rehearsal("--days", "3650")
        assert "employees: read 6, created 3" in out  # прогон 1
        assert "employees: read 6, created 0" in out  # прогон 2


class TestBrokenIdempotency:
    def test_command_guard_fires_on_reported_created(self, monkeypatch):
        """Проверяет ТОЛЬКО арифметику guard-условия в самой команде
        (total_created>0 -> CommandError) — подменяет возвращаемый
        EntityReport, не реальный импорт. НЕ доказывает, что команда ловит
        РЕАЛЬНОЕ нарушение идемпотентности импортёров — см.
        `test_real_non_idempotent_import_is_caught` ниже, который патчит
        нижний уровень и гоняет настоящий код (ревью-фикс Auditor'а: этот
        тест мокал не тот слой)."""
        from apps.migration_legacy.import_orgstructure import EntityReport
        from apps.migration_legacy.management.commands import (
            migrate_rehearsal as cmd_module,
        )

        call_count = {"n": 0}
        original = cmd_module.run_full_import

        def flaky(rows, days, until_option=None):
            call_count["n"] += 1
            result = original(rows, days, until_option)
            if call_count["n"] == 2:
                result.reports["employees"] = EntityReport()
                result.reports["employees"].created = 1
            return result

        monkeypatch.setattr(cmd_module, "run_full_import", flaky)
        with pytest.raises(CommandError, match="ИДЕМПОТЕНТНОСТЬ НАРУШЕНА"):
            run_rehearsal("--days", "3650")

    def test_real_non_idempotent_import_is_caught(self, monkeypatch):
        """Ревью-фикс (Acceptance Auditor): патчит НИЖНИЙ уровень
        (`import_ranks`), не сам `run_full_import` — второй вызов реально
        удаляет существующий Rank ПЕРЕД импортом, так что настоящий
        `update_or_create` внутри настоящего `import_ranks` реально создаёт
        новую запись. Доказывает, что команда ловит РЕАЛЬНОЕ нарушение
        идемпотентности через полный настоящий код-путь, не только свою
        собственную арифметику сравнения."""
        from apps.core.models import Rank
        from apps.migration_legacy import full_import as full_import_module

        original_import_ranks = full_import_module.import_ranks
        call_count = {"n": 0}

        def flaky_import_ranks(rows, report):
            call_count["n"] += 1
            if call_count["n"] == 2:
                # Ломаем идемпотентность по-настоящему: прогон 1 создал
                # Rank'и, здесь мы их удаляем ПЕРЕД повторным импортом —
                # реальный update_or_create ниже реально создаст их заново.
                Rank.objects.all().delete()
            return original_import_ranks(rows, report)

        monkeypatch.setattr(full_import_module, "import_ranks", flaky_import_ranks)
        with pytest.raises(CommandError, match="ИДЕМПОТЕНТНОСТЬ НАРУШЕНА"):
            run_rehearsal("--days", "3650")

    def test_fingerprint_catches_zero_created_but_changed_values(self, monkeypatch):
        """Ревью-фикс: "0 created" одно НЕ доказывает "0 изменений" (AC-1
        буквально) — если update_or_create молча перезаписал значения
        (created=0), фингерпринт БД должен поймать это независимо."""
        from apps.core.models import Rank
        from apps.migration_legacy import full_import as full_import_module

        original_import_ranks = full_import_module.import_ranks
        call_count = {"n": 0}

        def flaky_import_ranks(rows, report):
            call_count["n"] += 1
            result = original_import_ranks(rows, report)
            if call_count["n"] == 2:
                # created остаётся 0 (запись НЕ новая), но значение молча
                # меняем напрямую в обход update_or_create — имитация бага
                # "второй прогон переписал значение".
                Rank.objects.update(name="ИСПОРЧЕНО")
            return result

        monkeypatch.setattr(full_import_module, "import_ranks", flaky_import_ranks)
        with pytest.raises(
            CommandError, match="значения в БД изменились"
        ):
            run_rehearsal("--days", "3650")


class TestReport:
    def test_cannot_read_missing_file(self):
        with pytest.raises(CommandError):
            call_command("migrate_rehearsal", "/no/such/file.json")

    def test_bad_export_content_raises(self, tmp_path):
        export_path = tmp_path / "export.json"
        export_path.write_text("not json", encoding="utf-8")
        with pytest.raises(CommandError):
            call_command("migrate_rehearsal", str(export_path))

    def test_days_zero_rejected(self):
        with pytest.raises(CommandError):
            call_command("migrate_rehearsal", str(FIXTURE), "--days", "0")
