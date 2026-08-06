"""Инварианты расхода на СЛУЧАЙНЫХ мирах.

Расход сам проверяет два равенства прямо в коде: Σ колонок == Список и
Штат == Список + Вне списка + Вакансии. Но проверка срабатывает только на тех
данных, которые ей принесли, а приносят их примерные тесты — то есть ровно те
случаи, которые кто-то придумал. Здесь миры генерируются: подразделения, слоты,
вакансии, уволенные, приданные и статусы со случайными интервалами и типами.

Что именно проверяется сверх встроенных равенств:

- ЦЕЛОЕ РАВНО СУММЕ ЧАСТЕЙ. Итог обязан совпадать с суммой строк — иначе
  подразделения сходятся, а сводка нет, и расхождение обнаружится в подписанном
  документе;
- КАЖДЫЙ ЧЕЛОВЕК УЧТЁН РОВНО ОДИН РАЗ. Человек, попавший в две колонки, раздувает
  список; не попавший ни в одну — уменьшает его;
- ПОЛУОТКРЫТОСТЬ. Факт, кончающийся В день расхода, в этот день уже не действует.
  Ошибка на единицу здесь сдвигает весь отчёт на день;
- ПОРЯДОК ВХОДА НЕ ВЛИЯЕТ. Снимок и живая выборка приходят в разном порядке, и
  расход обязан выходить одинаковым — иначе один и тот же день печатается
  по-разному.

Тесты чистые: базы здесь нет, `derive_report` её и не знает.
"""
from datetime import date, timedelta

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from organization_management.apps.operations.strength_report import (
    DERIVED_IN_SERVICE,
    StatusCatalog,
    derive_report,
)

D = date(2026, 8, 4)

# Справочник миров: у каждого типа своя колонка, чтобы «попал не в ту колонку»
# было отличимо от «попал в общую». SICK не считается в штате — это и есть
# «вне списка», отдельное число, которое легко спутать с вакансией.
#
# У STUDY и MEETING приоритет ОДИНАКОВЫЙ, и это сделано намеренно. Первый набор
# давал каждому типу свой приоритет — и проба «убрать тай-брейк победителя»
# оставалась зелёной: ничья возникала только между строками ОДНОГО кода, где
# выбирать всё равно не из чего. Равный приоритет у РАЗНЫХ колонок — то самое
# место, где порядок входа мог бы решить, в какую колонку попадёт человек.
CATALOG_ROWS = [
    {
        "code": DERIVED_IN_SERVICE,
        "priority": 999,
        "report_column_code": DERIVED_IN_SERVICE,
        "counts_in_staff": True,
    },
    {"code": "DUTY", "priority": 10, "report_column_code": "ON_DUTY",
     "counts_in_staff": True},
    {"code": "VACATION", "priority": 30, "report_column_code": "VACATION",
     "counts_in_staff": True},
    {"code": "STUDY", "priority": 40, "report_column_code": "STUDY",
     "counts_in_staff": True},
    {"code": "MEETING", "priority": 40, "report_column_code": "MEETING",
     "counts_in_staff": True},
    {"code": "SICK", "priority": 20, "report_column_code": "SICK",
     "counts_in_staff": False},
]
CODES = [row["code"] for row in CATALOG_ROWS if row["code"] != DERIVED_IN_SERVICE]


@pytest.fixture(scope="module")
def catalog():
    return StatusCatalog.from_rows(CATALOG_ROWS)


@st.composite
def worlds(draw):
    """Случайный мир: слоты по подразделениям и факты по их обитателям.

    Вакансии (слот без человека) и приданные извне генерируются наравне с
    занятыми слотами: именно на них путаются три разных числа — вакансия, «вне
    списка» и «+N».
    """
    division_count = draw(st.integers(min_value=1, max_value=3))
    divisions = list(range(1, division_count + 1))

    slot_rows = []
    employee_id = 0
    for division_id in divisions:
        for _ in range(draw(st.integers(min_value=0, max_value=4))):
            if draw(st.booleans()):
                employee_id += 1
                slot_rows.append(
                    {"division_id": division_id, "employee_id": employee_id}
                )
            else:
                # Вакантный слот либо слот уволенного — для расхода это одно и
                # то же: человека в списке нет, а штатная единица есть.
                slot_rows.append({"division_id": division_id, "employee_id": None})

    occupied = [row["employee_id"] for row in slot_rows if row["employee_id"]]
    status_rows = []
    for person in occupied:
        for _ in range(draw(st.integers(min_value=0, max_value=3))):
            offset = draw(st.integers(min_value=-4, max_value=4))
            length = draw(st.integers(min_value=1, max_value=6))
            start = D + timedelta(days=offset)
            status_rows.append(
                {
                    "employee_id": person,
                    "status_type_code": draw(st.sampled_from(CODES)),
                    "date_start": start,
                    "date_end": start + timedelta(days=length),
                }
            )

    attached = {
        division_id: draw(st.integers(min_value=0, max_value=3))
        for division_id in divisions
        if draw(st.booleans())
    }
    return slot_rows, status_rows, attached


