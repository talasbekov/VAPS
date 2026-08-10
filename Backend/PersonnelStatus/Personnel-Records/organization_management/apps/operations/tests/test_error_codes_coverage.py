"""Покрытие словаря кодов: в обе стороны и по ОБОИМ путям выдачи.

Конструктор DomainError сверяет код при подъёме, но двух вещей он увидеть не
может, и обе закрываются здесь.

ПЕРВАЯ: код, которого никто не поднимает. Конструктор о нём не узнает по
определению — его же не конструируют. Такой код в словаре это обещание, которое
никогда не исполнится: клиент пишет ветку под ответ, которого не бывает.

ВТОРАЯ, и она важнее: у раздела ЕСТЬ второй путь выдачи кода — CONSTRAINT_ERROR_MAP
в обработчике. Он строит конверт из нарушенного ограничения базы НАПРЯМУЮ, минуя
DomainError, то есть минуя всякую сверку. Опечатка в коде именно там уедет
клиенту молча — и уедет в самый неудачный момент, потому что этот путь
срабатывает на гонках.

Разбор идёт по ИСХОДНИКАМ пакета, а не по импортированным модулям: код может
подниматься в ветке, куда прогон не заходил, и «поднимается» здесь означает
«написан в коде», а не «исполнился».
"""
import ast
import pathlib

import pytest

from organization_management.apps.operations.api.exception_handler import (
    CONSTRAINT_ERROR_MAP,
)
from organization_management.apps.operations.error_codes import CODES

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent
# Словарь кодов — один на раздел ОМ, а его raise-сайты живут в ДВУХ пакетах:
# operations (ядро) и ops (адресное пространство /api/ops/* — объекты,
# паспорта, мероприятия). Скан обязан видеть оба, иначе код, поднимаемый
# только в ops, значился бы «обещанием, которое не исполнится».
SCAN_ROOTS = [PACKAGE_ROOT, PACKAGE_ROOT.parent / "ops"]


def _raised_codes():
    """Коды из всех конструкций DomainError(...) в пакете, кроме тестов.

    Разбор через ast, а не регулярным выражением: код может быть записан по-
    разному (перенос строки, отступ), и регулярное выражение молча пропустило бы
    такой сайт — то есть проверка «каждый поднятый объявлен» ослабла бы ровно
    там, где написано непривычно.
    """
    codes = {}
    paths = [p for root in SCAN_ROOTS for p in root.rglob("*.py")]
    for path in paths:
        if "tests" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = getattr(func, "id", None) or getattr(func, "attr", None)
            if name != "DomainError" or not node.args:
                continue
            first = node.args[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                codes.setdefault(first.value, []).append(
                    f"{path}:{first.lineno}"
                )
    return codes


RAISED = _raised_codes()


# ── Сам разбор не должен быть пустым ─────────────────────────────────────


def test_the_scan_actually_found_raise_sites():
    """Опора всех проверок ниже.

    Сломайся разбор (переименовали класс, сменили форму вызова) — множество
    поднятых кодов станет пустым, и проверка «каждый поднятый объявлен»
    выполнится сама собой, ничего не проверив.
    """
    assert len(RAISED) >= 20, f"разбор нашёл слишком мало кодов: {sorted(RAISED)}"


# ── Каждый поднятый — объявлен ───────────────────────────────────────────


def test_every_raised_code_is_declared():
    """Дубль проверки конструктора, и намеренный: конструктор ловит на
    исполнении, этот тест — на любом написанном пути, включая те, куда прогон
    не заходил."""
    unknown = {code: sites for code, sites in RAISED.items() if code not in CODES}

    assert unknown == {}


# ── Каждый объявленный — поднимается ─────────────────────────────────────


def test_every_declared_code_is_raised_somewhere():
    """Код, которого никто не поднимает, — обещание, которое не исполнится:
    клиент напишет ветку под ответ, которого не бывает.

    Коды второго пути выдачи (ограничения базы) в счёт идут — они выдаются
    клиенту так же, просто не через DomainError.
    """
    from_constraints = {code for code, _, _ in CONSTRAINT_ERROR_MAP.values()}
    reachable = set(RAISED) | from_constraints

    orphans = sorted(set(CODES) - reachable)

    assert orphans == []


# ── Второй путь выдачи ───────────────────────────────────────────────────


def test_codes_of_the_constraint_path_are_declared_too():
    """Несущий тест файла.

    Обработчик строит конверт из нарушенного ограничения НАПРЯМУЮ, минуя
    DomainError и всякую сверку. Опечатка там уедет клиенту молча — и в самый
    неудачный момент, потому что путь срабатывает на гонках.
    """
    undeclared = sorted(
        code for code, _, _ in CONSTRAINT_ERROR_MAP.values() if code not in CODES
    )

    assert undeclared == []


def test_the_constraint_path_uses_a_status_declared_for_its_code():
    """Тот же договор, что и у подъёма: один код — один смысл и один статус.

    Гонка не повод отвечать другим статусом: клиент ветвится по коду, и «то же
    самое, но 500» он разберёт как другую беду.
    """
    mismatched = [
        (code, http_status, sorted(CODES[code]))
        for code, http_status, _ in CONSTRAINT_ERROR_MAP.values()
        if code in CODES and http_status not in CODES[code]
    ]

    assert mismatched == []


def test_the_constraint_map_is_not_empty():
    """Иначе две проверки выше выполнялись бы сами собой."""
    assert CONSTRAINT_ERROR_MAP


# ── Ровно те коды, что объявлены ─────────────────────────────────────────


@pytest.mark.parametrize("code", sorted(CODES))
def test_each_declared_code_is_reachable_by_name(code):
    """Поимённо, а не множеством: отказ называет ИМЕННО тот код, который
    осиротел, — иначе разбирать пришлось бы вычитанием множеств глазами."""
    from_constraints = {c for c, _, _ in CONSTRAINT_ERROR_MAP.values()}

    assert code in RAISED or code in from_constraints
