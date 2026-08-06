"""Эталон печатной формы: документ не менялся с тех пор, как его утвердили.

Этот файл ловит не ошибку в конкретном правиле, а НЕЗАМЕЧЕННЫЙ ДРЕЙФ — правку в
билдере или шаблоне, которая проходит все прочие проверки и при этом меняет
документ. Под расходом стоят подписи, и «почему в июле форма была другая»
выясняется через полгода.

КРАСНЫЙ ТЕСТ ЗДЕСЬ НЕ ОЗНАЧАЕТ ОШИБКУ. Он означает «документ изменился» —
дальше человек решает, изменение это желаемое (тогда эталон обновляют командой)
или случайное (тогда правят код). Именно поэтому отказ печатает, ЧТО разошлось,
а не только факт расхождения.

Числа и разметка разведены на два файла: расхождение в числах — ошибка расчёта,
расхождение в разметке при верных числах — правка формы. Это разные новости.
"""
import json
import pathlib

import pytest

from organization_management.apps.operations import golden

GOLDEN_ROOT = pathlib.Path(__file__).resolve().parent / "golden"


def _cases():
    return sorted(path for path in GOLDEN_ROOT.iterdir() if path.is_dir())


CASES = _cases()


def _inputs(case):
    payload = json.loads((case / golden.INPUT_FILE).read_text(encoding="utf-8"))
    return golden.load_case(payload)


# ── Сам набор случаев ────────────────────────────────────────────────────


def test_the_golden_set_is_not_empty():
    """Пустой набор сделал бы весь файл вечнозелёным: параметризация по нулю
    случаев не выполняет ни одной проверки и при этом рапортует об успехе."""
    assert CASES != []


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_every_case_carries_all_three_files(case):
    """Пропавший файл эталона обязан краснеть, а не молча выключать сверку."""
    assert (case / golden.INPUT_FILE).is_file()
    assert (case / golden.NUMBERS_FILE).is_file()
    assert (case / golden.DOCUMENT_FILE).is_file()


def test_the_set_covers_the_shapes_that_break_documents():
    """Случаи подобраны, а не насыпаны: пустое подразделение и длинный состав —
    те формы, на которых печать ломается чаще всего (нулевой знаменатель и
    усечение списка)."""
    names = {case.name for case in CASES}

    assert any("empty" in name for name in names)
    assert any("long" in name for name in names)


# ── Сверка ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_numbers_match_the_approved_ones(case):
    stored = json.loads((case / golden.NUMBERS_FILE).read_text(encoding="utf-8"))

    actual = golden.expected_numbers(_inputs(case))

    assert actual == stored, (
        f"Числа документа разошлись с эталоном ({case.name}). "
        "Если изменение желаемое — обновите эталон командой update_golden."
    )


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_printed_form_matches_the_approved_one(case):
    stored = (case / golden.DOCUMENT_FILE).read_bytes()

    actual = golden.expected_document(_inputs(case))

    assert actual == stored, (
        f"Печатная форма разошлась с эталоном ({case.name}) при том, что числа "
        "могли остаться прежними. Если изменение желаемое — обновите эталон "
        "командой update_golden."
    )


# ── Свойства самого эталона ──────────────────────────────────────────────


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_stored_input_is_written_canonically(case):
    """Эталон обновляют руками и осознанно, а значит читают diff.

    Перетасованный порядок ключей превращал бы правку одного числа в
    переписанный целиком файл — глазами такое изменение не читается.
    """
    raw = (case / golden.INPUT_FILE).read_text(encoding="utf-8")

    assert raw == golden.dumps(json.loads(raw))


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_stored_numbers_are_written_canonically(case):
    raw = (case / golden.NUMBERS_FILE).read_text(encoding="utf-8")

    assert raw == golden.dumps(json.loads(raw))


def test_the_stored_input_keeps_cyrillic_readable():
    """Экранированная кириллица (\\u0418...) сделала бы эталон нечитаемым, а его
    читают глазами — в этом весь смысл его хранения в репозитории."""
    raw = (CASES[0] / golden.INPUT_FILE).read_text(encoding="utf-8")

    assert "\\u04" not in raw


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_recomputing_twice_gives_the_same_document(case):
    """Опора сверки: отпечаток обязан быть детерминированным.

    Не будь он таким, красный тест выше означал бы «прошла секунда», и на него
    перестали бы смотреть.
    """
    inputs = _inputs(case)

    assert golden.expected_document(inputs) == golden.expected_document(inputs)


def test_a_changed_input_would_change_the_stored_document():
    """Сверка не вечнозелёная: подмена входа даёт другой отпечаток.

    Без этой пробы «совпало с эталоном» могло бы означать, что сравниваются
    две константы.
    """
    payload = json.loads((CASES[0] / golden.INPUT_FILE).read_text(encoding="utf-8"))
    payload["division_title"] = "Совершенно другое управление"

    assert golden.expected_document(golden.load_case(payload)) != (
        (CASES[0] / golden.DOCUMENT_FILE).read_bytes()
    )
