"""Разбивка «на ОМ (гр./нар.)» переживает слияние статусов (Plane №486).

Заказчик: «Убери статусы Привлечён на мероприятия (обе)». Оба кода —
`EVENT_ASSIGNMENT` (наряд) и `EVENT_ASSIGNMENT_GROUP` (боевая группа) —
сливаются в единственный `IN_EVENT` («Участие в ОМ»), решение заказчика
04.09.2026 (вариант «перевести строки», отвергнуты «погасить типы, строки не
трогать» и «удалить и типы, и строки»).

🔴 ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ. Расход дня печатает колонку «На ОМ (гр./нар.)» —
`2 (1/1)`, и до №486 вид участия выводился ИЗ КОДА СТАТУСА
(`strength_report.EVENT_INVOLVEMENT_KINDS`). После слияния код у обоих один,
и такой вывод дал бы «2 (0/2)» или «2 (2/0)» — то есть цифра, на которую
смотрит начальник департамента, стала бы враньём, причём молча.

Различение обязано приезжать оттуда, где оно и живёт по-настоящему, —
из `participations[].kind_code` (`PHYSICAL_SQUAD` / `SCREENING_GROUP`).
Эта запись у цепочки есть с Ш-3 (`migrations/0062_status_participation.py`),
и именно её переносит бэкфилл слияния.

Проба красная до правки: `overlapping_on` не отдавала `participations` вовсе,
а расход спрашивал код статуса.
"""
from datetime import date

import pytest

from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.strength_report import StatusCatalog

DAY = date(2026, 8, 4)


@pytest.fixture
def merged_catalog():
    """Каталог ПОСЛЕ слияния: обоих старых кодов в нём уже нет."""
    return StatusCatalog.from_rows(
        [
            {
                "code": "IN_SERVICE",
                "priority": 999,
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
            {
                "code": "IN_EVENT",
                "priority": 80,
                # Та же колонка, что у «в строю»: человек на мероприятии из
                # строя не выбывает (Plane №169), и своя колонка сломала бы
                # инвариант «Σ колонок == Список».
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
        ]
    )


def member(employee_id, full_name="Иванов Иван", rank="капитан"):
    return {"employee_id": employee_id, "full_name": full_name, "rank": rank}


def fact(employee_id, kind_code):
    """Строка «Участие в ОМ» с видом участия внутри — как её пишет цепочка."""
    return {
        "employee_id": employee_id,
        "status_type_code": "IN_EVENT",
        "date_start": DAY.isoformat(),
        "date_end": date(2026, 8, 10).isoformat(),
        "source": "USER",
        "participations": [{"event_id": 1, "kind_code": kind_code}],
    }


def test_kind_split_comes_from_participations_not_from_the_status_code(
    merged_catalog,
):
    """Один код на двоих, а «гр./нар.» по-прежнему 1/1."""
    snapshot = {
        "roster": [member(1), member(2, full_name="Петров Пётр"), member(3)],
        "rows": [fact(1, "PHYSICAL_SQUAD"), fact(2, "SCREENING_GROUP")],
    }

    document = build_expense_document(
        snapshot,
        DAY,
        catalog=merged_catalog,
        division_title="Управление кадров",
        staff_total=10,
        vacancies=7,
        attached=2,
    )

    row = document.rows[0]
    assert row.event["total"] == 2, "оба привлечённых обязаны попасть в счётчик ОМ"
    assert row.event["squad"] == 1, "наряд обязан считаться по kind_code, а не по коду статуса"
    assert row.event["group"] == 1, "боевая группа обязана считаться по kind_code"
    # «В строю» от занятости не уменьшается — тот же инвариант, что и до слияния.
    assert row.cells["IN_SERVICE"].count == 3


def test_participation_without_a_kind_counts_in_the_total_only(merged_catalog):
    """Строка без вида участия попадает в «всего», но не выдумывает себе вид.

    Такие строки возможны у исторических фактов, у которых участия не было
    вовсе (бэкфилл Ш-3 переносил лишь то, что было на момент миграции).
    Приписать им наряд значило бы завысить одну из двух цифр, на которые
    смотрит начальник департамента.
    """
    row_without_kind = {
        "employee_id": 1,
        "status_type_code": "IN_EVENT",
        "date_start": DAY.isoformat(),
        "date_end": date(2026, 8, 10).isoformat(),
        "source": "USER",
        "participations": [],
    }
    snapshot = {"roster": [member(1)], "rows": [row_without_kind]}

    document = build_expense_document(
        snapshot,
        DAY,
        catalog=merged_catalog,
        division_title="Управление кадров",
        staff_total=1,
        vacancies=0,
        attached=0,
    )

    row = document.rows[0]
    assert row.event["total"] == 1
    assert row.event["squad"] == 0
    assert row.event["group"] == 0
