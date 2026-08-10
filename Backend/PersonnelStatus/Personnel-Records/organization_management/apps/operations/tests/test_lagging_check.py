"""Поиск отставших: контрольный час, простой, группировка и цена сбоя.

Движок здесь тот же, что у догона эффектов, поэтому проверяется не он второй
раз, а то, чем эта работа от него ОТЛИЧАЕТСЯ: дедлайн дня, разрешение
адресата, группировка по получателю и запрет уводить знак за день, о котором
не сообщили.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from django.db import connection
from django.db.backends.postgresql.base import Database

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import catch_up, clock, lagging_check
from organization_management.apps.operations.lagging_check import (
    CATCHUP_SANITY_DAYS,
    LAGGING_LOCK_KEY,
    MAX_CATCHUP_DAYS,
    WATERMARK_KEY,
    LaggingCheckResult,
    LaggingNotifyError,
    check_lagging_submissions,
)
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.operations.models_watermark import OpsWatermark
from organization_management.apps.operations.selectors import (
    SubmissionControlSettingsSelector,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    submitted,
)

pytestmark = pytest.mark.django_db

LOCAL = ZoneInfo("Asia/Almaty")  # +05, без перевода часов
DAY = date(2026, 8, 5)
YESTERDAY = DAY - timedelta(days=1)


def make_division(name="Управление"):
    return Division.objects.create(name=name)


def set_required(division_ids):
    # Через селектор, а не .objects.get(): тесты с настоящими транзакциями
    # вычищают таблицы целиком, включая посеянную миграцией строку настроек.
    row = SubmissionControlSettingsSelector.get()
    row.required_division_ids = list(division_ids)
    row.save(update_fields=["required_division_ids"])


def set_duty(recipient):
    row = SubmissionControlSettingsSelector.get()
    row.default_notify_recipient = recipient
    row.save(update_fields=["default_notify_recipient"])


def pin_recipient(division, recipient):
    OpsDivisionNotifyRecipient.objects.create(
        division_id=division.id, recipient=recipient
    )


def mark_at(day):
    OpsWatermark.objects.create(key=WATERMARK_KEY, last_materialized_date=day)


def stored_mark():
    return OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date


def after_hour(day, hour=18):
    """Местный момент ПОСЛЕ контрольного часа (по умолчанию 17:00)."""
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=LOCAL)


def before_hour(day, hour=8):
    """Местный момент ДО контрольного часа."""
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=LOCAL)


def notices(**filters):
    return OpsNotification.objects.filter(
        kind=OpsNotification.Kind.SUBMISSION_LAGGING, **filters
    )


# ── Отставший и его уведомление ──────────────────────────────────────────


def test_a_laggard_is_reported_to_its_recipient():
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    note = notices(business_date=DAY).get()
    assert note.recipient == "42"
    assert note.payload == {"laggard_division_ids": [a.id]}
    assert result.notified_count == 1
    assert stored_mark() == DAY


def test_the_division_ids_stay_integers():
    """Целые, а не строки: JSON знает целые.

    Строка заставила бы каждого читателя разбирать её обратно — и первый же
    сравнивший её с id из дерева получил бы «не найдено» на существующем
    подразделении.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        check_lagging_submissions()

    assert notices(business_date=DAY).get().payload["laggard_division_ids"] == [a.id]


def test_everyone_submitted_means_nobody_is_reported():
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    submitted(a, DAY)
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert notices().count() == 0
    assert result.notified_count == 0
    # День всё равно ПРОЙДЕН: «никто не отстал» — это результат проверки, а не
    # повод переспрашивать день завтра.
    assert stored_mark() == DAY


def test_a_second_run_the_same_day_does_not_repeat_the_notice():
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        check_lagging_submissions()
        check_lagging_submissions()

    assert notices(business_date=DAY).count() == 1


