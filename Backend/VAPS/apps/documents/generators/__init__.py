"""Генераторы официальных документов (Story 6.3+): обычный python-пакет
внутри app documents (НЕ Django app — без apps.py/INSTALLED_APPS).

Реэкспорт публичного контракта: билдеры operations и генераторы 6.4
импортируют отсюда (стрелка «documents ← operations» разрешена).
"""

from apps.documents.generators.expense_docx import (
    CELL_MAX_MEMBERS,
    DOCX_COLUMN_LABELS,
    DOCX_COLUMNS,
    FONT_NAME,
    ExpenseCell,
    ExpenseCellMember,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
    generate_expense_docx,
)

__all__ = [
    "CELL_MAX_MEMBERS",
    "DOCX_COLUMN_LABELS",
    "DOCX_COLUMNS",
    "FONT_NAME",
    "ExpenseCell",
    "ExpenseCellMember",
    "ExpenseDocumentData",
    "ExpenseRow",
    "ExpenseTotals",
    "generate_expense_docx",
]
