"""Эталон печатной формы расхода: единый источник правды для сверки и
обновления (порт submissions/golden.py из Backend/VAPS).

ЗАЧЕМ ЭТАЛОН, когда у документа уже есть тесты. Обычные тесты проверяют то, о
чём их спросили: колонку, кегль, состав. Эталон ловит другое — НЕЗАМЕЧЕННЫЙ
ДРЕЙФ: правку в билдере или в шаблоне, которая проходит все проверки и при этом
меняет документ. Ошибка тут дорогая и тихая: под расходом стоят подписи, и
«почему в июле форма была другая» выясняется через полгода.

ОДИН КОД НА СВЕРКУ И НА ОБНОВЛЕНИЕ — главное правило модуля. Считай эталон
тест одним способом, а команда обновления другим, и они разойдутся: обновление
записало бы то, чего тест никогда не увидит, и сверка стала бы сверкой самой с
собой. Поэтому и тест, и команда зовут отсюда одни и те же функции.

ЧИСТО: ни ORM, ни часов, ни записи на диск. Всё, что документ берёт из базы
(состав, штат, вакансии, справочник), заморожено во входах случая — иначе
эталон менялся бы от посева тестовой базы, то есть перестал бы быть эталоном.

Отличие от источника: идентификаторы целые, и приведения ключей к UUID здесь
нет вовсе. В источнике оно было несущим (ключи staff_map — UUID, и строковый
ключ молча промахивался мимо словаря); у целых такой ловушки не возникает.
"""
import json

from organization_management.apps.operations.docx_fingerprint import (
    normalize_document_xml,
)
from organization_management.apps.operations.expense_docx import generate_expense_docx
from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.strength_report import StatusCatalog

# Имена файлов случая. Вход — то, из чего строится документ; остальные два —
# то, что обязано получиться.
INPUT_FILE = "input.json"
NUMBERS_FILE = "numbers.json"
DOCUMENT_FILE = "document.xml"


def dumps(payload):
    """Каноническая запись эталонного JSON.

    Ключи сортированы, отступ фиксирован, кириллица не экранируется, в конце
    перевод строки. Всё это ради ОДНОГО: чтобы обновление эталона давало
    осмысленный diff. Перетасованный порядок ключей превращал бы правку одного
    числа в переписанный целиком файл, и глазами такое изменение не читается —
    а читать его придётся, эталон обновляют руками и осознанно.
    """
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def load_case(payload):
    """`input.json` → аргументы построения документа.

    Дата остаётся СТРОКОЙ ISO там, где её ждёт билдер (внутри снимка), и
    становится датой там, где он ждёт дату. Разбирать её иначе значило бы
    подменить входы: билдер сам решает, что с ними делать, и эталон не должен
    ему в этом помогать.
    """
    from datetime import date

    return {
        "snapshot": payload["snapshot"],
        "business_date": date.fromisoformat(payload["business_date"]),
        "catalog": StatusCatalog.from_rows(payload["catalog"]),
        "division_title": payload["division_title"],
        "staff_total": payload["staff_total"],
        "vacancies": payload["vacancies"],
        "attached": payload["attached"],
    }


def build(inputs):
    """Данные документа по входам случая."""
    return build_expense_document(
        inputs["snapshot"],
        inputs["business_date"],
        catalog=inputs["catalog"],
        division_title=inputs["division_title"],
        staff_total=inputs["staff_total"],
        vacancies=inputs["vacancies"],
        attached=inputs["attached"],
    )


def expected_numbers(inputs):
    """Слой ЧИСЕЛ эталона: то, что посчитал билдер.

    Числа и документ разведены на два файла намеренно. Расхождение в числах —
    ошибка расчёта, расхождение в разметке при верных числах — правка формы;
    это разные новости, и один общий файл заставлял бы читателя diff-а
    выяснять, какая из них случилась.
    """
    data = build(inputs)
    return {
        "business_date": data.business_date.isoformat(),
        "columns": list(data.columns),
        "rows": [
            {
                "name": row.name,
                "staff_total": row.staff_total,
                "list_total": row.list_total,
                "vacancies": row.vacancies,
                "attached": row.attached.count,
                "cells": {
                    column: row.cells[column].count for column in data.columns
                },
            }
            for row in data.rows
        ],
        "totals": {
            "staff_total": data.totals.staff_total,
            "list_total": data.totals.list_total,
            "vacancies": data.totals.vacancies,
            "attached": data.totals.attached,
            "columns": dict(data.totals.columns),
        },
    }


def expected_document(inputs):
    """Слой РАЗМЕТКИ эталона: отпечаток собранной печатной формы."""
    return normalize_document_xml(generate_expense_docx(build(inputs)))