def test_a_legal_override_does_not_cancel_the_notice():
    """Обход снимает ЗАМОК на завтрашний расход, а не факт отставания.

    Открыть завтра вопреки отставшему — законное решение с ответственным; оно
    не отменяет того, что за подразделением день, и ответственный обязан об
    этом узнать.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    OpsTomorrowBlockOverride.objects.create(
        business_date=DAY, reason="учение", overridden_by="9"
    )
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        check_lagging_submissions()

    assert notices(business_date=DAY).count() == 1


# ── Контрольный час ──────────────────────────────────────────────────────


def test_before_the_control_hour_the_day_is_not_checked():
    """Утром отставших ещё нет — у всех есть право сдать.

    И знак обязан УСТОЯТЬ: уехав на сегодня до дедлайна, он лишил бы вечерний
    прогон возможности переспросить этот день — навсегда.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(before_hour(DAY)):
        result = check_lagging_submissions()

    assert notices().count() == 0
    assert result.processed_days == []
    assert result.halted is False  # это не сбой, а «ещё рано»
    assert stored_mark() == YESTERDAY


def test_exactly_at_the_control_hour_it_is_still_too_early():
    # Граница строгая — как и у отметки опоздания: ровно в 17:00 сдача ещё не
    # поздняя, значит и отставших ещё нет. Иначе одна и та же секунда была бы
    # «вовремя» для сдачи и «отставанием» для рассылки.
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(datetime(DAY.year, DAY.month, DAY.day, 17, 0, tzinfo=LOCAL)):
        result = check_lagging_submissions()

    assert result.processed_days == []
    assert stored_mark() == YESTERDAY


def test_after_the_control_hour_the_day_is_checked():
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert result.processed_days == [DAY]
    assert notices(business_date=DAY).count() == 1


def test_the_horizon_is_counted_by_local_days_not_utc():
    """Час ночи по-местному — это уже новый день, хотя по UTC ещё вчера.

    Раздел живёт в +05, и дата по UTC отстаёт от местной все ночные часы. Взяв
    её, прогон в 01:00 считал бы горизонтом позавчера и на сутки опаздывал бы
    с рассылкой каждую ночь.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(DAY - timedelta(days=2))
    local_night = datetime(DAY.year, DAY.month, DAY.day, 1, 0, tzinfo=LOCAL)
    assert local_night.astimezone(timezone.utc).date() == YESTERDAY  # по UTC — вчера

    with clock.override(local_night):
        result = check_lagging_submissions()

    # Горизонт = вчера (сегодняшний дедлайн ещё не прошёл), а не позавчера.
    assert result.processed_days == [YESTERDAY]


def test_nothing_to_do_before_the_control_hour_is_not_a_halt(caplog):
    # Знак уже догнан до вчера, сегодня ещё рано: пустой проход обязан пройти
    # МИМО плана дней, иначе тот записал бы в журнал ложную тревогу «часы
    # позади знака» — каждое утро. Молчание журнала здесь и есть проверяемое:
    # по одному лишь halted=False подмена прошла бы незамеченной.
    mark_at(YESTERDAY)

    with clock.override(before_hour(DAY)):
        with caplog.at_level(logging.ERROR):
            result = check_lagging_submissions()

    assert result.halted is False
    assert (result.watermark_before, result.watermark_after) == (YESTERDAY, YESTERDAY)
    assert [record.message for record in caplog.records] == []


def test_a_mark_already_on_today_is_not_mistaken_for_a_backwards_clock(caplog):
    """Вечерний прогон прошёл сегодня, утренний следующего дня — холостой.

    Горизонт утром отстаёт от знака НА ПОСТРОЕНИИ (он равен вчера), и приняв
    это за часы, ушедшие назад, работа поднимала бы тревогу каждое утро после
    каждого удачного вечера. Сбитые часы отличает сравнение с НАСТОЯЩЕЙ датой.

    Проверяемое здесь — МОЛЧАНИЕ журнала: результат холостого прохода и
    прохода с ложной тревогой одинаков до последнего поля, различает их
    только запись об ошибке.
    """
    mark_at(DAY)

    with clock.override(before_hour(DAY)):
        with caplog.at_level(logging.ERROR):
            result = check_lagging_submissions()

    assert result.halted is False
    assert result.processed_days == []
    assert stored_mark() == DAY
    assert [record.message for record in caplog.records] == []


# ── Простой и первый запуск ──────────────────────────────────────────────


def test_downtime_is_caught_up_day_by_day():
    """Трое суток без запуска — три дня, у каждого своё уведомление.

    Слить их в одно значило бы сообщить об отставании только за последний
    день, а предыдущие потерять: у уведомления своя деловая дата.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    start = DAY - timedelta(days=3)
    mark_at(start)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert result.processed_days == [start + timedelta(days=n) for n in (1, 2, 3)]
    assert stored_mark() == DAY
    assert notices().count() == 3
    assert sorted(notices().values_list("business_date", flat=True)) == (
        result.processed_days
    )


