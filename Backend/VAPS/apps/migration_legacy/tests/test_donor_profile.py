"""Story 7.1 — категоризированный отчёт качества выгрузки донора."""

import json
from collections import defaultdict
from pathlib import Path

from apps.migration_legacy.donor_profile import RULES, profile_export

FIXTURE = (
    Path(__file__).parent / "fixtures" / "donor_slice.json"
)


def _by_model(rows):
    by_model = defaultdict(list)
    for row in rows:
        by_model[row["model"]].append(row)
    return by_model


def _golden_by_model():
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return _by_model(rows)


def test_every_category_has_a_rule():
    """AC-1: "для каждой категории записано правило" — non-empty for all."""
    for category, rule in RULES.items():
        assert rule.strip(), category


def test_golden_fixture_known_composition():
    """README.md спайка 1.11: employees=6, дубль ИИН pk1/pk7 (×2), NULL ИИН
    pk4, осиротевший статус pk110 — профилировщик обязан найти то же."""
    report = profile_export(_golden_by_model())

    assert report.employee_count == 6
    assert report.status_count == 12
    assert report.categories["missing_iin"].count == 1
    assert report.categories["duplicate_iin"].count == 2
    assert report.categories["orphaned_status"].count == 1
    assert report.categories["invalid_iin"].count == 0
    assert report.categories["unknown_employment_status"].count == 0
    assert report.categories["invalid_dates"].count == 0
    assert report.categories["status_invalid_dates"].count == 0
    assert report.categories["encoding_suspect"].count == 0
    assert report.categories["duplicate_personnel_number"].count == 0


def test_examples_are_pii_masked():
    report = profile_export(_golden_by_model())
    dup = report.categories["duplicate_iin"]
    assert dup.examples, "expected at least one example"
    for ex in dup.examples:
        assert "850101300101" not in ex
        assert ex.startswith("…")


