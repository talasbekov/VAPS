"""Story 20.4a (FR-40): build_employees_csv() — чистый рендерер, с
маскированием ИИН через существующий mask_employee_data(), ОДИН запрос
политик масок независимо от числа строк (NFR-4)."""

import csv
import io

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.exports.employee_csv import EMPLOYEE_CSV_COLUMNS, build_employees_csv
from apps.core.models import SensitiveFieldPolicy

pytestmark = pytest.mark.django_db


def decode_rows(csv_bytes):
    return list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))))


def test_iin_masked_without_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin",
        permission_code="employee.sensitive.view",
        mask_strategy="PARTIAL_MASK",
    )
    rows = [{"iin": "900101300123", "full_name": "Иванов"}]

    result = build_employees_csv(rows, user_permissions=set())

    decoded = decode_rows(result)
    assert decoded[0]["iin"] != "900101300123"
    assert decoded[0]["iin"].endswith("0123")


def test_iin_visible_with_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin",
        permission_code="employee.sensitive.view",
        mask_strategy="PARTIAL_MASK",
    )
    rows = [{"iin": "900101300123", "full_name": "Иванов"}]

    result = build_employees_csv(rows, user_permissions={"employee.sensitive.view"})

    decoded = decode_rows(result)
    assert decoded[0]["iin"] == "900101300123"


def test_header_row_has_expected_columns():
    result = build_employees_csv([], user_permissions=set())

    header = result.decode("utf-8").splitlines()[0]
    assert header == ",".join(EMPLOYEE_CSV_COLUMNS)


def test_empty_rows_produce_header_only():
    result = build_employees_csv([], user_permissions=set())

    lines = result.decode("utf-8").splitlines()
    assert len(lines) == 1


def test_special_characters_round_trip():
    rows = [{"full_name": 'Иванов, Иван "Ваня"'}]

    result = build_employees_csv(rows, user_permissions=set())

    decoded = decode_rows(result)
    assert decoded[0]["full_name"] == 'Иванов, Иван "Ваня"'


@pytest.mark.parametrize("payload", ["=cmd|'/c calc'!A0", "+1+1", "-2+3", "@SUM(1,1)"])
def test_formula_injection_is_neutralized(payload):
    # Review (Blind Hunter + Edge Case Hunter, независимо совпали, CWE-1236):
    # full_name собирается из last_name/first_name/middle_name без
    # ограничения символов — значение, начинающееся с =/+/-/@, не должно
    # исполниться как формула при открытии в Excel/LibreOffice.
    rows = [{"full_name": payload}]

    result = build_employees_csv(rows, user_permissions=set())

    decoded = decode_rows(result)
    assert decoded[0]["full_name"] == "'" + payload


def test_single_query_regardless_of_row_count():
    rows = [{"full_name": f"Сотрудник {i}"} for i in range(10)]

    with CaptureQueriesContext(connection) as ctx:
        build_employees_csv(rows, user_permissions=set())

    assert len(ctx.captured_queries) == 1
