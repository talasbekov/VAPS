"""Story 7.4 — самостоятельный импорт статусов: интервальная модель +
convergence-проверка derived-статуса (AC-1)."""

import io
import json
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.core.models import Employee
from apps.operations.statuses.models import EmployeeStatus

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"

pytestmark = pytest.mark.django_db


def run_import(path=None, *extra):
    out = io.StringIO()
    call_command(
        "import_donor_statuses",
        str(path or FIXTURE),
        "--days",
        "7",
        "--until",
        "2026-06-07",
        *extra,
        stdout=out,
    )
    return out.getvalue()


class TestHappyPath:
    def test_statuses_imported_with_interval_model(self):
        out = run_import()
        assert "statuses: read 12, created 6, updated 0, skipped 6" in out
        assert EmployeeStatus.objects.count() == 6

    def test_no_overlapping_intervals_survive_for_same_employee(self):
        """AC-1: "интервалы не пересекаются" — DB exclusion constraint
        (excl_hard_status_overlap) is the enforcement; a genuine donor
        overlap is reported, not silently written twice."""
        out = run_import()
        assert "hard_overlap: 1 (examples: 102)" in out


class TestDerivedMismatch:
    def test_secondment_masked_by_training_is_reported(self):
        """Golden fixture: employee 2's DETACHED secondment (2026-06-03,
        open-end) starts while a STUDY (training, higher priority — lower
        number wins) interval is still active until 2026-06-05 (completed
        early 06-04 +1 half-open). AC-1: derived-статус на дату не
        совпадает с только что записанным — идёт в отчёт, не молча."""
        out = run_import()
        assert "derived status mismatches (AC-1):" in out
        assert "wrote DETACHED, resolved STUDY" in out
        emp2 = Employee.objects.get(external_id="2")
        # AC-1: интервал ВСЁ РАВНО записан (расхождение — информационная
        # находка, не повод пропустить импорт).
        assert EmployeeStatus.objects.filter(
            employee_id=emp2.id, status_type_code="DETACHED"
        ).exists()

    def _minimal_export_rows(self):
        return [
            {
                "model": "divisions.division",
                "pk": 1,
                "fields": {
                    "name": "Орг",
                    "code": "ORG1",
                    "division_type": "organization",
                    "parent": None,
                },
            },
            {
                "model": "divisions.division",
                "pk": 2,
                "fields": {
                    "name": "Деп",
                    "code": "DEP1",
                    "division_type": "department",
                    "parent": 1,
                },
            },
            {
                "model": "employees.employee",
                "pk": 1,
                "fields": {
                    "iin": "850101300101",
                    "personnel_number": "P1",
                    "last_name": "A",
                    "first_name": "B",
                    "middle_name": "",
                    "birth_date": "1990-01-01",
                    "hire_date": "2020-01-01",
                    "dismissal_date": None,
                    "employment_status": "working",
                    "rank": None,
                },
            },
            {
                "model": "staff_unit.staffunit",
                "pk": 1,
                "fields": {"division": 2, "position": None, "employee": 1},
            },
        ]

    def test_mismatch_detected_when_higher_priority_interval_starts_mid_span(
        self, tmp_path
    ):
        """Ревью-фикс: интервал STUDY (2026-06-01..06-11, half-open) не
        касается своих собственных границ конкурирующим фактом — COMMAND
        (приоритет 30 < STUDY 32) начинается СТРОГО ВНУТРИ (06-04), не на
        старте/конце. Проверка ТОЛЬКО start/end самого STUDY-интервала
        пропустила бы это; сэмплирование по стартам ДРУГИХ живых интервалов
        обязано поймать расхождение на 06-04."""
        rows = self._minimal_export_rows() + [
            {
                "model": "statuses.employeestatus",
                "pk": 100,
                "fields": {
                    "employee": 1,
                    "status_type": "training",  # -> STUDY, prio 32
                    "state": "active",
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-10",
                    "actual_end_date": None,
                },
            },
            {
                "model": "statuses.employeestatus",
                "pk": 101,
                "fields": {
                    "employee": 1,
                    "status_type": "business_trip",  # -> COMMAND, prio 30
                    "state": "active",
                    "start_date": "2026-06-04",
                    "end_date": "2026-06-06",
                    "actual_end_date": None,
                },
            },
        ]
        export_path = tmp_path / "export.json"
        export_path.write_text(json.dumps(rows), encoding="utf-8")
        out = run_import(export_path, "--until", "2026-06-10", "--days", "10")
        assert "derived status mismatches (AC-1):" in out
        assert "wrote STUDY, resolved COMMAND" in out
        # COMMAND's own written check is unaffected — it correctly wins on
        # its own span, no mismatch reported for it.
        assert "wrote COMMAND, resolved" not in out

    def test_no_mismatch_for_non_overlapping_intervals(self, tmp_path):
        rows = [
            {
                "model": "divisions.division",
                "pk": 1,
                "fields": {
                    "name": "Орг",
                    "code": "ORG1",
                    "division_type": "organization",
                    "parent": None,
                },
            },
            {
                "model": "divisions.division",
                "pk": 2,
                "fields": {
                    "name": "Деп",
                    "code": "DEP1",
                    "division_type": "department",
                    "parent": 1,
                },
            },
            {
                "model": "employees.employee",
                "pk": 1,
                "fields": {
                    "iin": "850101300101",
                    "personnel_number": "P1",
                    "last_name": "A",
                    "first_name": "B",
                    "middle_name": "",
                    "birth_date": "1990-01-01",
                    "hire_date": "2020-01-01",
                    "dismissal_date": None,
                    "employment_status": "working",
                    "rank": None,
                },
            },
            {
                "model": "staff_unit.staffunit",
                "pk": 1,
                "fields": {"division": 2, "position": None, "employee": 1},
            },
            {
                "model": "statuses.employeestatus",
                "pk": 100,
                "fields": {
                    "employee": 1,
                    "status_type": "vacation",
                    "state": "active",
                    "start_date": "2026-06-02",
                    "end_date": "2026-06-04",
                    "actual_end_date": None,
                },
            },
        ]
        export_path = tmp_path / "export.json"
        export_path.write_text(json.dumps(rows), encoding="utf-8")
        out = run_import(export_path)
        assert "derived status mismatches" not in out
        assert EmployeeStatus.objects.filter(status_type_code="VACATION").exists()


class TestIdempotency:
    def test_second_run_creates_nothing_new(self):
        run_import()
        out = run_import()
        assert "statuses: read 12, created 0, updated 0, skipped 12" in out
        assert EmployeeStatus.objects.count() == 6


class TestReport:
    def test_report_contains_reasons_and_window(self):
        out = run_import()
        assert "open_end_clamped: 1" in out
        assert "window [2026-06-01..2026-06-07]" in out

    def test_malformed_top_level_row_not_fatal(self, tmp_path):
        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
                    "not-a-dict",
                    {"model": "statuses.employeestatus", "pk": 1, "fields": {}},
                ]
            ),
            encoding="utf-8",
        )
        out = run_import(export_path, "--until", "2026-06-01")
        assert "1 строк(и) без 'model' проигнорированы" in out

    def test_days_less_than_one_rejected(self):
        from django.core.management.base import CommandError

        with pytest.raises(CommandError):
            call_command("import_donor_statuses", str(FIXTURE), "--days", "0")
