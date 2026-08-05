"""Данные документа расхода: состав ячеек и его сходимость с числами.

Билдер — чистая функция, поэтому и тесты без БД: снимок собирается руками.
Главное здесь — что документ НЕ считает по-своему (числа берёт у того же
владельца, что и экран), что состав сверяется со счётчиком, и что период
члена детерминирован.
"""
from datetime import date

import pytest

from organization_management.apps.operations.expense_document import (
    ExpenseCellMember,
    build_expense_document,
)
from organization_management.apps.operations.strength_report import StatusCatalog

DAY = date(2026, 8, 4)


@pytest.fixture
def catalog():
    return StatusCatalog.from_rows(
        [
            {
                "code": "IN_SERVICE",
                "priority": 999,
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
            {
                "code": "DUTY",
                "priority": 10,
                "report_column_code": "ON_DUTY",
                "counts_in_staff": True,
            },
            {
                "code": "GEV",
                "priority": 20,
                "report_column_code": "ON_DUTY",
                "counts_in_staff": True,
            },
            {
                "code": "VACATION",
                "priority": 30,
                "report_column_code": "VACATION",
                "counts_in_staff": True,
            },
            {
                "code": "SECONDED_OUT",
                "priority": 5,
                "report_column_code": "SECONDED_OUT",
                "counts_in_staff": False,
            },
        ]
    )


def member(employee_id, full_name="Иванов Иван", rank="капитан"):
    return {"employee_id": employee_id, "full_name": full_name, "rank": rank}


def fact(employee_id, code, start=DAY, end=date(2026, 8, 10)):
    return {
        "employee_id": employee_id,
        "status_type_code": code,
        "date_start": start.isoformat(),
        "date_end": end.isoformat(),
        "source": "USER",
    }


def build(snapshot, catalog, **overrides):
    kwargs = {
        "catalog": catalog,
        "division_title": "Управление кадров",
        "staff_total": 10,
        "vacancies": 3,
    }
    kwargs.update(overrides)
    return build_expense_document(snapshot, DAY, **kwargs)


# ── Состав ячеек ─────────────────────────────────────────────────────────


def test_the_member_carries_the_signature_from_the_snapshot(catalog):
    """Звание и ФИО — из снимка.

    Позднее присвоение звания не должно менять уже подписанный документ.
    """
    snapshot = {
        "roster": [member(1, full_name="Петров Пётр", rank="майор")],
        "rows": [fact(1, "VACATION")],
    }

    data = build(snapshot, catalog)

    assert data.rows[0].cells["VACATION"].members == (
        ExpenseCellMember(
            rank="майор",
            full_name="Петров Пётр",
            date_start=DAY,
            date_end=date(2026, 8, 10),
        ),
    )


def test_members_land_in_the_column_of_their_winner(catalog):
    """Колонка — у победителя дня, и много кодов ложатся в одну колонку."""
    snapshot = {
        "roster": [member(1), member(2)],
        "rows": [fact(1, "DUTY"), fact(2, "GEV")],
    }

    data = build(snapshot, catalog)

    assert data.rows[0].cells["ON_DUTY"].count == 2
    assert len(data.rows[0].cells["ON_DUTY"].members) == 2


def test_in_service_has_a_count_but_no_members(catalog):
    """«В строю» — отсутствие фактов, и период брать неоткуда."""
    snapshot = {"roster": [member(1), member(2)], "rows": []}

    data = build(snapshot, catalog)

    assert data.rows[0].cells["IN_SERVICE"].count == 2
    assert data.rows[0].cells["IN_SERVICE"].members == ()


def test_a_person_outside_the_list_is_in_no_column(catalog):
    """Победитель вне штата не попадает в колонки — как и в живом расходе."""
    snapshot = {"roster": [member(1)], "rows": [fact(1, "SECONDED_OUT")]}

    data = build(snapshot, catalog)

    assert data.rows[0].list_total == 0
    assert all(cell.members == () for cell in data.rows[0].cells.values())
    assert all(cell.count == 0 for cell in data.rows[0].cells.values())


def test_the_period_of_a_member_is_the_acting_fact(catalog):
    snapshot = {
        "roster": [member(1)],
        "rows": [
            # Закончился ДО даты — он самый ранний, и без гарда «действует на
            # дату» документ взял бы период отпуска, который уже прошёл.
            fact(1, "VACATION", start=date(2026, 7, 1), end=date(2026, 7, 20)),
            fact(1, "VACATION", start=date(2026, 8, 1), end=date(2026, 8, 20)),
        ],
    }

    data = build(snapshot, catalog)

    (only,) = data.rows[0].cells["VACATION"].members
    assert (only.date_start, only.date_end) == (date(2026, 8, 1), date(2026, 8, 20))


def test_equal_starts_are_broken_by_the_end_date(catalog):
    """Без тай-брейка документ зависел бы от порядка строк снимка.

    Дважды подряд он выходил бы разным, и сличить две копии стало бы нельзя.
    """
    rows = [
        fact(1, "VACATION", start=date(2026, 8, 1), end=date(2026, 8, 30)),
        fact(1, "VACATION", start=date(2026, 8, 1), end=date(2026, 8, 6)),
    ]
    direct = build({"roster": [member(1)], "rows": rows}, catalog)
    reversed_order = build(
        {"roster": [member(1)], "rows": list(reversed(rows))}, catalog
    )

    assert direct.rows[0].cells["VACATION"].members[0].date_end == date(2026, 8, 6)
    assert (
        direct.rows[0].cells["VACATION"].members
        == reversed_order.rows[0].cells["VACATION"].members
    )


# ── Сходимость с числами ─────────────────────────────────────────────────


def test_the_counts_come_from_the_same_owner_as_the_screen(catalog):
    from organization_management.apps.operations.strength_report import (
        expense_from_snapshot,
    )

    snapshot = {
        "roster": [member(1), member(2), member(3)],
        "rows": [fact(1, "DUTY"), fact(2, "VACATION")],
    }

    data = build(snapshot, catalog)
    screen = expense_from_snapshot(snapshot, DAY, catalog)

    assert data.rows[0].list_total == screen["list_total"]
    assert {
        column: cell.count for column, cell in data.rows[0].cells.items()
    } == screen["columns"]


def test_a_broken_grouping_stops_the_document(catalog, monkeypatch):
    """Документ подписывают — значит, выйти он должен верным или никаким.

    Расхождение состава со счётчиком означает дефект группировки, и молча
    выпущенный документ увёз бы его в подпись.
    """
    import organization_management.apps.operations.expense_document as module

    monkeypatch.setattr(
        module,
        "expense_from_snapshot",
        lambda *args, **kwargs: {
            "list_total": 99,
            "off_list": 0,
            "columns": {"IN_SERVICE": 0, "ON_DUTY": 99, "VACATION": 0,
                        "SECONDED_OUT": 0},
        },
    )
    snapshot = {"roster": [member(1)], "rows": [fact(1, "DUTY")]}

    with pytest.raises(AssertionError):
        build(snapshot, catalog)


# ── Числа, которых в снимке нет ──────────────────────────────────────────


def test_staff_and_vacancies_come_from_the_caller(catalog):
    """Снимок хранит людей и факты, а не штат.

    Подмешать их живыми внутри значило бы выдать наполовину сегодняшний
    документ за сданный вчера.
    """
    data = build({"roster": [member(1)], "rows": []}, catalog, staff_total=7, vacancies=2)

    assert (data.rows[0].staff_total, data.rows[0].vacancies) == (7, 2)
    assert (data.totals.staff_total, data.totals.vacancies) == (7, 2)


def test_attached_has_a_number_and_never_members(catalog):
    """Приданные — ЧУЖИЕ люди: в нашем списке их нет по определению."""
    # В списке есть люди с фактами — иначе «члены не появились» было бы
    # правдой по случайности пустого состава, а не по правилу.
    snapshot = {"roster": [member(1), member(2)], "rows": [fact(1, "DUTY")]}

    data = build(snapshot, catalog, attached=4)

    assert data.rows[0].attached.count == 4
    assert data.rows[0].attached.members == ()
    assert data.totals.attached == 4


def test_the_totals_repeat_the_only_row(catalog):
    # Документ одного подразделения: итог обязан сойтись со строкой, иначе
    # подписант увидел бы два разных ответа на один вопрос.
    snapshot = {
        "roster": [member(1), member(2)],
        "rows": [fact(1, "DUTY")],
    }

    data = build(snapshot, catalog)

    assert data.totals.list_total == data.rows[0].list_total
    assert data.totals.columns == {
        column: cell.count for column, cell in data.rows[0].cells.items()
    }


def test_the_column_order_is_fixed_by_the_catalog(catalog):
    data = build({"roster": [], "rows": []}, catalog)

    assert data.columns == catalog.columns_in_order()
    assert list(data.rows[0].cells) == list(data.columns)
