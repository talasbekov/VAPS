"""Догон эффектов: порядок дней, простой, часы назад и порог здравого смысла.

Материализаторы подставляются тестом (реестр раздела пуст — это шов): движок
проверяется как движок, а не через чей-то будущий эффект. Записанные вызовы
показывают и ЧТО звали, и в каком порядке — хронология здесь не украшение:
эффекты одного дня опираются на состояние предыдущего.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from django.db import connection
from django.db.backends.postgresql.base import Database

from organization_management.apps.operations import catch_up
from organization_management.apps.operations.catch_up import (
    CATCHUP_SANITY_DAYS,
    MAX_CATCHUP_DAYS,
    STATUS_EFFECTS_LOCK_KEY,
    WATERMARK_KEY,
    materialize_status_effects,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_watermark import OpsWatermark

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 5)


@pytest.fixture
def recorder():
    """Материализатор, запоминающий дни, за которые его звали."""
    seen = []

    def mat(*, business_date):
        seen.append(business_date)

    mat.seen = seen
    return mat


def mark_at(day):
    OpsWatermark.objects.create(key=WATERMARK_KEY, last_materialized_date=day)


def stored_mark():
    return OpsWatermark.objects.get(key=WATERMARK_KEY).last_materialized_date


def test_the_first_run_bootstraps_the_mark_and_fires_nothing(recorder):
    """Свежая выкатка не отматывает историю назад.

    Иначе первый же запуск проехал бы по всем дням, за которые данные вообще
    существуют, и разослал бы уведомления за прошлый год.
    """
    result = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert (result.watermark_before, result.watermark_after) == (None, TODAY)
    assert result.processed_days == []
    assert recorder.seen == []
    assert stored_mark() == TODAY


def test_a_second_run_on_the_same_day_does_nothing(recorder):
    mark_at(TODAY)

    result = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert result.processed_days == []
    assert result.halted is False
    assert recorder.seen == []
    assert stored_mark() == TODAY


def test_downtime_is_caught_up_day_by_day_in_order(recorder):
    """Трое суток простоя — три дня по порядку, а не «за сегодня».

    Пропущенный день не сливается с сегодняшним: эффект привязан к своей
    деловой дате, и «догнать одним махом» означало бы приписать позавчерашние
    события сегодняшнему числу.
    """
    mark_at(TODAY - timedelta(days=3))

    result = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert recorder.seen == [
        TODAY - timedelta(days=2),
        TODAY - timedelta(days=1),
        TODAY,
    ]
    assert result.processed_days == recorder.seen
    assert result.watermark_after == TODAY
    assert stored_mark() == TODAY


def test_every_registered_materializer_is_called_for_every_day():
    first, second = [], []
    mark_at(TODAY - timedelta(days=1))

    materialize_status_effects(
        today=TODAY,
        materializers=[
            lambda *, business_date: first.append(business_date),
            lambda *, business_date: second.append(business_date),
        ],
    )

    assert first == [TODAY] and second == [TODAY]


def test_the_clock_going_backwards_halts_instead_of_no_op(recorder):
    """Часы назад — остановка с причиной, а не тихий холостой проход.

    План дней пуст в ОБОИХ случаях: и когда догонять нечего, и когда часы
    сбиты. Отличает их только явное сравнение; без него сбитые часы выглядели
    бы как нормальный день без работы и не были бы замечены никогда.
    """
    mark_at(TODAY)

    result = materialize_status_effects(
        today=TODAY - timedelta(days=1), materializers=[recorder]
    )

    assert result.halted is True
    assert result.halt_reason == "clock_behind_watermark"
    assert recorder.seen == []
    assert stored_mark() == TODAY


def test_an_absurd_gap_halts_instead_of_grinding_through_it(recorder):
    # Разрыв в годы — это не простой, а сбитые часы или кривой посев. Такое
    # надо показать, а не материализовать.
    mark_at(TODAY - timedelta(days=CATCHUP_SANITY_DAYS + 1))

    result = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert result.halted is True
    assert result.halt_reason == "gap_exceeds_sanity"
    assert recorder.seen == []


def test_a_gap_at_the_sanity_ceiling_is_still_processed(recorder):
    # Порог — граница «почти наверняка сбой», и она не должна срабатывать на
    # длинном, но правдоподобном простое.
    mark_at(TODAY - timedelta(days=CATCHUP_SANITY_DAYS))

    result = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert result.halted is False
    assert len(result.processed_days) == MAX_CATCHUP_DAYS


def test_a_long_backlog_is_processed_in_portions(recorder):
    """Один прогон не перемалывает хвост целиком — берёт порцию.

    И, главное, ДВИГАЕТ знак на пройденное: следующий прогон продолжает
    оттуда, а не начинает сначала.
    """
    start = TODAY - timedelta(days=MAX_CATCHUP_DAYS + 9)
    mark_at(start)

    first = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert len(first.processed_days) == MAX_CATCHUP_DAYS
    assert first.watermark_after == start + timedelta(days=MAX_CATCHUP_DAYS)
    assert stored_mark() == first.watermark_after

    second = materialize_status_effects(today=TODAY, materializers=[recorder])

    assert second.processed_days == [
        first.watermark_after + timedelta(days=n) for n in range(1, 10)
    ]
    assert stored_mark() == TODAY
    # Ни один день не прошёл дважды и ни один не пропущен.
    assert recorder.seen == [
        start + timedelta(days=n) for n in range(1, MAX_CATCHUP_DAYS + 10)
    ]


def test_a_concurrent_run_is_skipped_rather_than_queued(recorder):
    """Замок занят — прогон пропускается, а не встаёт вторым.

    Занятость видна только со ВТОРОГО соединения: внутри одного сеанса
    консультативный замок берётся повторно счётчиком.
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

        result = materialize_status_effects(today=TODAY, materializers=[recorder])

        assert result.skipped is True
        assert recorder.seen == []
        assert stored_mark() == TODAY - timedelta(days=1)
    finally:
        with outsider.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [STATUS_EFFECTS_LOCK_KEY])
        outsider.close()


