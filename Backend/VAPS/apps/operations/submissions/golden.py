"""Единый источник правды golden-master расхода (6.8).

Загрузка ``input.json`` и вычисление эталона (числа + нормализованный
``document.xml``) — ОДНИМ кодом для consumer-теста и ``make golden-update``
(анти-дрейф сериализации). Чисто: без ORM и без ``apps.core.models`` — все
core-производные (``staff_map``, ``division_names``) заморожены в ``input.json``
продюсером (Ловушка №2/№7).
"""

import json
import uuid
from datetime import date

from apps.documents.generators.docx_normalize import normalize_document_xml
from apps.documents.generators.expense_docx import generate_expense_docx
from apps.operations.statuses.services.strength_report import derive_report
from apps.operations.submissions.expense_document import build_expense_document


def dumps(obj) -> str:
    """Каноническая стабильная сериализация golden-JSON (диффабельность)."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def load_input(data: dict) -> dict:
    """``input.json`` (всё-строки) → входы с согласованной uuid-коэрцией.

    ``division_id`` И ключи ``staff_map``/``division_names`` → ``uuid.UUID``
    согласованно (Ловушка №3: иначе ``.get(uuid)`` по str-ключам молча
    промахивается → пустой заголовок/нулевой штат). Даты строк снапшота
    ОСТАЮТСЯ ISO — билдер/derive парсят их сами.
    """
    return {
        "snapshot": data["snapshot"],
        "business_date": date.fromisoformat(data["business_date"]),
        "division_id": uuid.UUID(data["division_id"]),
        "staff_map": {uuid.UUID(k): v for k, v in data["staff_map"].items()},
        "division_names": {uuid.UUID(k): v for k, v in data["division_names"].items()},
    }


def _parse_snapshot_rows(snapshot):
    """ISO-интервалы снапшота → date-объекты derive (зеркало билдера)."""
    return [
        {
            "employee_id": row["employee_id"],
            "status_type_code": row["status_type_code"],
            "date_start": date.fromisoformat(row["date_start"]),
            "date_end": date.fromisoformat(row["date_end"]),
        }
        for row in snapshot["rows"]
    ]


def _json_safe(findings):
    return [
        {k: str(v) if isinstance(v, uuid.UUID) else v for k, v in f.items()}
        for f in findings
    ]


def serialize_report(result) -> dict:
    """``StrengthReportResult`` → JSON-словарь (единый формат эталона чисел)."""
    return {
        "business_date": result.business_date.isoformat(),
        "rows": [
            {
                "division_id": str(row.division_id),
                "name": row.name,
                "staff_total": row.staff_total,
                "list_total": row.list_total,
                "vacancies": row.vacancies,
                "columns": dict(row.columns),
                "attached": row.attached,
            }
            for row in result.rows
        ],
        "totals": {
            "staff_total": result.totals.staff_total,
            "list_total": result.totals.list_total,
            "vacancies": result.totals.vacancies,
            "columns": dict(result.totals.columns),
            "attached": result.totals.attached,
        },
        "violations": _json_safe(result.violations),
        "warnings": _json_safe(result.warnings),
    }


def expected_values(inputs: dict) -> dict:
    """Слой ЧИСЕЛ: ``derive_report`` по входам снапшота → эталон-словарь."""
    snapshot = inputs["snapshot"]
    roster_ids = [member["employee_id"] for member in snapshot["roster"]]
    report = derive_report(
        {inputs["division_id"]: roster_ids},
        _parse_snapshot_rows(snapshot),
        inputs["staff_map"],
        inputs["business_date"],
        division_names=inputs["division_names"],
    )
    return serialize_report(report)


def expected_document_xml(inputs: dict) -> bytes:
    """Слой XML: build → ``generate_expense_docx`` → нормализованный document.xml."""
    data = build_expense_document(
        inputs["snapshot"],
        inputs["business_date"],
        staff_map=inputs["staff_map"],
        division_names=inputs["division_names"],
        division_id=inputs["division_id"],
    )
    return normalize_document_xml(generate_expense_docx(data))
