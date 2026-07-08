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
from apps.documents.generators.expense_csv import generate_expense_csv
from apps.documents.generators.expense_pdf import generate_expense_pdf
from apps.documents.generators.expense_xlsx import generate_expense_xlsx

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
    "generate_expense_csv",
    "generate_expense_docx",
    "generate_expense_pdf",
    "generate_expense_xlsx",
]
