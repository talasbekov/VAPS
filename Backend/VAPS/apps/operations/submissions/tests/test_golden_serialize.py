"""Юнит-тесты golden-сериализатора/загрузчика (6.8, Task 2) на синтетическом
снапшоте — БЕЗ БД (чистые функции), бегут в gate.
"""

import uuid

from apps.operations.submissions.golden import (
    dumps,
    expected_document_xml,
    expected_values,
    load_input,
)

_DIV = "11111111-1111-1111-1111-111111111111"
_E1 = "aaaaaaaa-0000-0000-0000-000000000001"
_E2 = "aaaaaaaa-0000-0000-0000-000000000002"
_E3 = "aaaaaaaa-0000-0000-0000-000000000003"
_E4 = "aaaaaaaa-0000-0000-0000-000000000004"


def _case():
    """input.json-подобный словарь (всё-строки): 4 в ростере, 1 ATTACHED."""
    return {
        "business_date": "2026-06-01",
        "division_id": _DIV,
        "staff_map": {_DIV: 3},
        "division_names": {_DIV: "Отдел Ф"},
        "snapshot": {
            "schema_version": 1,
            "roster": [
                {"employee_id": _E1, "full_name": "Иванов Иван", "rank": "капитан"},
                {"employee_id": _E2, "full_name": "Петров Пётр", "rank": "лейтенант"},
                {"employee_id": _E3, "full_name": "Сидоров Семён", "rank": ""},
                {"employee_id": _E4, "full_name": "Козлов Кузьма", "rank": "майор"},
            ],
            "rows": [
                {
                    "employee_id": _E1,
                    "status_type_code": "VACATION",
                    "status_id": "s1",
                    "date_start": "2026-05-30",
                    "date_end": "2026-06-05",
                    "source": "USER",
                },
                {
                    "employee_id": _E2,
                    "status_type_code": "DUTY",
                    "status_id": "s2",
                    "date_start": "2026-06-01",
                    "date_end": "2026-06-02",
                    "source": "USER",
                },
                {
                    "employee_id": _E3,
                    "status_type_code": "ATTACHED",
                    "status_id": "s3",
                    "date_start": "2026-05-01",
                    "date_end": "2026-07-01",
                    "source": "USER",
                },
            ],
        },
    }


def test_load_input_coerces_all_uuids_consistently():
    inp = load_input(_case())
    assert isinstance(inp["division_id"], uuid.UUID)
    assert all(isinstance(k, uuid.UUID) for k in inp["staff_map"])
    assert all(isinstance(k, uuid.UUID) for k in inp["division_names"])


def test_expected_values_numbers_and_convergence():
    vals = expected_values(load_input(_case()))
    totals = vals["totals"]
    assert totals["list_total"] == 3  # 4 в ростере − 1 ATTACHED
    assert totals["attached"] == 1
    assert totals["columns"]["VACATION"] == 1
    assert totals["columns"]["ON_DUTY"] == 1
    assert totals["columns"]["IN_SERVICE"] == 1  # E4 без фактов → «В строю»
    assert totals["vacancies"] == 0  # штат 3 == список 3
    assert vals["violations"] == []
    assert vals["warnings"] == []
    # сходимость Σ колонок == список
    assert sum(totals["columns"].values()) == totals["list_total"]
    # заголовок подразделения долетел (uuid-коэрция ключей верна)
    assert vals["rows"][0]["name"] == "Отдел Ф"


def test_expected_document_xml_deterministic_and_populated():
    inp = load_input(_case())
    xml1 = expected_document_xml(inp)
    xml2 = expected_document_xml(inp)
    assert xml1 == xml2  # детерминизм (нормализация + docx стабильны)
    assert b"w:rsid" not in xml1
    assert "Отдел Ф".encode() in xml1
    assert "Иванов Иван".encode() in xml1


def test_dumps_is_canonical():
    out = dumps({"b": 1, "a": 2})
    assert out.endswith("\n")
    assert out.index('"a"') < out.index('"b"')  # sort_keys