def test_invalid_iin_format_detected():
    rows = [
        {
            "model": "employees.employee",
            "pk": 1,
            "fields": {
                "iin": "not-an-iin",
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
    report = profile_export(_by_model(rows))
    assert report.categories["invalid_iin"].count == 1


def test_unknown_employment_status_detected():
    rows = [
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
                "employment_status": "retired",  # not in EMPLOYMENT_STATUS_MAP
                "rank": None,
            },
        }
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["unknown_employment_status"].count == 1


def test_invalid_employee_date_detected():
    rows = [
        {
            "model": "employees.employee",
            "pk": 1,
            "fields": {
                "iin": "850101300101",
                "personnel_number": "P1",
                "last_name": "A",
                "first_name": "B",
                "middle_name": "",
                "birth_date": "not-a-date",
                "hire_date": "2020-01-01",
                "dismissal_date": None,
                "employment_status": "working",
                "rank": None,
            },
        }
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["invalid_dates"].count == 1


def test_duplicate_personnel_number_detected():
    def employee(pk, iin, pn):
        return {
            "model": "employees.employee",
            "pk": pk,
            "fields": {
                "iin": iin,
                "personnel_number": pn,
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

    rows = [
        employee(1, "850101300101", "SAME"),
        employee(2, "900202400202", "SAME"),
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["duplicate_personnel_number"].count == 2


def test_status_invalid_dates_detected():
    rows = [
        {
            "model": "statuses.employeestatus",
            "pk": 200,
            "fields": {
                "employee": 1,
                "start_date": "not-a-date",
                "end_date": "2020-01-05",
                "actual_end_date": None,
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
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["status_invalid_dates"].count == 1
    assert report.categories["orphaned_status"].count == 0


def test_orphaned_status_missing_employee_pk():
    rows = [
        {
            "model": "statuses.employeestatus",
            "pk": 201,
            "fields": {"employee": 999, "start_date": "2020-01-01", "end_date": None},
        },
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["orphaned_status"].count == 1


def test_encoding_suspect_detected():
    rows = [
        {
            "model": "employees.employee",
            "pk": 1,
            "fields": {
                "iin": "850101300101",
                "personnel_number": "P1",
                "last_name": "���",
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
    report = profile_export(_by_model(rows))
    assert report.categories["encoding_suspect"].count == 1


def test_no_employees_or_statuses_yields_empty_report():
    report = profile_export(_by_model([]))
    assert report.employee_count == 0
    assert report.status_count == 0
    for finding in report.categories.values():
        assert finding.count == 0
        assert finding.examples == []


def test_volume_reports_all_six_donor_models():
    report = profile_export(_golden_by_model())
    assert report.volume == {
        "divisions.division": 3,
        "dictionaries.rank": 2,
        "dictionaries.position": 2,
        "employees.employee": 6,
        "staff_unit.staffunit": 6,
        "statuses.employeestatus": 12,
    }


def test_malformed_row_missing_fields_does_not_crash_profiling():
    """Профилировщик существует ЧТОБЫ пережить грязный вход — структурно
    повреждённая строка (нет 'fields') не должна ронять весь прогон."""
    rows = [
        {"model": "employees.employee", "pk": 1},  # нет 'fields' вовсе
        {"model": "employees.employee", "pk": 2, "fields": "not-a-dict"},
        {
            "model": "employees.employee",
            "pk": 3,
            "fields": {
                "iin": "850101300101",
                "personnel_number": "P3",
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
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["malformed_row"].count == 2
    # третья, well-formed строка всё равно профилируется нормально:
    assert report.employee_count == 1


def test_unhashable_employment_status_does_not_crash_profiling():
    """transform_employee's EMPLOYMENT_STATUS_MAP.get(...) would raise
    TypeError on an unhashable value (e.g. a list) — profile_export must
    catch it and record malformed_row, not propagate the crash."""
    rows = [
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
                "employment_status": ["not", "hashable"],
                "rank": None,
            },
        }
    ]
    report = profile_export(_by_model(rows))
    assert report.categories["malformed_row"].count == 1


def test_encoding_suspect_ignores_non_string_field_instead_of_crashing():
    rows = [
        {
            "model": "employees.employee",
            "pk": 1,
            "fields": {
                "iin": "850101300101",
                "personnel_number": "P1",
                "last_name": 12345,  # malformed: int, not str
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
    report = profile_export(_by_model(rows))
    assert report.categories["encoding_suspect"].count == 0


def test_encoding_suspect_example_includes_offending_value():
    rows = [
        {
            "model": "employees.employee",
            "pk": 1,
            "fields": {
                "iin": "850101300101",
                "personnel_number": "P1",
                "last_name": "���",
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
    report = profile_export(_by_model(rows))
    example = report.categories["encoding_suspect"].examples[0]
    assert "last_name" in example


def test_profile_donor_export_command_runs_against_fixture(capsys):
    from django.core.management import call_command

    call_command("profile_donor_export", str(FIXTURE))
    out = capsys.readouterr().out
    assert "duplicate_iin: 2" in out
    assert "missing_iin: 1" in out
    assert "правило:" in out
    assert "объём по модели" in out
    assert "employees.employee: 6" in out


def test_profile_donor_export_command_survives_malformed_top_level_rows(
    tmp_path, capsys
):
    """Строка без 'model' (структурная порча ДО распределения по моделям) —
    не должна ронять команду; отдельное предупреждение, не CommandError."""
    from django.core.management import call_command

    export_path = tmp_path / "export.json"
    export_path.write_text(
        json.dumps(
            [
                "not-a-dict-row",
                {"pk": 1, "fields": {}},  # нет 'model'
                {
                    "model": "employees.employee",
                    "pk": 2,
                    "fields": {
                        "iin": "850101300101",
                        "personnel_number": "P2",
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
            ]
        ),
        encoding="utf-8",
    )

    call_command("profile_donor_export", str(export_path))
    out = capsys.readouterr().out
    assert "2 строк(и) без 'model' проигнорированы" in out
    assert "employees.employee: 1" in out
