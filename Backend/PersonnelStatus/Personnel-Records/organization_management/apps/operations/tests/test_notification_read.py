"""Отметка уведомления прочитанным: чей это факт и какой это момент.

Два решения несут срез. Отметка фиксирует момент ПЕРВОГО прочтения — повторный
вызов его не двигает, иначе переоткрытое уведомление возвращалось бы в «свежие»
и лента «что нового с моего последнего захода» теряла бы смысл. И отметить
чужое нельзя: «прочитано» — утверждение о конкретном человеке, и сказанное за
него оно заставило бы его собственную ленту молчать о том, чего он не видел.

Часы в пробе на неподвижность момента РАЗНЫЕ между двумя вызовами: под одними и
теми же замороженными «момент не сдвинулся» выполнялось бы само собой, и проба
не значила бы ничего.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import mark_read

pytestmark = pytest.mark.django_db

DAY = date(2026, 8, 6)
T0 = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
ME = "7"


def make(recipient=ME, day=DAY):
    return OpsNotification.objects.create(
        recipient=recipient,
        kind=OpsNotification.Kind.SUBMISSION_LAGGING,
        business_date=day,
    )


# ── Отметка ──────────────────────────────────────────────────────────────


def test_an_unread_notification_gets_the_moment_it_was_read():
    row = make()
    assert row.read_at is None

    with clock.override(T0):
        mark_read(row, actor=ME)

    row.refresh_from_db()
    assert row.read_at == T0


def test_the_moment_comes_from_the_sections_clock_and_not_from_the_column():
    """auto_now поставил бы настенное время мимо часов раздела: отметка
    перестала бы быть воспроизводимой и разошлась бы с прочими моментами ленты."""
    row = make()

    with clock.override(T0):
        mark_read(row, actor=ME)

    row.refresh_from_db()
    assert row.read_at == T0


def test_the_service_returns_the_row_so_the_caller_need_not_refetch():
    row = make()

    with clock.override(T0):
        returned = mark_read(row, actor=ME)

    assert returned.pk == row.pk
    assert returned.read_at == T0


# ── Момент ПЕРВОГО прочтения ─────────────────────────────────────────────


def test_reading_it_again_does_not_move_the_moment():
    """Несущий тест среза.

    Часы между вызовами РАЗНЫЕ — иначе «момент не сдвинулся» выполнялось бы
    само собой и проба ничего бы не значила.
    """
    row = make()
    later = T0 + timedelta(hours=5)

    with clock.override(T0):
        mark_read(row, actor=ME)
    with clock.override(later):
        mark_read(row, actor=ME)

    row.refresh_from_db()
    assert row.read_at == T0


def test_a_repeat_call_writes_nothing_at_all(django_assert_num_queries):
    """Холостой повтор не должен даже трогать базу: лента опрашивается часто, и
    запись на каждый показ дала бы поток обновлений ни о чём."""
    row = make()
    with clock.override(T0):
        mark_read(row, actor=ME)

    with django_assert_num_queries(0):
        with clock.override(T0 + timedelta(hours=1)):
            mark_read(row, actor=ME)


def test_a_repeat_call_returns_the_row_rather_than_signalling_a_second_outcome():
    """Возврат один и тот же — вызывающему не приходится различать исходы."""
    row = make()
    with clock.override(T0):
        first = mark_read(row, actor=ME)
        second = mark_read(row, actor=ME)

    assert first.pk == second.pk
    assert second.read_at == T0


# ── Чей это факт ─────────────────────────────────────────────────────────


def test_another_persons_notification_cannot_be_marked_read():
    """Сказав за человека, что он видел уведомление, мы заставили бы его
    собственную ленту молчать о том, чего он не видел."""
    theirs = make(recipient="8")

    with pytest.raises(DomainError) as exc:
        with clock.override(T0):
            mark_read(theirs, actor=ME)

    assert exc.value.code == "PERMISSION_DENIED"
    assert exc.value.http_status == 403


def test_a_refused_mark_leaves_the_row_untouched():
    theirs = make(recipient="8")

    with pytest.raises(DomainError):
        with clock.override(T0):
            mark_read(theirs, actor=ME)

    theirs.refresh_from_db()
    assert theirs.read_at is None


def test_the_recipient_is_trimmed_the_same_way_notify_trims_it():
    """«7» и «7 » — один человек: не обрезав, отметку своего же уведомления
    получил бы отказ 403."""
    row = make()

    with clock.override(T0):
        mark_read(row, actor=" 7 ")

    row.refresh_from_db()
    assert row.read_at == T0


@pytest.mark.parametrize("blank", ["", "   ", None])
def test_a_blank_actor_is_a_programming_error(blank):
    """Безымянная отметка — утверждение ни о ком; молча вернуть строку значило
    бы выдать сбой за успех."""
    row = make()

    with pytest.raises(ValueError):
        mark_read(row, actor=blank)


# ── Соседи не задеты ─────────────────────────────────────────────────────


def test_marking_one_notification_leaves_the_others_unread():
    first = make(day=DAY)
    second = make(day=DAY - timedelta(days=1))

    with clock.override(T0):
        mark_read(first, actor=ME)

    second.refresh_from_db()
    assert second.read_at is None
