"""Story 10.7a — read-only JSON-поверхность тела расхода поверх
``build_expense_document`` (6.3).

Зеркало доктрины ``expense_read_service.py``: RBAC-free by contract (гейт —
в view), ЧИСТОЕ чтение — НЕТ ``allocate_number``/``IssuedDocument``/аудита.
Три гарда — байт-в-байт с release-путём (``document_release_service
.issue_expense_document``), СОЗНАТЕЛЬНО не абстрагированы в общую функцию
(Dev Notes 10.7a): read использует ``DailySubmissionSelector.current_for``
(БЕЗ lock/транзакции), write — ``latest_for(lock=True)`` внутри
``transaction.atomic()`` (сериализация с amendment) — разные селекторы,
разная семантика, дублирование трёх гвардов — явное и осознанное.

Приватные хелперы ``_parse_snapshot_rows``/``_json_safe_findings`` —
in-app прецедент (Д9, зеркало ``summary_service.py``).
"""

from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector, CoreStaffingSelector
from apps.operations.statuses.services.strength_report import derive_report
from apps.operations.submissions.expense_document import build_expense_document
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services.document_release_service import (
    _json_safe_findings,
    _parse_snapshot_rows,
)
from apps.operations.submissions.services.snapshot import SCHEMA_VERSION


def read_expense_document(*, division_id, business_date):
    """Снапшот действующей сдачи (division, date) → ``ExpenseDocumentData``.

    БЕЗ lock/транзакции (read-only): в отличие от выпуска, здесь нет гонки
    с amendment, требующей сериализации.
    """
    current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None:
        raise DomainError(
            "REPORT_NOT_READY_FOR_DATE",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="Нет сдачи за дату — выпускать нечего.",
        )

    snapshot = current.snapshot
    version = snapshot.get("schema_version")
    if type(version) is not int or version != SCHEMA_VERSION:
        raise DomainError(
            "SNAPSHOT_SCHEMA_UNSUPPORTED",
            422,
            detail={
                "schema_version": repr(version),
                "supported": SCHEMA_VERSION,
            },
            message="Снапшот сдачи имеет неподдерживаемую версию схемы.",
        )

    staff_map = CoreStaffingSelector.allocated_slots_on(business_date, [division_id])
    division_names = CoreDivisionTreeSelector.divisions_map([division_id])

    roster_ids = [member["employee_id"] for member in snapshot["roster"]]
    report = derive_report(
        {division_id: roster_ids},
        _parse_snapshot_rows(snapshot),
        staff_map,
        business_date,
        division_names=division_names,
    )
    if report.violations or report.warnings:
        raise DomainError(
            "REPORT_NOT_CONVERGENT",
            422,
            detail={
                "violations": _json_safe_findings(report.violations),
                "warnings": _json_safe_findings(report.warnings),
            },
            message="Формулы сходимости расхода нарушены — выпуск отказан.",
        )

    return build_expense_document(
        snapshot,
        business_date,
        staff_map=staff_map,
        division_names=division_names,
        division_id=division_id,
    )


def serialize_expense_document(data):
    """``ExpenseDocumentData`` → JSON-safe dict (dataclasses не сериализуются
    напрямую, ``date``-поля требуют ``.isoformat()``)."""

    def serialize_cell(cell):
        return {
            "count": cell.count,
            "members": [
                {
                    "rank": member.rank,
                    "full_name": member.full_name,
                    "date_start": member.date_start.isoformat(),
                    "date_end": member.date_end.isoformat(),
                }
                for member in cell.members
            ],
        }

    return {
        "division_title": data.division_title,
        "business_date": data.business_date.isoformat(),
        "rows": [
            {
                "name": row.name,
                "staff_total": row.staff_total,
                "list_total": row.list_total,
                "vacancies": row.vacancies,
                "cells": {
                    code: serialize_cell(cell) for code, cell in row.cells.items()
                },
                "attached": serialize_cell(row.attached),
            }
            for row in data.rows
        ],
        "totals": {
            "staff_total": data.totals.staff_total,
            "list_total": data.totals.list_total,
            "vacancies": data.totals.vacancies,
            "columns": data.totals.columns,
            "attached": data.totals.attached,
        },
    }
