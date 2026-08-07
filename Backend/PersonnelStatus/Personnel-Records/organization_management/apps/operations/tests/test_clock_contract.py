"""Контракт часов раздела: что принимает override и что считает catchup_plan.

Соседний test_clock_discipline проверяет, что настенное время читает ТОЛЬКО
Clock. Здесь — что сам Clock делает то, что обещает. Разница существенная:
дисциплина ловит чужие часы, контракт ловит ошибку в своих, а своих в разделе
две штуки и обе несущие.

`catchup_plan` решает, какие дни пройдёт догон. Ошибка на единицу здесь — это
либо ПРОПУЩЕННЫЙ день (о нём никому не сообщили, и повторить некому:
идемпотентность держится водяным знаком), либо повторённый (второе уведомление
о том же). Ни то, ни другое не выглядит как поломка.

`override` — то, чем каждый тест раздела задаёт время. Прими он наивный
datetime, и вся сюита начала бы жить в неопределённой зоне, а зелёной осталась
бы.

ЗОНА СТЕНДА — Asia/Almaty, то есть +05, и на ней локальная полночь приходится
на 19:00 ПРЕДЫДУЩЕГО дня по UTC. Ошибку «взяли дату из UTC вместо локальной»
такая зона показывает; а вот ошибку в обратную сторону — нет, поэтому ключевые
проверки продублированы на зоне с ОТРИЦАТЕЛЬНЫМ смещением, где локальная
полночь приходится на тот же день в UTC, но позже.
"""
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.test import override_settings

from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock, catchup_plan

D = date(2026, 8, 4)
WEST = "America/New_York"  # −04 летом: локальная полночь позже полуночи UTC


# ── override: что он принимает ───────────────────────────────────────────


def test_a_naive_datetime_is_refused():
    """«В какой зоне?» — ровно та неоднозначность, ради которой Clock и заведён.

    Прими он наивный момент — вся сюита раздела начала бы жить в
    неопределённой зоне, оставаясь зелёной.
    """
    with pytest.raises(TypeError):
        with clock.override(datetime(2026, 8, 4, 12, 0)):
            pass


@pytest.mark.parametrize("value", ["2026-08-04", 1754265600, None, object()])
def test_anything_that_is_not_a_date_is_refused(value):
    """Строка «2026-08-04» и число выглядят как время и им не являются: молча
    принятые, они дали бы Clock значение, которое он не умеет сравнивать."""
    with pytest.raises(TypeError):
        with clock.override(value):
            pass


def test_an_aware_datetime_keeps_the_very_same_moment():
    """Нормализация в UTC не смеет сдвигать момент — она только меняет запись."""
    moment = datetime(2026, 8, 4, 12, 0, tzinfo=dt_timezone.utc)

    with clock.override(moment):
        assert Clock.now() == moment
        assert Clock.now().tzinfo == dt_timezone.utc


def test_a_moment_given_in_another_zone_is_the_same_moment():
    from zoneinfo import ZoneInfo

    moment = datetime(2026, 8, 4, 17, 0, tzinfo=ZoneInfo("Asia/Almaty"))

    with clock.override(moment):
        assert Clock.now() == datetime(2026, 8, 4, 12, 0, tzinfo=dt_timezone.utc)


# ── override датой: полночь чьей зоны ────────────────────────────────────


def test_a_bare_date_freezes_local_midnight_not_utc_midnight():
    """Дата означает МЕСТНУЮ полночь.

    На стенде (+05) местная полночь 4 августа — это 19:00 третьего по UTC.
    Возьми Clock полночь UTC — бизнес-дата совпала бы всё равно, а вот момент
    уехал бы на пять часов, и всё, что сравнивает ВРЕМЯ СУТОК (контрольный
    час), поехало бы вместе с ним.
    """
    with clock.override(D):
        assert Clock.today_local() == D
        assert Clock.now() == datetime(2026, 8, 3, 19, 0, tzinfo=dt_timezone.utc)
        assert Clock.local_now().hour == 0


@override_settings(OPS_LOCAL_TIMEZONE=WEST)
def test_the_same_holds_in_a_zone_west_of_utc():
    """ЗОНА С ОТРИЦАТЕЛЬНЫМ СМЕЩЕНИЕМ, и она здесь не для симметрии.

    На +05 локальная полночь попадает на ПРЕДЫДУЩИЕ сутки UTC, и подмена
    «локальная → UTC» видна сразу. На −04 она попадает на ТЕ ЖЕ сутки UTC,
    только позже, — и та же подмена дала бы верную дату при неверном моменте.
    Проверять только на стендовой зоне значит проверять половину.
    """
    with clock.override(D):
        assert Clock.today_local() == D
        assert Clock.now() == datetime(2026, 8, 4, 4, 0, tzinfo=dt_timezone.utc)
        assert Clock.local_now().hour == 0


