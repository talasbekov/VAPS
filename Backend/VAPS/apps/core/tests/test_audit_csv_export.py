"""Story 20.4c (FR-40): build_audit_csv() — чистый рендерер, ТОЛЬКО
метаданные, БЕЗ old_value/new_value (тот же прецедент, что
apps/audit/diagnostics_export.py's _audit_log_payload(), Story 13.2)."""

import csv
import datetime
import io

from apps.core.exports.audit_csv import AUDIT_CSV_COLUMNS, build_audit_csv


def decode_rows(csv_bytes):
    return list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))))


def row(**overrides):
    base = {
        "id": "33333333-3333-3333-3333-333333333333",
        "actor_user_id": "operator-1",
        "action": "EMPLOYEE_UPDATED",
        "entity_type": "employee",
        "entity_id": "11111111-1111-1111-1111-111111111111",
        "request_id": "req-abc123",
        "ip_address": "10.0.0.5",
        "created_at": "2026-07-08T09:00:00+00:00",
    }
    base.update(overrides)
    return base


def test_header_has_exactly_the_metadata_columns():
    result = build_audit_csv([])
    header = result.decode("utf-8").splitlines()[0]
    assert header == ",".join(AUDIT_CSV_COLUMNS)
    assert "old_value" not in header
    assert "new_value" not in header


def test_metadata_row_renders_all_fields():
    result = build_audit_csv([row()])
    decoded = decode_rows(result)
    assert decoded[0]["actor_user_id"] == "operator-1"
    assert decoded[0]["action"] == "EMPLOYEE_UPDATED"
    assert decoded[0]["entity_type"] == "employee"
    assert decoded[0]["ip_address"] == "10.0.0.5"


def test_raw_datetime_normalizes_to_isoformat():
    ts = datetime.datetime(2026, 7, 8, 9, 0, tzinfo=datetime.timezone.utc)
    result = build_audit_csv([row(created_at=ts)])
    decoded = decode_rows(result)
    assert decoded[0]["created_at"] == ts.isoformat()


def test_empty_rows_gives_header_only():
    result = build_audit_csv([])
    lines = result.decode("utf-8").splitlines()
    assert len(lines) == 1


def test_formula_injection_prefix_is_sanitized():
    result = build_audit_csv([row(actor_user_id="=cmd|'/c calc'!A1")])
    decoded = decode_rows(result)
    assert decoded[0]["actor_user_id"].startswith("'=")


def test_audit_csv_columns_never_include_payload_fields():
    """Ревью (Blind Hunter): тросик против будущего дрейфа — если кто-то
    когда-нибудь «поможет» и добавит old_value/new_value (или их алиас)
    прямо в allowlist, этот тест обязан упасть немедленно, вместо того
    чтобы полагаться только на дисциплину код-ревью."""
    assert "old_value" not in AUDIT_CSV_COLUMNS
    assert "new_value" not in AUDIT_CSV_COLUMNS
    assert "reason" not in AUDIT_CSV_COLUMNS


def test_payload_keys_in_row_do_not_leak_into_csv():
    """AC-6: даже если вызывающий код ошибочно кладёт old_value/new_value
    в row-dict, allowlist-дисциплина билдера их не рендерит."""
    dirty_row = row(
        old_value={"iin": "900101300123", "full_name": "Иванов"},
        new_value={"iin": "900101300124", "full_name": "Иванов И."},
    )
    result = build_audit_csv([dirty_row])
    text = result.decode("utf-8")
    assert "old_value" not in text
    assert "new_value" not in text
    assert "900101300123" not in text
    assert "900101300124" not in text
    decoded = decode_rows(result)
    assert set(decoded[0].keys()) == set(AUDIT_CSV_COLUMNS)
