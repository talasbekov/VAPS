"""Golden-master регрессия расхода (Story 6.8).

Числа (``derive_report``) и нормализованный ``document.xml``
(``build_expense_document`` → ``generate_expense_docx`` → нормализация) заморожены
в git-корпусе ``golden/case_NNN/``. Любое изменение расчёта/генерации, меняющее
вывод, ловится диффом (число ИЛИ фрагмент XML). Эталон = ВЫВОД САМОГО VAPS,
замороженный (регресс-мастер, Ловушка №1) — НЕ числа донора (это 6.9).

БЕЗ БД: все входы заморожены в ``input.json`` (Ловушка №2). Маркер ``golden`` →
исключён из ``make gate``, бежит в ``make test-full``.
"""

import json
from pathlib import Path

import pytest

from apps.operations.submissions.golden import (
    dumps,
    expected_document_xml,
    expected_values,
    load_input,
)

pytestmark = pytest.mark.golden

_GOLDEN_DIR = Path(__file__).parent / "golden"
_CASES = sorted(_GOLDEN_DIR.glob("case_*"))


def test_corpus_is_populated():
    # Пустой glob не должен «зелёно» проходить вакуумно (AC-2 guard).
    assert len(_CASES) >= 20, f"golden-корпус мал: {len(_CASES)} < 20"


@pytest.mark.parametrize("case", _CASES, ids=[c.name for c in _CASES])
def test_golden_case(case):
    data = json.loads((case / "input.json").read_text(encoding="utf-8"))
    inputs = load_input(data)

    # (a) слой ЧИСЕЛ: derive_report(входы) == expected_values.json
    expected_v = (case / "expected_values.json").read_text(encoding="utf-8")
    assert dumps(expected_values(inputs)) == expected_v

    # (b) слой XML: нормализованный document.xml == expected_document.xml
    expected_x = (case / "expected_document.xml").read_bytes()
    assert expected_document_xml(inputs) == expected_x
