"""Story 20.4b (FR-40): build_history_csv() — чистый рендерер, БЕЗ
маскирования (EmployeeDivisionHistory несёт только FK+даты, нет
чувствительных полей на строке)."""

import csv
import datetime
import io

from apps.core.exports.history_csv import HISTORY_CSV_COLUMNS, build_history_csv


def decode_rows(csv_bytes):
    return list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))))


def row(**overrides):
    base = {
        "employee_id": "11111111-1111-1111-1111-111111111111",
        "employee_full_name": "Иванов Иван Иванович",
        "division_id": "22222222-2222-2222-2222-222222222222",
        "division_name": "Отдел А",
        "starts_at": "2026-07-01T00:00:00+00:00",
        "ends_at": "2026-07-31T00:00:00+00:00",
        "source": "MANUAL",
    }
    base.update(overrides)
    return base


def test_header_has_all_columns():
    result = build_history_csv([])
    header = result.decode("utf-8").splitlines()[0]
    assert header == ",".join(HISTORY_CSV_COLUMNS)


def test_closed_transfer_has_both_dates():
    result = build_history_csv([row()])
    decoded = decode_rows(result)
    assert decoded[0]["starts_at"] == "2026-07-01T00:00:00+00:00"
    assert decoded[0]["ends_at"] == "2026-07-31T00:00:00+00:00"


def test_open_transfer_renders_empty_ends_at():
    result = build_history_csv([row(ends_at=None)])
    decoded = decode_rows(result)
    assert decoded[0]["ends_at"] == ""
    assert "None" not in result.decode("utf-8")


def test_empty_rows_gives_header_only():
    result = build_history_csv([])
    lines = result.decode("utf-8").splitlines()
    assert len(lines) == 1


def test_formula_injection_prefix_is_sanitized():
    result = build_history_csv([row(employee_full_name="=cmd|'/c calc'!A1")])
    decoded = decode_rows(result)
    assert decoded[0]["employee_full_name"].startswith("'=")


def test_comma_and_quote_round_trip():
    tricky = 'Иванов, Иван "Ваня"'
    result = build_history_csv([row(employee_full_name=tricky)])
    decoded = decode_rows(result)
    assert decoded[0]["employee_full_name"] == tricky


def test_raw_datetime_normalizes_to_isoformat():
    """Ревью (Edge Case Hunter): вызывающий код может забыть
    `.isoformat()` и передать сырой `datetime` — рендер обязан быть
    консистентным ISO-8601, не `str(datetime)`'s пробел-разделитель."""
    ts = datetime.datetime(2026, 7, 1, 12, 30, tzinfo=datetime.timezone.utc)
    result = build_history_csv([row(starts_at=ts, ends_at=None)])
    decoded = decode_rows(result)
    assert decoded[0]["starts_at"] == ts.isoformat()
    assert "None" not in result.decode("utf-8")
