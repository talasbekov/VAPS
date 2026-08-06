"""Состояние, посчитанное в Python и в SQL, обязано совпасть.

Состояние строки НЕ ХРАНИТСЯ — оно выводится. Выводится дважды: `@property`
считает его на Python по одной строке, аннотация `with_state()` — в SQL по всей
выборке. Второе нужно, чтобы по состоянию можно было ФИЛЬТРОВАТЬ и СОРТИРОВАТЬ,
не вытаскивая таблицу в память.

Два независимых вычисления одного и того же — это два места, которые правят
порознь. Разойдись они, и список, отфильтрованный «показать действующие»,
покажет строку, у которой в карточке написано «завершён»: сам по себе каждый
ответ выглядит правильным, и расхождение видно только если положить их рядом.

ЧТО БЫЛО ПОКРЫТО ДО ЭТОГО. Одна проверка на двух строках, на одну дату, обе
неотменённые. То есть ни одной границы полуинтервала и ни одной отменённой
строки — а именно там ветки Case/When и цепочка `if` расходятся легче всего:
в Python сравнения записаны как `<`, в SQL — как `__gt` с переставленными
сторонами, и порядок ветвей у них обратный. У прикомандирования сверки не было
вовсе.

ПОЧЕМУ ГРАНИЦЫ ПРИБИТЫ ОТДЕЛЬНО. Случайная дата попадает ровно в `date_start`
или `date_end` примерно раз на четыре тысячи — то есть в обычном прогоне не
попадает никогда. Границы перечислены явно, генератор ищет всё остальное.
"""
import datetime
import itertools

import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
    derive_secondment_state,
)

pytestmark = pytest.mark.django_db

DATES = st.dates(
    min_value=datetime.date(2020, 1, 1), max_value=datetime.date(2030, 12, 31)
)

# Каждой строке — свой сотрудник: у неотменённых строк одного человека
# пересечения запрещены ограничением исключения, а генератор об этом не знает.
_employees = itertools.count(700000)

SETTINGS = settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@st.composite
def cases(draw):
    date_start = draw(DATES)
    span = draw(st.integers(min_value=1, max_value=400))  # date_end > date_start
    cancelled = draw(st.booleans())
    business_date = draw(DATES)
    date_end = date_start + datetime.timedelta(days=span)
    return date_start, date_end, cancelled, business_date


S, E = datetime.date(2026, 1, 10), datetime.date(2026, 1, 20)
DAY = datetime.timedelta(days=1)


