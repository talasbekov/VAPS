"""Команда догона: что она печатает, чем падает и что не даёт сделать руками.

Команда — единственный вход в движок сегодня, и её ответственность именно
входная: перевести аргумент в дату, отсечь безрассудную дату и НЕ выдать
остановку за обычный проход. Сама материализация проверена у движка.
"""
from datetime import date, timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.db.backends.postgresql.base import Database

from organization_management.apps.operations import clock
from organization_management.apps.operations.catch_up import (
    STATUS_EFFECTS_LOCK_KEY,
    WATERMARK_KEY,
)
from organization_management.apps.operations.models_watermark import OpsWatermark

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 5)


def mark_at(day):
    OpsWatermark.objects.create(key=WATERMARK_KEY, last_materialized_date=day)


def run(*args):
    out = StringIO()
    call_command("materialize_status_effects", *args, stdout=out)
    return out.getvalue()


def test_the_first_run_reports_the_bootstrapped_mark():
    with clock.override(TODAY):
        output = run()

    assert "догон прошёл" in output
    assert OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date == TODAY


def test_a_backlog_run_reports_how_many_days_went_through():
    mark_at(TODAY - timedelta(days=2))

    with clock.override(TODAY):
        output = run()

    assert "дней: 2" in output
    assert OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date == TODAY


def test_the_day_can_be_given_explicitly_for_a_past_catch_up():
    mark_at(TODAY - timedelta(days=3))

    with clock.override(TODAY):
        run("--today", (TODAY - timedelta(days=1)).isoformat())

    assert OpsWatermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == TODAY - timedelta(days=1)


def test_a_future_day_is_refused_before_it_can_poison_the_mark():
    """Дата из будущего не доходит до движка.

    Знак уехал бы вперёд реального времени, и КАЖДЫЙ последующий обычный
    прогон вставал бы на «часы позади знака» — до ручной правки БД. Флаг
    существует ради догона прошлого; отказ поэтому на входе.
    """
    mark_at(TODAY - timedelta(days=1))

    with clock.override(TODAY):
        with pytest.raises(CommandError, match="в будущем"):
            run("--today", (TODAY + timedelta(days=1)).isoformat())

    assert OpsWatermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == TODAY - timedelta(days=1)


def test_today_itself_is_not_treated_as_the_future():
    # Граница включающая: «сегодня» — обычный прогон, а не отравление знака.
    mark_at(TODAY - timedelta(days=1))

    with clock.override(TODAY):
        run("--today", TODAY.isoformat())

    assert OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date == TODAY


@pytest.mark.parametrize("bad", ["вчера", "05.08.2026", "2026-13-01"])
def test_an_unparseable_day_is_refused(bad):
    with pytest.raises(CommandError, match="ГГГГ-ММ-ДД"):
        run("--today", bad)


def test_a_halt_exits_with_an_error_rather_than_printing_success():
    """Остановка обязана быть ВИДНА.

    Напечатанная строкой, она утонула бы в журнале планировщика: тот смотрит
    на код возврата. «Часы позади знака» означает, что дальше никто не
    догоняет — молчать об этом нельзя.
    """
    mark_at(TODAY)

    with clock.override(TODAY):
        with pytest.raises(CommandError, match="ОСТАНОВЛЕН"):
            run("--today", (TODAY - timedelta(days=1)).isoformat())

    assert OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date == TODAY


def test_a_busy_lock_is_reported_and_is_not_an_error():
    """Занятый замок — не сбой: работа идёт, просто её ведёт другой прогон.

    Ошибкой это делать нельзя: планировщик, запускающий команду чаще, чем она
    отрабатывает, начал бы регулярно алертить на здоровом поведении.
    """
    mark_at(TODAY - timedelta(days=1))
    params = connection.get_connection_params()
    for driver_only in ("cursor_factory", "context", "row_factory"):
        params.pop(driver_only, None)
    outsider = Database.connect(**params)
    outsider.autocommit = True
    try:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", [STATUS_EFFECTS_LOCK_KEY])
            assert cur.fetchone()[0] is True

        with clock.override(TODAY):
            output = run()

        assert "пропущен" in output
        assert OpsWatermark.objects.get(
            key=WATERMARK_KEY
        ).last_materialized_date == TODAY - timedelta(days=1)
    finally:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [STATUS_EFFECTS_LOCK_KEY])
        outsider.close()