def test_the_first_run_starts_from_yesterday_without_backfill():
    """Свежая выкатка не рассылает за прошлый год.

    Со ВЧЕРА, а не с сегодня: сегодняшний день ещё обязан быть проверен после
    своего дедлайна, и знак на сегодня проглотил бы его.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    assert not OpsWatermark.objects.filter(key=WATERMARK_KEY).exists()

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert notices().count() == 0
    assert result.processed_days == []
    assert stored_mark() == YESTERDAY


def test_a_manual_past_run_does_not_bootstrap_the_mark_backwards():
    """Ручной прогон за прошлую дату НА ПЕРВОМ запуске не отматывает знак.

    Опора заведения — настоящие часы. Иначе знак встал бы в прошлое, и порог
    здравого смысла заклинил бы все последующие настоящие прогоны.
    """
    with clock.override(after_hour(DAY)):
        check_lagging_submissions(today=DAY - timedelta(days=200))

    assert stored_mark() == YESTERDAY


# ── Остановки ────────────────────────────────────────────────────────────


def test_the_clock_going_backwards_halts(caplog):
    ahead = DAY + timedelta(days=5)
    mark_at(ahead)

    with clock.override(after_hour(DAY)):
        with caplog.at_level(logging.ERROR):
            result = check_lagging_submissions()

    assert result.halted is True
    assert result.halt_reason == "clock_behind_watermark"
    assert stored_mark() == ahead
    assert any("часы позади" in record.message for record in caplog.records)


def test_an_absurd_gap_halts_instead_of_mailing_a_year_of_days():
    start = DAY - timedelta(days=CATCHUP_SANITY_DAYS + 1)
    mark_at(start)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert result.halted is True
    assert result.halt_reason == "gap_exceeds_sanity"
    assert stored_mark() == start
    assert notices().count() == 0


def test_a_long_backlog_is_processed_in_portions():
    a = make_division("A")
    set_required([a.id])
    set_duty("42")
    start = DAY - timedelta(days=MAX_CATCHUP_DAYS + 5)
    mark_at(start)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert len(result.processed_days) == MAX_CATCHUP_DAYS
    assert stored_mark() == start + timedelta(days=MAX_CATCHUP_DAYS)


# ── Кому именно ──────────────────────────────────────────────────────────


def test_each_recipient_gets_only_its_own_divisions():
    a = make_division("A")
    b = make_division("Б")
    set_required([a.id, b.id])
    pin_recipient(a, "свой")
    set_duty("дежурный")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        check_lagging_submissions()

    assert notices(recipient="свой").get().payload == {"laggard_division_ids": [a.id]}
    assert notices(recipient="дежурный").get().payload == {
        "laggard_division_ids": [b.id]
    }


def test_one_recipient_of_two_laggards_gets_a_single_notice():
    """Одному человеку за два его управления — одно уведомление.

    Не из экономии: ключ «одно на день» идёт по получателю, и второе просто
    не записалось бы — человек узнал бы лишь об одном из своих управлений.
    """
    a = make_division("A")
    b = make_division("Б")
    set_required([a.id, b.id])
    set_duty("дежурный")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    note = notices(business_date=DAY).get()
    assert note.recipient == "дежурный"
    assert note.payload == {"laggard_division_ids": sorted([a.id, b.id])}
    assert result.notified_count == 1


def test_a_laggard_without_a_recipient_is_logged_and_skipped(caplog):
    """Некому сообщить — не повод не сообщить остальным.

    Молчать о таком подразделении плохо, поэтому оно попадает в журнал
    процесса; но падение из-за одного незакреплённого оставило бы без
    уведомления всех прочих.
    """
    a = make_division("A")
    b = make_division("Б")
    set_required([a.id, b.id])
    pin_recipient(b, "42")
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        with caplog.at_level(logging.WARNING):
            result = check_lagging_submissions()

    assert notices(business_date=DAY).get().recipient == "42"
    assert result.notified_count == 1
    assert any("нет получателя" in record.message for record in caplog.records)
    # День пройден — знак не топчется на месте из-за незакреплённого.
    assert stored_mark() == DAY


# ── Одновременность и форма вызова ───────────────────────────────────────


def test_a_concurrent_run_is_skipped_rather_than_queued():
    """Занятость видна только со ВТОРОГО соединения: в своём сеансе
    консультативный замок берётся повторно счётчиком."""
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
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
            result = check_lagging_submissions()

        assert result.skipped is True
        assert notices().count() == 0
        assert stored_mark() == YESTERDAY
    finally:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [LAGGING_LOCK_KEY])
        outsider.close()


def test_this_job_shares_neither_mark_nor_lock_with_the_effects_catch_up():
    # Общий знак означал бы, что одна работа двигает горизонт другой, общий
    # замок — что они ждут друг друга без единой причины.
    assert WATERMARK_KEY != catch_up.WATERMARK_KEY
    assert LAGGING_LOCK_KEY != catch_up.STATUS_EFFECTS_LOCK_KEY


def test_today_must_be_a_plain_date():
    # datetime IS-A date: молча принятый момент срезал бы неполный день.
    with pytest.raises(TypeError):
        check_lagging_submissions(
            today=datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
        )


def test_the_default_today_comes_from_the_section_clock():
    mark_at(YESTERDAY)

    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()

    assert isinstance(result, LaggingCheckResult)
    assert result.watermark_after == DAY


# ── Цена несостоявшегося уведомления ─────────────────────────────────────

NOTIFY = "organization_management.apps.operations.lagging_check.notify"


@pytest.mark.django_db(transaction=True)
def test_a_swallowed_notify_failure_holds_the_mark_on_the_previous_day(monkeypatch):
    """Здесь уведомление и ЕСТЬ операция, поэтому None становится ошибкой.

    Проглоти его прогон — знак уехал бы за день, о котором не сообщили, и
    повторить этот день было бы уже некому: идемпотентность держится ровно
    знаком.
    """
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    mark_at(YESTERDAY)
    monkeypatch.setattr(NOTIFY, lambda *args, **kwargs: None)

    try:
        with clock.override(after_hour(DAY)):
            with pytest.raises(LaggingNotifyError):
                check_lagging_submissions()

        assert stored_mark() == YESTERDAY
        assert notices().count() == 0
    finally:
        OpsWatermark.objects.filter(key=WATERMARK_KEY).delete()
        Division.objects.filter(pk=a.id).delete()


@pytest.mark.django_db(transaction=True)
def test_a_failure_mid_catch_up_keeps_the_days_already_committed(monkeypatch):
    """Падение на дне N откатывает ТОЛЬКО день N.

    Пройденные дни уже закоммичены своими транзакциями — знак стоит на N-1, и
    следующий прогон повторит именно упавший день, а не всю цепочку.
    """
    real_notify = lagging_check.notify
    a = make_division("A")
    set_required([a.id])
    pin_recipient(a, "42")
    start = DAY - timedelta(days=3)
    fail_day = DAY - timedelta(days=1)
    mark_at(start)

    def flaky(recipient, kind, business_date, payload=None):
        if business_date == fail_day:
            return None
        return real_notify(recipient, kind, business_date, payload=payload)

    monkeypatch.setattr(NOTIFY, flaky)

    try:
        with clock.override(after_hour(DAY)):
            with pytest.raises(LaggingNotifyError):
                check_lagging_submissions()

        assert stored_mark() == DAY - timedelta(days=2)
        assert notices(business_date=DAY - timedelta(days=2)).count() == 1
        assert notices(business_date=fail_day).count() == 0
        assert notices(business_date=DAY).count() == 0
    finally:
        OpsWatermark.objects.filter(key=WATERMARK_KEY).delete()
        OpsNotification.objects.all().delete()
        OpsDivisionNotifyRecipient.objects.all().delete()
        Division.objects.filter(pk=a.id).delete()