@override_settings(OPS_LOCAL_TIMEZONE=WEST)
def test_a_late_utc_moment_is_still_the_previous_local_day_in_the_west():
    """Обратная сторона той же зоны: 02:00 UTC пятого августа — это ещё
    четвёртое по местному. Читай раздел дату из UTC, и день сдачи сменился бы
    на четыре часа раньше срока."""
    with clock.override(datetime(2026, 8, 5, 2, 0, tzinfo=dt_timezone.utc)):
        assert Clock.today_local() == D


def test_the_override_nests_and_unwinds():
    """Вложенность нужна фикстурам: одна ставит день, другая внутри — момент.
    Не восстановись внешняя, соседние тесты поехали бы по времени.
    """
    outer = datetime(2026, 8, 4, 6, 0, tzinfo=dt_timezone.utc)
    inner = datetime(2027, 1, 1, 6, 0, tzinfo=dt_timezone.utc)

    with clock.override(outer):
        with clock.override(inner):
            assert Clock.now() == inner
        assert Clock.now() == outer


def test_the_override_unwinds_after_an_exception():
    """Иначе один упавший тест уводил бы во времени всё, что за ним."""
    before = Clock.now()

    with pytest.raises(RuntimeError):
        with clock.override(datetime(2030, 1, 1, tzinfo=dt_timezone.utc)):
            raise RuntimeError("вызывающий передумал")

    assert Clock.now() - before < timedelta(minutes=1)


# ── catchup_plan: какие дни пройдёт догон ────────────────────────────────


def test_the_plan_is_half_open_on_the_left_and_closed_on_the_right():
    """(знак, сегодня] — знак уже пройден, сегодня ещё нет.

    Три дня, а не два: на двух «полуинтервал» неотличим от «оба конца».
    """
    assert catchup_plan(watermark=D, today=D + timedelta(days=3)) == [
        D + timedelta(days=1),
        D + timedelta(days=2),
        D + timedelta(days=3),
    ]


def test_a_day_already_marked_gives_an_empty_plan():
    """Знак на сегодня означает «этот день уже прошли». Верни план один день —
    и о нём сообщили бы дважды."""
    assert catchup_plan(watermark=D, today=D) == []


def test_a_backwards_clock_halts_instead_of_planning_backwards():
    """Часы назад — это авария окружения, а не задание.

    Отрицательный диапазон дал бы пустой план и молчание; здесь пустой план
    сопровождается записью в лог, и остановка отличима от «нечего делать».
    """
    assert catchup_plan(watermark=D, today=D - timedelta(days=1)) == []


def test_no_watermark_means_nothing_to_do():
    """Знак не заведён — материализация не бутстрапилась, и догонять нечего.
    Считать от нуля значило бы разослать историю за всё время."""
    assert catchup_plan(watermark=None, today=D) == []


def test_two_datetimes_are_refused_rather_than_planned():
    """РЕШАЮЩИЙ СЛУЧАЙ для явной проверки типов, и он не первый попавшийся.

    Смешанная пара (date и datetime) падает и без гварда — Python отказывается
    их сравнивать, — поэтому проба «снять проверку типов» на ней остаётся
    зелёной. А вот ДВА datetime сравниваются и вычитаются прекрасно: без гварда
    функция молча вернула бы план из datetime'ов, то есть дни с временем внутри.
    Дальше по течению такой день лёг бы в водяной знак и в фильтры по дате — и
    разошёлся бы с остальным разделом на неполные сутки.
    """
    moment = datetime(2026, 8, 4, 13, 0, tzinfo=dt_timezone.utc)

    with pytest.raises(TypeError):
        catchup_plan(watermark=moment, today=moment + timedelta(days=2))


@pytest.mark.parametrize(
    ("watermark", "today"),
    [
        (D, datetime(2026, 8, 5, tzinfo=dt_timezone.utc)),
        (datetime(2026, 8, 4, tzinfo=dt_timezone.utc), D),
    ],
)
def test_a_mixed_pair_is_refused_too(watermark, today):
    """Смешанную пару отвергает и сам Python, но отказ обязан приходить от
    гварда: сообщение «takes plain dates» объясняет, что чинить, а
    «can't compare» — нет."""
    with pytest.raises(TypeError, match="plain dates"):
        catchup_plan(watermark=watermark, today=today)


def test_a_long_gap_is_planned_day_by_day_without_holes():
    """Простой в месяц — это месяц дней, о которых никому не сообщили. План
    обязан пройти их все и подряд."""
    plan = catchup_plan(watermark=D, today=D + timedelta(days=30))

    assert len(plan) == 30
    assert plan[0] == D + timedelta(days=1)
    assert plan[-1] == D + timedelta(days=30)
    assert all(
        later - earlier == timedelta(days=1)
        for earlier, later in zip(plan, plan[1:])
    )
