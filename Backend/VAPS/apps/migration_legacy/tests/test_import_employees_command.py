"""Story 7.3 — самостоятельный импорт сотрудников: identity mapping +
явная детекция кандидатов на слияние (AC-1)."""

import io
import json
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.core.models import Employee

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"

pytestmark = pytest.mark.django_db


def run_import(path=None, *extra):
    out = io.StringIO()
    call_command(
        "import_donor_employees", str(path or FIXTURE), *extra, stdout=out
    )
    return out.getvalue()


class TestHappyPath:
    def test_employees_created_with_identity_mapping(self):
        run_import()
        # Golden fixture: employees=6, минус missing_iin(4)/no_division(5)/
        # duplicate ИИН(7) = 3 реально импортированных (та же арифметика,
        # что и у import_donor_slice — тот же transform_employee).
        assert Employee.objects.count() == 3
        assert Employee.objects.filter(external_id="1").exists()
        assert not Employee.objects.filter(external_id="7").exists()


class TestMergeCandidates:
    def test_duplicate_iin_reported_as_merge_candidate_not_auto_merged(self):
        """AC-1: pk1 и pk7 (один человек, тот же ИИН) — кандидат на
        слияние в отчёте, НЕ автослияние; импортирован только pk1."""
        out = run_import()
        assert "merge candidates (AC-1, needs sanction):" in out
        assert "donor_pks [1, 7]" in out
        assert Employee.objects.filter(external_id="1").exists()
        assert not Employee.objects.filter(external_id="7").exists()

    def test_merge_candidate_iin_is_masked(self):
        out = run_import()
        assert "850101300101" not in out  # сырой ИИН никогда не печатается
        assert "…" in out

    def test_no_duplicates_yields_no_merge_candidates_section(self, tmp_path):
        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
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
                    }
                ]
            ),
            encoding="utf-8",
        )
        out = run_import(export_path)
        assert "merge candidates" not in out

    def test_three_way_duplicate_all_grouped_together(self, tmp_path):
        def emp(pk):
            return {
                "model": "employees.employee",
                "pk": pk,
                "fields": {
                    "iin": "850101300101",
                    "personnel_number": f"P{pk}",
                    "last_name": "A",
                    "first_name": "B",
                    "middle_name": "",
                    "birth_date": "1990-01-01",
                    "hire_date": "2020-01-01",
                    "dismissal_date": None,
                    "employment_status": "working",
                    "rank": None,
                },
            }

        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps([emp(10), emp(20), emp(30)]), encoding="utf-8"
        )
        out = run_import(export_path)
        assert "donor_pks [10, 20, 30]" in out
        assert Employee.objects.count() == 0  # no division -> no_division skip too
        # AC-1: только один кандидат-группа, не три отдельных
        assert out.count("merge candidates") == 1


class TestMergeGroupFallback:
    """Review fix: если ПЕРВЫЙ (по сортировке pk) кандидат группы дублей
    падает по причине, не связанной с самим дублем (no_division), СЛЕДУЮЩИЙ
    кандидат группы всё равно получает реальную попытку — группа не должна
    молча дать НОЛЬ импортированных сотрудников."""

    def _export_with(self, tmp_path, employees, staff_units, divisions=None):
        rows = list(
            divisions
            or [
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
            ]
        )
        rows += employees + staff_units
        export_path = tmp_path / "export.json"
        export_path.write_text(json.dumps(rows), encoding="utf-8")
        return export_path

    def _emp(self, pk):
        return {
            "model": "employees.employee",
            "pk": pk,
            "fields": {
                "iin": "850101300101",
                "personnel_number": f"P{pk}",
                "last_name": "A",
                "first_name": "B",
                "middle_name": "",
                "birth_date": "1990-01-01",
                "hire_date": "2020-01-01",
                "dismissal_date": None,
                "employment_status": "working",
                "rank": None,
            },
        }

    def test_second_candidate_wins_when_first_has_no_division(self, tmp_path):
        # pk1 — дубль-ИИН, БЕЗ staff_unit (не сможет резолвнуть division).
        # pk2 — тот же ИИН, ЕСТЬ staff_unit → должен быть импортирован.
        path = self._export_with(
            tmp_path,
            employees=[self._emp(1), self._emp(2)],
            staff_units=[
                {
                    "model": "staff_unit.staffunit",
                    "pk": 100,
                    "fields": {"division": 2, "position": None, "employee": 2},
                }
            ],
        )
        out = run_import(path)
        assert not Employee.objects.filter(external_id="1").exists()
        assert Employee.objects.filter(external_id="2").exists()
        assert "no_division: 1 (examples: 1)" in out
        assert "duplicate_iin: 1 (examples: 2)" not in out
        assert "employees imported: 1" in out

    def test_group_reports_zero_only_when_every_candidate_fails(self, tmp_path):
        # Ни у pk1, ни у pk2 нет staff_unit — вся группа обязана честно
        # провалиться (оба no_division), а не молча "выбрать" несуществующего.
        path = self._export_with(
            tmp_path, employees=[self._emp(1), self._emp(2)], staff_units=[]
        )
        out = run_import(path)
        assert Employee.objects.count() == 0
        assert "no_division: 2 (examples: 1, 2)" in out
        assert "employees imported: 0" in out


class TestIdempotency:
    def test_second_run_creates_nothing_new(self):
        run_import()
        out = run_import()
        assert "employees: read 6, created 0, updated 3, skipped 3" in out
        assert Employee.objects.count() == 3


class TestReport:
    def test_report_contains_reasons(self):
        out = run_import()
        assert "missing_iin: 1 (examples: 4)" in out
        assert "no_division: 1 (examples: 5)" in out
        assert "duplicate_iin: 1 (examples: 7)" in out
        assert "employees imported: 3" in out

    def test_malformed_top_level_row_not_fatal(self, tmp_path):
        export_path = tmp_path / "export.json"
        export_path.write_text(json.dumps(["not-a-dict"]), encoding="utf-8")
        out = run_import(export_path)
        assert "1 строк(и) без 'model' проигнорированы" in out

    def test_employees_only_export_warns_about_empty_orgstructure(self, tmp_path):
        export_path = tmp_path / "export.json"
        export_path.write_text(
            json.dumps(
                [
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
                    }
                ]
            ),
            encoding="utf-8",
        )
        out = run_import(export_path)
        assert "выгрузка не содержит divisions/ranks/positions" in out
