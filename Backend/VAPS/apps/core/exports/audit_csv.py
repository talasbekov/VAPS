"""Story 20.4c (FR-40): чистый рендерер журнала аудита в `.csv` —
ТОЛЬКО метаданные, БЕЗ `old_value`/`new_value`. Тот же прецедент, что
`apps/audit/diagnostics_export.py`'s `_audit_log_payload()` (Story 13.2)
уже установил: произвольный JSON-диф мутации — где реально живёт риск PII
бизнес-данных (напр. поля сотрудника через аудируемое изменение) —
безопаснее опустить всю колонку целиком, чем пытаться content-сканировать
вложенный JSON. Эта стори переиспользует то же решение, не изобретает
новое.

`AUDIT_CSV_COLUMNS` — ЗАФИКСИРОВАННЫЙ allowlist (не «всё, что есть в
dict»): даже если вызывающий код по ошибке положит `old_value`/`new_value`
в переданный `row`, билдер их не рендерит — колонки строятся ТОЛЬКО из
этого кортежа (test_payload_keys_in_row_do_not_leak_into_csv доказывает
это явно, не полагается на «фикстуры просто не содержат ключ»).

Ревью (Edge Case Hunter): `ip_address` — ОСОЗНАННОЕ отличие от
13.2's `_audit_log_payload()` (у того 7 полей, БЕЗ `ip_address`) — здесь
добавлен явно, т.к. IP — стандартный форензик-атрибут аудит-лога (кто
сделал изменение, откуда), не бизнес-PII сотрудника (в отличие от
`old_value`/`new_value`). `reason` (свободный текст) НАМЕРЕННО НЕ
экспортируется — тот же класс риска, что `old_value`/`new_value`
(человек может ввести что угодно), просто без активного regex-скраба,
который есть у `BugReport.description` (`diagnostics_export.py`'s
`scrub_description()`) — добавлять `reason` в этот allowlist без такой же
защиты запрещено."""

import csv
import io

from apps.core.exports.csv_safety import normalize_value, sanitize_cell

# Тест-тросик (Blind Hunter): любое будущее расширение этого кортежа
# ОБЯЗАНО не включать old_value/new_value — see
# test_audit_csv_columns_never_include_payload_fields.
AUDIT_CSV_COLUMNS = (
    "id",
    "actor_user_id",
    "action",
    "entity_type",
    "entity_id",
    "request_id",
    "ip_address",
    "created_at",
)


def build_audit_csv(rows) -> bytes:
    """`rows` — список УЖЕ загруженных построчных `dict` (селектор
    `AuditLogSelector.list()`-based, JOIN/проекция — ответственность
    вызывающего кода, не эта функция). `actor_user_id` экспортируется БЕЗ
    маскирования — это не FK на `Employee` (BR-ACCOUNT-002), уже
    экспонируется как есть в существующем read API аудита."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=AUDIT_CSV_COLUMNS)
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                column: sanitize_cell(normalize_value(row.get(column)))
                for column in AUDIT_CSV_COLUMNS
            }
        )

    return buffer.getvalue().encode("utf-8")