SETTINGS = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def report_of(world, catalog):
    slot_rows, status_rows, attached = world
    return derive_report(
        slot_rows, status_rows, D, catalog, attached_by_division=attached
    )


# ── Целое равно сумме частей ─────────────────────────────────────────────


@SETTINGS
@given(worlds())
def test_totals_are_the_sum_of_the_rows(catalog, world):
    """Иначе подразделения сходятся, а сводка нет — и расхождение всплывает уже
    в подписанном документе."""
    result = report_of(world, catalog)

    assert result.totals.staff_total == sum(r.staff_total for r in result.rows)
    assert result.totals.list_total == sum(r.list_total for r in result.rows)
    assert result.totals.vacancies == sum(r.vacancies for r in result.rows)
    assert result.totals.attached == sum(r.attached for r in result.rows)
    assert result.totals.off_list == sum(r.off_list for r in result.rows)


@SETTINGS
@given(worlds())
def test_totals_columns_are_the_sum_of_the_row_columns(catalog, world):
    result = report_of(world, catalog)

    for column, value in result.totals.columns.items():
        assert value == sum(row.columns[column] for row in result.rows)


# ── Каждый учтён ровно один раз ──────────────────────────────────────────


@SETTINGS
@given(worlds())
def test_every_occupant_lands_in_exactly_one_column_or_is_off_list(catalog, world):
    """Человек в двух колонках раздувает список; ни в одной — уменьшает.

    Проверяется через равенство: занятые слоты == Σ колонок + вне списка.
    Приданные сюда НЕ входят — они чужие, своего слота у них нет.
    """
    slot_rows, _status_rows, _attached = world
    result = report_of(world, catalog)

    for row in result.rows:
        occupied = len(
            [
                slot
                for slot in slot_rows
                if slot["division_id"] == row.division_id and slot["employee_id"]
            ]
        )
        assert sum(row.columns.values()) + row.off_list == occupied


@SETTINGS
@given(worlds())
def test_staff_is_list_plus_off_list_plus_vacancies(catalog, world):
    """Три числа, которые легче всего перепутать между собой."""
    result = report_of(world, catalog)

    for row in result.rows:
        assert row.staff_total == row.list_total + row.off_list + row.vacancies


@SETTINGS
@given(worlds())
def test_no_number_is_negative(catalog, world):
    """Отрицательное число в расходе не бывает ни у чего, а появиться может от
    любого вычитания — и в документе выглядит как опечатка."""
    result = report_of(world, catalog)

    for row in result.rows:
        assert row.staff_total >= 0
        assert row.list_total >= 0
        assert row.vacancies >= 0
        assert row.off_list >= 0
        assert all(value >= 0 for value in row.columns.values())


# ── Полуоткрытость ───────────────────────────────────────────────────────


@SETTINGS
@given(worlds())
def test_a_fact_ending_on_the_report_day_is_already_over(catalog, world):
    """Ошибка на единицу здесь сдвигает весь отчёт на день.

    Мир пересобирается так, чтобы КАЖДЫЙ факт кончался ровно в день расхода:
    тогда все обитатели обязаны оказаться «в строю».
    """
    slot_rows, status_rows, attached = world
    ended_today = [
        {**row, "date_start": D - timedelta(days=3), "date_end": D}
        for row in status_rows
    ]

    result = derive_report(
        slot_rows, ended_today, D, catalog, attached_by_division=attached
    )

    in_service = catalog.column[DERIVED_IN_SERVICE]
    for row in result.rows:
        assert row.columns[in_service] == row.list_total
        assert row.off_list == 0


# ── Порядок входа не влияет ──────────────────────────────────────────────


@SETTINGS
@given(worlds())
def test_shuffling_the_input_does_not_change_the_report(catalog, world):
    """Снимок и живая выборка приходят в разном порядке; один и тот же день
    обязан печататься одинаково."""
    slot_rows, status_rows, attached = world

    straight = derive_report(
        slot_rows, status_rows, D, catalog, attached_by_division=attached
    )
    reversed_ = derive_report(
        list(reversed(slot_rows)),
        list(reversed(status_rows)),
        D,
        catalog,
        attached_by_division=attached,
    )

    assert [(r.division_id, r.staff_total, r.list_total, dict(r.columns))
            for r in straight.rows] == [
        (r.division_id, r.staff_total, r.list_total, dict(r.columns))
        for r in reversed_.rows
    ]