def make_status(date_start, date_end, cancelled):
    return OpsEmployeeStatus.objects.create(
        employee_id=next(_employees),
        status_type_code="DUTY",
        date_start=date_start,
        date_end=date_end,
        cancelled_at=(
            datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
            if cancelled
            else None
        ),
        cancelled_by="op" if cancelled else None,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


# ── Статус: Python против SQL ────────────────────────────────────────────


@SETTINGS
# Границы полуинтервала, до которых генератор сам не дотягивается.
@example((S, E, False, S - DAY))  # день ДО начала        -> PLANNED
@example((S, E, False, S))  # день начала           -> ACTIVE (полуинтервал)
@example((S, E, False, E - DAY))  # последний свой день   -> ACTIVE
@example((S, E, False, E))  # день конца            -> COMPLETED (полуинтервал)
@example((S, E, False, E + DAY))  # день ПОСЛЕ конца      -> COMPLETED
# Отмена ортогональна датам и должна перебивать любую из них.
@example((S, E, True, S - DAY))
@example((S, E, True, S))
@example((S, E, True, E))
@given(cases())
def test_the_annotation_agrees_with_the_property(case):
    """Несущий тест: одна строка, одна дата, два способа посчитать."""
    date_start, date_end, cancelled, business_date = case
    row = make_status(date_start, date_end, cancelled)

    annotated = (
        OpsEmployeeStatus.objects.with_state(business_date=business_date)
        .filter(pk=row.pk)
        .get()
    )

    assert annotated.state_annotation == row.state_on(business_date).value


@SETTINGS
@example((S, E, False, S))
@example((S, E, False, E))
@given(cases())
def test_the_bare_property_agrees_too(case):
    """`state` без аргумента берёт бизнес-дату из часов, а `with_state()` без
    аргумента — тоже. Разойдись источники даты, и карточка со списком показали
    бы разное в один и тот же день."""
    date_start, date_end, cancelled, business_date = case
    row = make_status(date_start, date_end, cancelled)

    with clock.override(business_date):
        annotated = OpsEmployeeStatus.objects.with_state().filter(pk=row.pk).get()
        assert annotated.state_annotation == row.state.value


@SETTINGS
# Обе границы полуинтервала и отмена: проба «в SQL интервал стал замкнутым
# справа» проходила мимо этого теста, пока правой границы здесь не было.
@example((S, E, False, S))
@example((S, E, False, E))
@example((S, E, True, S))
@given(cases())
def test_filtering_by_state_returns_exactly_the_rows_in_that_state(case):
    """Ради фильтрации аннотация и заведена.

    Строка обязана находиться по СВОЕМУ состоянию и не находиться ни по одному
    чужому — иначе «показать действующие» врёт в обе стороны сразу.
    """
    date_start, date_end, cancelled, business_date = case
    row = make_status(date_start, date_end, cancelled)
    own = row.state_on(business_date).value

    found = set(
        OpsEmployeeStatus.objects.with_state(business_date=business_date)
        .filter(pk=row.pk)
        .filter(state_annotation=own)
        .values_list("pk", flat=True)
    )
    foreign = set(
        OpsEmployeeStatus.objects.with_state(business_date=business_date)
        .filter(pk=row.pk)
        .exclude(state_annotation=own)
        .values_list("pk", flat=True)
    )

    assert found == {row.pk}
    assert foreign == set()


# ── Прикомандирование: сверки не было вовсе ──────────────────────────────

MOMENT = datetime.datetime(2026, 1, 5, tzinfo=datetime.timezone.utc)

# Подтверждение без запроса на уровне базы недостижимо (ограничение
# «подтверждение не раньше запроса»), поэтому стадий ровно три, и все три
# перечислены. Держать здесь генератор было бы обманом: пространство состояний
# конечно и мало.
HANDSHAKES = [
    (None, None),
    (MOMENT, None),
    (MOMENT, MOMENT + datetime.timedelta(hours=1)),
]


def make_secondment(requested_at, confirmed_at):
    out_leg = make_status(S, E, cancelled=False)
    in_leg = make_status(S, E, cancelled=False)
    return Secondment.objects.create(
        employee_id=out_leg.employee_id,
        out_status=out_leg,
        in_status=in_leg,
        from_division_id=1,
        to_division_id=2,
        return_requested_at=requested_at,
        return_requested_by="asker" if requested_at else None,
        return_confirmed_at=confirmed_at,
        return_confirmed_by="confirmer" if confirmed_at else None,
    )


@pytest.mark.parametrize("requested_at,confirmed_at", HANDSHAKES)
def test_the_secondment_annotation_agrees_with_the_property(requested_at, confirmed_at):
    row = make_secondment(requested_at, confirmed_at)

    annotated = Secondment.objects.with_state().filter(pk=row.pk).get()

    assert annotated.state_annotation == row.state.value


@pytest.mark.parametrize("requested_at,confirmed_at", HANDSHAKES)
def test_every_secondment_stage_is_reachable_and_distinct(requested_at, confirmed_at):
    """Иначе сверка выше могла бы совпасть на одной-единственной стадии.

    Три пары фактов обязаны дать три РАЗНЫХ ответа: слипнись две, и «возврат
    запрошен» стал бы неотличим от «возврат подтверждён».
    """
    row = make_secondment(requested_at, confirmed_at)

    expected = derive_secondment_state(requested_at, confirmed_at)
    assert row.state == expected
    assert len({derive_secondment_state(r, c) for r, c in HANDSHAKES}) == 3


@pytest.mark.parametrize("requested_at,confirmed_at", HANDSHAKES)
def test_filtering_secondments_by_stage_agrees_too(requested_at, confirmed_at):
    """Аннотацией же и фильтруют по стадии — второй набор условий разошёлся бы
    с выводом, и ответ на фильтр перестал бы совпадать с полем в строке."""
    row = make_secondment(requested_at, confirmed_at)

    matched = (
        Secondment.objects.with_state()
        .filter(pk=row.pk, state_annotation=row.state.value)
        .count()
    )
    others = (
        Secondment.objects.with_state()
        .filter(pk=row.pk)
        .exclude(state_annotation=row.state.value)
        .count()
    )

    assert (matched, others) == (1, 0)
