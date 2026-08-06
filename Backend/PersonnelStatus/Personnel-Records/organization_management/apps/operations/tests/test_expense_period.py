"""Расход за период: страница на дату, границы периода и запрет будущего.

Несущее здесь — что период это НЕ агрегат. Страница на каждую дату, и дата без
сдачи получает свою страницу наравне с прочими: «сдал» и «что было» суть разные
вопросы, и подмена первого вторым спрятала бы как раз те дни, ради которых
период и смотрят.

Границы проверяются с обеих сторон включительно и на трёх днях: на двух
«последний день не потерян» неотличимо от «дней столько же, сколько попросили».
"""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_period import (
    MAX_PERIOD_DAYS,
    derive_period,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def period(date_from, date_to, division=None, at=MORNING):
    with clock.override(at):
        return derive_period(
            date_from=date_from,
            date_to=date_to,
            division_ids={division.id} if division is not None else None,
        )


def days_of(pages):
    return [page["business_date"] for page in pages]


# ── Страница на дату ─────────────────────────────────────────────────────


def test_a_page_is_produced_for_every_date_in_the_range(types, division):  # noqa: F811
    in_slot(division)

    pages = period(TODAY - timedelta(days=2), TODAY, division)

    assert days_of(pages) == [
        (TODAY - timedelta(days=2)).isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
        TODAY.isoformat(),
    ]


def test_both_ends_of_the_range_belong_to_it(types, division):  # noqa: F811
    """«С 1 по 31 августа» означает и первое, и тридцать первое.

    Три дня, а не два: на двух «последний не потерян» неотличимо от «дней
    столько же, сколько попросили».
    """
    in_slot(division)

    pages = period(TODAY - timedelta(days=2), TODAY, division)

    assert len(pages) == 3
    assert days_of(pages)[0] == (TODAY - timedelta(days=2)).isoformat()
    assert days_of(pages)[-1] == TODAY.isoformat()


def test_a_single_day_range_is_one_page(types, division):  # noqa: F811
    in_slot(division)

    assert len(period(TODAY, TODAY, division)) == 1


def test_neighbouring_pages_do_not_share_one_date(types, division):  # noqa: F811
    """Дата — единственное, чем соседние страницы отличаются: проставь их все
    одной, и ответ стал бы столбиком одинаковых на вид объектов.

    Проба ловит именно ОБЩУЮ дату. Откуда взят день — из аргумента цикла или из
    посчитанного расхода — она не различает и не должна: расход кладёт в
    результат ровно тот день, по которому его посчитали.
    """
    in_slot(division)

    pages = period(TODAY - timedelta(days=1), TODAY, division)

    assert len(set(days_of(pages))) == 2


# ── Числа страницы ───────────────────────────────────────────────────────


def test_a_page_shows_the_numbers_of_its_own_day(types, division):  # noqa: F811
    """Статус стоит ТОЛЬКО на одном дне периода — иначе «числа своего дня»
    неотличимо от «одни и те же числа на всех страницах»."""
    employee = in_slot(division)
    in_slot(division)
    # Интервал полуоткрыт (date_start < date_end): «только сегодня» — это
    # [сегодня, завтра), и вчера в него не попадает.
    fact(employee, code="DUTY", start=TODAY, end=TODAY + timedelta(days=1))

    pages = period(TODAY - timedelta(days=1), TODAY, division)

    yesterday, today = pages
    duty_column = _duty_column()
    assert yesterday["totals"]["columns"].get(duty_column, 0) == 0
    assert today["totals"]["columns"][duty_column] == 1


def _duty_column():
    from organization_management.apps.operations.models import StatusType

    return StatusType.objects.get(code="DUTY").report_column_code


def test_a_day_without_a_submission_still_gets_its_page(types, division):  # noqa: F811
    """Несущее: период — ЧТЕНИЕ, и дни, за которые ничего не сдавали, он
    показывает наравне с прочими.

    Пропусти он их — спрятанными оказались бы ровно те дни, ради которых период
    и смотрят.
    """
    in_slot(division)
    submit(division, business_date=TODAY, at=MORNING)

    pages = period(TODAY - timedelta(days=1), TODAY, division)

    assert len(pages) == 2
    assert pages[0]["totals"]["list_total"] == 1


def test_the_period_reads_live_facts_and_not_issued_documents(types, division):  # noqa: F811
    """Ни номера, ни сохранённых байт: страницы считаются, а не читаются из
    выпусков — иначе непечатанный день был бы невидим."""
    in_slot(division)

    page = period(TODAY, TODAY, division)[0]

    assert "number" not in page
    assert page["totals"]["list_total"] == 1


# ── Границы ──────────────────────────────────────────────────────────────


def test_an_inverted_range_is_refused(types, division):  # noqa: F811
    with pytest.raises(DomainError) as exc:
        period(TODAY, TODAY - timedelta(days=1), division)

    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.http_status == 400


def test_a_range_longer_than_the_cap_is_refused(types, division):  # noqa: F811
    """Страница считается отдельным проходом по статусам: неограниченный период
    превращает один запрос в обход всей истории."""
    with pytest.raises(DomainError) as exc:
        period(TODAY - timedelta(days=MAX_PERIOD_DAYS), TODAY, division)

    assert exc.value.detail["max"] == MAX_PERIOD_DAYS


def test_a_range_exactly_at_the_cap_is_allowed(types, division):  # noqa: F811
    """Граница включительна: без этой пробы «слишком длинный» неотличим от
    «длиной ровно в предел»."""
    in_slot(division)

    pages = period(TODAY - timedelta(days=MAX_PERIOD_DAYS - 1), TODAY, division)

    assert len(pages) == MAX_PERIOD_DAYS


def test_a_range_reaching_into_the_future_is_refused(types, division):  # noqa: F811
    """Завтрашние страницы сфабриковались бы из СЕГОДНЯШНЕГО штата и выглядели
    бы настоящими числами за день, которого не было."""
    with pytest.raises(DomainError) as exc:
        period(TODAY, TODAY + timedelta(days=1), division)

    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.detail["date_to"] == (TODAY + timedelta(days=1)).isoformat()


def test_today_itself_is_not_the_future(types, division):  # noqa: F811
    in_slot(division)

    assert len(period(TODAY, TODAY, division)) == 1


def test_the_horizon_follows_the_sections_clock(types, division):  # noqa: F811
    """Тот же период, что отказал «завтра», проходит, когда часы дошли до него.

    Без этой пробы отказ выше объяснялся бы чем угодно — например запретом на
    конкретную дату.
    """
    in_slot(division)
    tomorrow = TODAY + timedelta(days=1)

    with pytest.raises(DomainError):
        period(TODAY, tomorrow, division)

    assert len(period(TODAY, tomorrow, division, at=MORNING + timedelta(days=1))) == 2


# ── Область ──────────────────────────────────────────────────────────────


def test_another_divisions_people_do_not_appear_in_the_pages(types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    in_slot(division)
    in_slot(other)
    in_slot(other)

    page = period(TODAY, TODAY, division)[0]

    assert page["totals"]["list_total"] == 1


def test_without_a_division_the_pages_cover_everything(types, division):  # noqa: F811
    other = Division.objects.create(name="Второе управление")
    in_slot(division)
    in_slot(other)

    page = period(TODAY, TODAY)[0]

    assert page["totals"]["list_total"] == 2
