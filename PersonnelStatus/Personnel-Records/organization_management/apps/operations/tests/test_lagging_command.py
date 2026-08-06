"""Команда поиска отставших: что она печатает, чем падает и что не даёт руками.

Команда — единственный вход в работу сегодня, и её ответственность именно
входная: перевести аргумент в дату, отсечь безрассудную дату и НЕ выдать за
остановку два совершенно нормальных исхода — утренний прогон до контрольного
часа и занятый замок. Сам поиск отставших проверен у движка.
"""
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.db.backends.postgresql.base import Database

from organization_management.apps.operations import clock
from organization_management.apps.operations.lagging_check import LAGGING_LOCK_KEY
from organization_management.apps.operations.tests.test_lagging_check import (
    DAY,
    YESTERDAY,
    after_hour,
    before_hour,
    make_division,
    mark_at,
    pin_recipient,
    set_required,
    stored_mark,
)

pytestmark = pytest.mark.django_db


def run(*args):
    out = StringIO()
    call_command("check_lagging_submissions", *args, stdout=out)
    return out.getvalue()


def laggard(name="A", recipient="42"):
    """Подразделение, обязанное сдавать и (нигде) не сдавшее."""
    division = make_division(name)
    pin_recipient(division, recipient)
    return division


def test_the_first_run_reports_the_bootstrapped_mark():
    with clock.override(after_hour(DAY)):
        output = run()

    assert "поиск отставших прошёл" in output
    # Знак заводится на ВЧЕРА и рассылки задним числом не делает.
    assert stored_mark() == YESTERDAY
    assert "дней: 0" in output


def test_a_backlog_run_reports_how_many_days_went_through():
    a = laggard()
    set_required([a.id])
    mark_at(DAY - timedelta(days=2))

    with clock.override(after_hour(DAY)):
        output = run()

    assert "дней: 2" in output
    assert stored_mark() == DAY


def test_the_reported_reach_counts_recipients_not_laggards():
    """«Охвачено» — про получателей, а не про подразделения.

    Одному человеку за два его управления уходит ОДНО уведомление (иначе
    второе, с тем же ключом «одно на день», просто не записалось бы). Число,
    напечатанное по числу отставших, обещало бы оператору две рассылки там,
    где была одна.
    """
    a, b = laggard("A", "42"), laggard("B", "42")
    set_required([a.id, b.id])
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        output = run()

    assert "получателей охвачено: 1" in output


def test_before_the_control_hour_an_idle_run_is_a_success_not_a_halt():
    """Утренний прогон — самый частый, и он штатно не находит ничего.

    До контрольного часа сегодняшний день ещё не проверяется: те, кто имеет
    право сдать, не отставшие. Выдай команда здесь ненулевой выход — планировщик
    алертил бы каждое утро на здоровом поведении.
    """
    a = laggard()
    set_required([a.id])
    mark_at(YESTERDAY)

    with clock.override(before_hour(DAY)):
        output = run()

    assert "поиск отставших прошёл" in output
    assert "дней: 0" in output
    # Знак НЕ уехал за сегодня: вечерний прогон обязан этот день переспросить.
    assert stored_mark() == YESTERDAY


def test_the_day_can_be_given_explicitly_for_a_past_catch_up():
    a = laggard()
    set_required([a.id])
    mark_at(DAY - timedelta(days=3))

    with clock.override(after_hour(DAY)):
        run("--today", YESTERDAY.isoformat())

    assert stored_mark() == YESTERDAY


def test_a_future_day_is_refused_before_it_can_poison_the_mark():
    """Дата из будущего не доходит до движка.

    Знак уехал бы вперёд реального времени, и КАЖДЫЙ последующий обычный
    прогон вставал бы на «часы позади знака» — до ручной правки БД. Флаг
    существует ради догона прошлого; отказ поэтому на входе.
    """
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        with pytest.raises(CommandError, match="в будущем"):
            run("--today", (DAY + timedelta(days=1)).isoformat())

    assert stored_mark() == YESTERDAY


def test_today_itself_is_not_treated_as_the_future():
    # Граница включающая: «сегодня» — обычный прогон, а не отравление знака.
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        run("--today", DAY.isoformat())

    assert stored_mark() == DAY


@pytest.mark.parametrize("bad", ["вчера", "05.08.2026", "2026-13-01"])
def test_an_unparseable_day_is_refused(bad):
    with pytest.raises(CommandError, match="ГГГГ-ММ-ДД"):
        run("--today", bad)


def test_a_halt_exits_with_an_error_rather_than_printing_success():
    """Остановка обязана быть ВИДНА.

    Напечатанная строкой, она утонула бы в журнале планировщика: тот смотрит
    на код возврата. «Часы позади знака» означает, что дальше никто не ищет
    отставших, — молчать об этом нельзя.
    """
    mark_at(DAY)

    with clock.override(after_hour(DAY)):
        with pytest.raises(CommandError, match="ОСТАНОВЛЕН"):
            run("--today", YESTERDAY.isoformat())

    assert stored_mark() == DAY


def test_a_busy_lock_is_reported_and_is_not_an_error():
    """Занятый замок — не сбой: работа идёт, просто её ведёт другой прогон.

    Ошибкой это делать нельзя: планировщик, запускающий команду чаще, чем она
    отрабатывает, начал бы регулярно алертить на здоровом поведении.
    """
    mark_at(YESTERDAY)
    params = connection.get_connection_params()
    for driver_only in ("cursor_factory", "context", "row_factory"):
        params.pop(driver_only, None)
    outsider = Database.connect(**params)
    outsider.autocommit = True
    try:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", [LAGGING_LOCK_KEY])
            assert cur.fetchone()[0] is True

        with clock.override(after_hour(DAY)):
            output = run()

        assert "пропущен" in output
        assert stored_mark() == YESTERDAY
    finally:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [LAGGING_LOCK_KEY])
        outsider.close()
