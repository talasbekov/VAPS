"""Story 7.2 — самостоятельный импорт оргструктуры (без employees/statuses)."""

import io
from datetime import date
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    Organization,
    Position,
    Rank,
)
from apps.core.selectors import local_midnight

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"

pytestmark = pytest.mark.django_db


def run_import(*extra):
    out = io.StringIO()
    call_command(
        "import_donor_orgstructure",
        str(FIXTURE),
        "--as-of",
        "2026-06-01",
        *extra,
        stdout=out,
    )
    return out.getvalue()


class TestHappyPath:
    def test_org_structure_and_dictionaries_created(self):
        run_import()
        assert Organization.objects.filter(code="ORG1").exists()
        assert Division.objects.filter(code="DEP1").exists()
        assert Division.objects.filter(code="DIR1").exists()
        assert Rank.objects.count() == 2
        assert Position.objects.count() == 2

    def test_staffing_slots_created_from_staff_units(self):
        run_import()
        dep_slot = DivisionHistoricalSlot.objects.get(
            division=Division.objects.get(code="DEP1")
        )
        assert dep_slot.allocated_slots == 5
        assert dep_slot.valid_from == local_midnight(date(2026, 6, 1))

    def test_no_employees_or_statuses_touched(self):
        """AC scope: 7.2 импортирует ТОЛЬКО оргструктуру/ставки — employees и
        statuses остаются зоной 7.3/7.4 (не создаются здесь)."""
        from apps.core.models import Employee
        from apps.operations.statuses.models import EmployeeStatus

        run_import()
        assert Employee.objects.count() == 0
        assert EmployeeStatus.objects.count() == 0


class TestIdempotency:
    def test_second_run_creates_nothing(self):
        run_import()
        out = run_import()
        assert "divisions: read 2, created 0, updated 2, skipped 0" in out
        assert "organizations: read 1, created 0, updated 1, skipped 0" in out
        assert "ranks: read 2, created 0, updated 2, skipped 0" in out
        assert "positions: read 2, created 0, updated 2, skipped 0" in out
        assert "staffing_slots: read 6, created 0, updated 2, skipped 0" in out
        # 0 дублей (AC-1):
        assert Division.objects.count() == 2
        assert Organization.objects.count() == 1
        assert Rank.objects.count() == 2
        assert Position.objects.count() == 2
        assert DivisionHistoricalSlot.objects.count() == 2


class TestReport:
    def test_report_contains_counters(self):
        out = run_import()
        assert "divisions: read 2, created 2, updated 0, skipped 0" in out
        assert "organizations: read 1, created 1, updated 0, skipped 0" in out
        assert "staffing divisions covered: 2" in out
        assert "as-of: 2026-06-01" in out

    def test_as_of_defaults_to_today_when_omitted(self):
        from apps.core.clock import Clock

        out_io = io.StringIO()
        call_command("import_donor_orgstructure", str(FIXTURE), stdout=out_io)
        out = out_io.getvalue()
        assert f"as-of: {Clock.today_local().isoformat()}" in out

    def test_malformed_top_level_row_reported_not_fatal(self, tmp_path):
        import json

        export_path = tmp_path / "export.json"
        export_path.write_text(json.dumps(["not-a-dict-row"]), encoding="utf-8")
        out_io = io.StringIO()
        call_command(
            "import_donor_orgstructure",
            str(export_path),
            "--as-of",
            "2026-06-01",
            stdout=out_io,
        )
        out = out_io.getvalue()
        assert "1 строк(и) без 'model' проигнорированы" in out

    def test_bad_as_of_raises_command_error(self):
        from django.core.management.base import CommandError

        with pytest.raises(CommandError):
            call_command(
                "import_donor_orgstructure",
                str(FIXTURE),
                "--as-of",
                "not-a-date",
            )

    def test_slot_for_unimported_division_reason_surfaces(self, tmp_path):
        """AC-1: diff-отчёт с ПРИЧИНАМИ — не только через сестринскую
        import_donor_slice (уже покрыто test_import_command.py), но и через
        собственный _print_report этой команды."""
        import json

        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [{"model": "staff_unit.staffunit", "pk": 98, "fields": {
                    "division": 777, "position": None, "employee": None,
                }}]
            ),
            encoding="utf-8",
        )
        out_io = io.StringIO()
        call_command(
            "import_donor_orgstructure", str(export_path), "--as-of", "2026-06-01",
            stdout=out_io,
        )
        out = out_io.getvalue()
        assert "slot_division_skipped: 1 (examples: 777)" in out

    def test_dangling_parent_warning_surfaces(self, tmp_path):
        import json

        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
                    {
                        "model": "divisions.division",
                        "pk": 5,
                        "fields": {
                            "name": "Сирота",
                            "code": "ORPHAN",
                            "division_type": "department",
                            "parent": 999,  # не существует в выгрузке
                        },
                    }
                ]
            ),
            encoding="utf-8",
        )
        out_io = io.StringIO()
        call_command(
            "import_donor_orgstructure", str(export_path), "--as-of", "2026-06-01",
            stdout=out_io,
        )
        out = out_io.getvalue()
        assert "dangling_parent: 1 (examples: 5)" in out
        assert Division.objects.get(code="ORPHAN").parent is None


class TestDirtyInputSurvival:
    """Story 7.2 ревью-фикс: структурно повреждённая строка ВНУТРИ модели
    (нет 'fields'/'pk') не должна ронять всю транзакцию (KeyError)."""

    def test_division_row_missing_fields_does_not_crash(self, tmp_path):
        import json

        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
                    {"model": "divisions.division", "pk": 1},  # нет 'fields'
                    {
                        "model": "divisions.division",
                        "pk": 2,
                        "fields": {
                            "name": "ОК",
                            "code": "OK1",
                            "division_type": "organization",
                            "parent": None,
                        },
                    },
                ]
            ),
            encoding="utf-8",
        )
        out_io = io.StringIO()
        call_command(
            "import_donor_orgstructure", str(export_path), "--as-of", "2026-06-01",
            stdout=out_io,
        )
        out = out_io.getvalue()
        assert "malformed_row: 1" in out
        assert Organization.objects.filter(code="OK1").exists()

    def test_rank_row_missing_pk_does_not_crash(self, tmp_path):
        import json

        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
                    {"model": "dictionaries.rank", "fields": {"name": "x", "level": 1}},
                    {
                        "model": "dictionaries.rank",
                        "pk": 1,
                        "fields": {"name": "Полковник", "level": 5},
                    },
                ]
            ),
            encoding="utf-8",
        )
        out_io = io.StringIO()
        call_command(
            "import_donor_orgstructure", str(export_path), "--as-of", "2026-06-01",
            stdout=out_io,
        )
        out = out_io.getvalue()
        assert "malformed_row: 1" in out
        assert Rank.objects.filter(code="RANK_1").exists()
