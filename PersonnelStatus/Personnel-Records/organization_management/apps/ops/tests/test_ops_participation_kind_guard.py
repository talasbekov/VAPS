"""Соответствие «код статуса → вид участия» продублировано ОСОЗНАННО (Plane №734).

🔴 ЧЕГО ЗДЕСЬ НЕ ХВАТАЛО. `security_events._PARTICIPATION_KIND_BY_STATUS`
повторяет соответствие из бэкфилла Ш-3 (`operations/migrations/
0062_status_participation.py`), и оба комментария рядом с ним утверждали, что
расхождение «стережёт проба `test_allocation_kind_matches_backfill`». Такой
пробы не существовало НИ ОДНОЙ: `grep -rn 'kind_matches_backfill'` по всему
дереву находил только эти два комментария. То есть задвоение не стерёг никто,
а обещание сторожа читалось как выполненное — и следующий, кто правил бы
рабочую половину, был бы уверен, что миграция проверится сама.

Карточка закрыта НЕ снятием обещания, а его выполнением: дублирование
осмысленно (миграция обязана быть замороженной во времени, рабочий код —
жить), значит нужна не правка комментария, а сторож.

КАК ЧИТАЕТСЯ МИГРАЦИЯ. Соответствие лежит ЛОКАЛЬНОЙ переменной внутри
`_backfill`, импортом её не достать. Разбирается исходник (`ast`), а не
переписывается миграция: поднимать литерал на уровень модуля значило бы
править применённую миграцию ради удобства пробы — ровно то, от чего раздел
отказался в №752.
"""
import ast
import pathlib

import pytest

from organization_management.apps.ops.security_events import (
    ASSIGNMENT_STATUS_CODE,
    _PARTICIPATION_KIND_BY_STATUS,
)

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "operations"
    / "migrations"
    / "0062_status_participation.py"
)


def backfill_mapping():
    """Словарь `kind_of` из `_backfill` миграции 0062 — как он там записан."""
    tree = ast.parse(MIGRATION.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_backfill":
            for statement in node.body:
                if (
                    isinstance(statement, ast.Assign)
                    and len(statement.targets) == 1
                    and getattr(statement.targets[0], "id", None) == "kind_of"
                ):
                    return ast.literal_eval(statement.value)
    raise AssertionError(
        "в 0062_status_participation._backfill не найден словарь kind_of — "
        "миграцию переписали, и этот сторож ослеп"
    )


def test_the_backfill_mapping_is_still_readable():
    """Опора: разбор миграции обязан что-то находить.

    Без неё переименование `kind_of` превратило бы сторожа в вечнозелёный —
    ту же болезнь, которую эта карточка и лечит.
    """
    assert backfill_mapping() == {
        "EVENT_ASSIGNMENT": "PHYSICAL_SQUAD",
        "EVENT_ASSIGNMENT_GROUP": "SCREENING_GROUP",
    }


def test_working_map_agrees_with_the_frozen_backfill():
    """Каждый код бэкфилла даёт В РАБОЧЕМ КОДЕ тот же вид участия.

    🔴 Мутация, которую это стережёт: поменять вид у любого из старых кодов в
    `_PARTICIPATION_KIND_BY_STATUS`. Строки, не прошедшие миграцию №486, тогда
    считались бы одним видом, а перенесённые — другим, и разбивка «На ОМ
    (гр./нар.)» разошлась бы с историей молча.
    """
    for code, kind in backfill_mapping().items():
        assert _PARTICIPATION_KIND_BY_STATUS.get(code) == kind, (
            f"код {code!r}: рабочий код говорит "
            f"{_PARTICIPATION_KIND_BY_STATUS.get(code)!r}, "
            f"замороженный бэкфилл — {kind!r}"
        )


def test_the_only_extra_key_is_the_merged_code():
    """Сверх бэкфилла в рабочем соответствии допустим РОВНО один код.

    Бэкфилл Ш-3 старше слияния №486 и про `IN_EVENT` не знает — это законное
    расхождение. Любой ДРУГОЙ лишний код означает, что соответствие поехало
    в сторону от миграции незамеченным.
    """
    extra = set(_PARTICIPATION_KIND_BY_STATUS) - set(backfill_mapping())

    assert extra == {ASSIGNMENT_STATUS_CODE}, (
        f"сверх замороженного бэкфилла ожидался только {ASSIGNMENT_STATUS_CODE!r}, "
        f"а есть {sorted(extra)}"
    )
