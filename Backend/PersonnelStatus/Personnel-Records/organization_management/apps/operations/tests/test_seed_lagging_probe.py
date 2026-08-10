"""Сид контура несдачи: РОВНО одно уведомление на следующем прогоне эмиттера.

Проверяется не «команда что-то записала», а её ОБЕЩАНИЕ: после сида штатный
check_lagging_submissions выдаёт РОВНО одно уведомление, и выдаёт его в любое
время суток. Второе — главное: без обнулённого контрольного часа прогон до 17:00
отодвинул бы горизонт на вчера и дал бы ноль, и стенд краснел бы в зависимости от
того, когда его завели.

Этот файл уже поймал дефект первого прохода: команда брала целью ВЧЕРА (как
источник), план эмиттера растягивался на два дня, и уведомлений выходило два.
Настраиваемый день после этого убран вовсе — он не мог удержать обещание.

Сама команда НИЧЕГО не уведомляет: иначе проверялась бы фикстура, а не эмиттер.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.operations import clock
from organization_management.apps.operations.lagging_check import (
    WATERMARK_KEY,
    check_lagging_submissions,
)
from organization_management.apps.operations.management.commands import (
    seed_lagging_probe,
)
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
)
from organization_management.apps.operations.models_watermark import OpsWatermark

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 6)
BEFORE_CONTROL_HOUR = datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc)
AFTER_CONTROL_HOUR = datetime(2026, 8, 6, 20, 0, tzinfo=timezone.utc)
RECIPIENT = seed_lagging_probe.DEFAULT_RECIPIENT


def seed(at=BEFORE_CONTROL_HOUR, **options):
    with clock.override(at):
        call_command("seed_lagging_probe", **options)


def emit(at):
    with clock.override(at):
        return check_lagging_submissions()


def notifications(recipient=RECIPIENT):
    return OpsNotification.objects.filter(recipient=recipient)


# ── Обещание команды ─────────────────────────────────────────────────────


def test_the_seed_itself_notifies_nobody():
    """Иначе проверялась бы фикстура, а не эмиттер."""
    seed()

    assert notifications().count() == 0


@pytest.mark.parametrize(
    "at", [BEFORE_CONTROL_HOUR, AFTER_CONTROL_HOUR], ids=["до часа", "после часа"]
)
def test_the_next_emitter_run_produces_exactly_one_notification(at):
    """Несущий тест: РОВНО одно, и в любое время суток.

    Обе точки обязательны. При обычном контрольном часе прогон до него дал бы
    ноль, а после — два (план из двух дней), и стенд краснел бы в зависимости от
    того, когда его завели.
    """
    seed(at=at)

    emit(at)

    assert notifications().count() == 1


def test_the_notification_is_about_the_day_the_command_announced(capsys):
    seed()
    announced = _announced_day(capsys)

    emit(BEFORE_CONTROL_HOUR)

    assert notifications().get().business_date == announced


def _announced_day(capsys):
    for line in capsys.readouterr().out.splitlines():
        if line.startswith("PROBE_DAY="):
            return date.fromisoformat(line.split("=", 1)[1])
    raise AssertionError("команда не напечатала PROBE_DAY")


def test_the_announced_day_is_today(capsys):
    """День здесь не настраивается, и это выяснилось пробой, а не рассуждением.

    Первый проход брал целью ВЧЕРА (как источник) и выдавал ДВА уведомления:
    горизонт эмиттера считается от его «сегодня», и план (знак, горизонт]
    растягивался на два дня. Сегодняшний день закрыт всегда — контрольный час
    обнулён, — поэтому целью может быть только он.
    """
    seed()

    assert _announced_day(capsys) == TODAY


def test_running_the_seed_twice_still_yields_one_notification():
    """Стенд заводят повторно, и второй сид обязан оставлять ту же картину, а не
    копить получателю прошлые уведомления."""
    seed()
    emit(BEFORE_CONTROL_HOUR)
    seed()
    emit(BEFORE_CONTROL_HOUR)

    assert notifications().count() == 1


# ── Что именно записано ──────────────────────────────────────────────────


def test_the_control_hour_is_zeroed():
    seed()

    assert OpsSubmissionControlSettings.objects.get(singleton_key=1).control_hour == (
        time(0, 0)
    )


def test_the_probe_division_is_the_one_required_to_submit():
    seed()

    settings_row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    assert settings_row.required_division_ids == [
        seed_lagging_probe.PROBE_DIVISION_ID
    ]


def test_the_watermark_stands_one_day_before_the_target(capsys):
    """Полуинтервал (знак, горизонт] даёт ровно один день.

    Не поставь знак — первый запуск эмиттера только заведёт его и сразу выйдет,
    никого не уведомив.
    """
    seed()
    announced = _announced_day(capsys)

    stored = OpsWatermark.objects.get(key=WATERMARK_KEY)
    assert stored.last_materialized_date == announced - timedelta(days=1)


def test_a_previous_notification_of_the_same_recipient_is_cleared():
    """Строка от вчерашнего прогона (у которого «вчера» было другим днём)
    помешала бы не публикации, а СЧЁТУ: непрочитанных стало бы два."""
    OpsNotification.objects.create(
        recipient=RECIPIENT,
        kind=OpsNotification.Kind.SUBMISSION_LAGGING,
        business_date=TODAY - timedelta(days=30),
    )

    seed()

    assert notifications().count() == 0


def test_another_recipients_notifications_are_left_alone():
    """Сид не должен подчищать чужую ленту: на стенде рядом могут идти другие
    проверки."""
    OpsNotification.objects.create(
        recipient="someone-else",
        kind=OpsNotification.Kind.SUBMISSION_LAGGING,
        business_date=TODAY - timedelta(days=30),
    )

    seed()

    assert notifications("someone-else").count() == 1


# ── Отказы ───────────────────────────────────────────────────────────────


def test_a_non_ascii_recipient_is_refused_loudly():
    """Кириллица в заголовке отклоняется ещё до сети, и разбирать это потом
    пришлось бы со стороны браузера."""
    with pytest.raises(CommandError):
        seed(recipient="оператор")


def test_a_blank_recipient_is_refused():
    with pytest.raises(CommandError):
        seed(recipient="   ")