def test_today_must_be_a_plain_date():
    # datetime IS-A date: молча принятый момент срезал бы неполный день и
    # уехал бы в план дней.
    with pytest.raises(TypeError):
        materialize_status_effects(
            today=datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
        )


def test_the_default_today_comes_from_the_section_clock(recorder):
    from organization_management.apps.operations import clock

    with clock.override(TODAY):
        result = materialize_status_effects(materializers=[recorder])

    assert result.watermark_after == TODAY


def test_the_empty_registry_is_the_default(recorder):
    # Реестр сегодня пуст — движок обязан работать (двигать знак) и без
    # эффектов, иначе первый подключённый эффект получил бы годовой разрыв.
    mark_at(TODAY - timedelta(days=1))

    result = materialize_status_effects(today=TODAY)

    assert catch_up.EFFECT_MATERIALIZERS == ()
    assert result.processed_days == [TODAY]


@pytest.mark.django_db(transaction=True)
def test_a_day_is_all_or_nothing():
    """Упавший день откатывается ЦЕЛИКОМ — вместе с уже записанным эффектом.

    Эффектов у дня будет несколько, и записаны они должны быть либо все, либо
    ни одного: полусделанный день неотличим от сделанного, а повтор наложил бы
    вторую половину поверх первой. Знак и записи дня коммитятся одной
    транзакцией — без неё запись первого материализатора пережила бы падение
    второго.
    """
    start = TODAY - timedelta(days=1)
    mark_at(start)

    def writer(*, business_date):
        OpsAuditLog.objects.create(
            actor_user_id="система",
            action="CATCH_UP_PROBE",
            entity_type="probe",
            entity_id=1,
            created_at=datetime(2026, 8, 5, 0, 0, tzinfo=timezone.utc),
        )

    def boom(*, business_date):
        raise RuntimeError("второй эффект дня упал")

    try:
        with pytest.raises(RuntimeError):
            materialize_status_effects(today=TODAY, materializers=[writer, boom])

        assert not OpsAuditLog.objects.filter(action="CATCH_UP_PROBE").exists()
        assert stored_mark() == start
    finally:
        # Строку журнала не убираем: он дополняется только (DELETE запрещён
        # триггером), а после transaction=True базу и так чистит сама сюита.
        OpsWatermark.objects.filter(key=WATERMARK_KEY).delete()


@pytest.mark.django_db(transaction=True)
def test_a_failing_day_leaves_the_mark_on_the_previous_one():
    """Падение на дне N откатывает ТОЛЬКО день N.

    Пройденные дни уже закоммичены — знак стоит на N-1, и следующий прогон
    повторит именно упавший день, а не всю цепочку с начала.
    """
    start = TODAY - timedelta(days=3)
    mark_at(start)
    seen = []

    def flaky(*, business_date):
        if business_date == start + timedelta(days=2):
            raise RuntimeError("эффект упал")
        seen.append(business_date)

    try:
        with pytest.raises(RuntimeError):
            materialize_status_effects(today=TODAY, materializers=[flaky])

        assert seen == [start + timedelta(days=1)]
        assert stored_mark() == start + timedelta(days=1)
    finally:
        OpsWatermark.objects.filter(key=WATERMARK_KEY).delete()
