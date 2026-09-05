"""Уведомление раздела: «одно на день», побочность канала и гарды базы.

Ограничения проверяются вставкой В БАЗУ, а не через full_clean: сервис пишет
через get_or_create(), а он валидацию модели не зовёт — инвариант обязан жить
на БД, иначе держится только на дисциплине кода.
"""
from datetime import date

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import notify

pytestmark = pytest.mark.django_db

DAY = date(2026, 8, 5)
KIND = OpsNotification.Kind.SUBMISSION_LAGGING


def test_the_first_call_persists_the_fact():
    row = notify("7", KIND, DAY, payload={"division_ids": ["1", "2"]})

    assert row is not None
    stored = OpsNotification.objects.get(pk=row.pk)
    assert (stored.recipient, stored.kind, stored.business_date) == ("7", KIND, DAY)
    assert stored.payload == {"division_ids": ["1", "2"]}
    assert stored.read_at is None


def test_a_repeat_call_is_a_no_op_and_returns_the_same_row():
    """«Одно на день»: повтор не плодит строку.

    Повтор приходит из догона, который переспрашивает уже пройденные дни по
    построению; без этого каждый повторный прогон был бы рассылкой дубликатов.
    """
    first = notify("7", KIND, DAY)

    second = notify("7", KIND, DAY)

    assert second.pk == first.pk
    assert OpsNotification.objects.count() == 1


def test_the_first_payload_wins_on_a_repeat():
    # Переписать payload значило бы затереть то, что человек уже прочитал.
    notify("7", KIND, DAY, payload={"division_ids": ["1"]})

    notify("7", KIND, DAY, payload={"division_ids": ["1", "2", "3"]})

    assert OpsNotification.objects.get(recipient="7").payload == {
        "division_ids": ["1"]
    }


def test_an_event_key_of_none_never_collapses():
    """`dedupe_key=None` — «событие», и каждый вызов заводит свою строку.

    🔴 ЧТО ЭТО СТЕРЕЖЁТ (Plane №677). «Одно на день» заведено ради догона, но
    часть фактов за день случается много раз: три департамента отвечают штабу
    на запрос сил — это три разных ответа. Под общим ключом второй и третий
    проглатывались без следа, и штаб узнавал только про первый.

    Мутация, на которой проба обязана краснеть: убрать `dedupe_key=None` из
    вызова (или вернуть `get_or_create` для этой ветки) — строк станет 1.
    """
    first = notify("7", KIND, DAY, payload={"n": 1}, dedupe_key=None)
    second = notify("7", KIND, DAY, payload={"n": 2}, dedupe_key=None)

    assert first.pk != second.pk
    assert OpsNotification.objects.filter(recipient="7").count() == 2
    # Каждая строка несёт СВОЙ payload: у «одного на день» побеждает первый,
    # и это правило к событиям неприменимо — второй ответ отличается от
    # первого именно тем, что в нём написано.
    assert {row.payload["n"] for row in OpsNotification.objects.filter(recipient="7")} == {1, 2}


def test_a_named_key_collapses_within_its_own_key_only():
    """Непустой ключ — «одно на такой ключ в день», не одно на день вообще."""
    notify("7", KIND, DAY, dedupe_key="allocation-1")
    notify("7", KIND, DAY, dedupe_key="allocation-1")
    notify("7", KIND, DAY, dedupe_key="allocation-2")

    assert OpsNotification.objects.filter(recipient="7").count() == 2


def test_the_default_key_keeps_one_per_day_for_the_rows_that_had_it():
    """Умолчание не изменилось: без ключа строка по-прежнему одна на день.

    Проба стоит рядом с новыми ветками нарочно: правка ключа «одно на день»
    легко превращается в снятие «одного на день» для всех, а догон
    (`SUBMISSION_LAGGING`) на этом обещании и построен.
    """
    notify("7", KIND, DAY)
    notify("7", KIND, DAY)

    rows = list(OpsNotification.objects.filter(recipient="7"))
    assert len(rows) == 1
    assert rows[0].dedupe_key == ""


def test_the_same_day_reaches_different_recipients_separately():
    notify("7", KIND, DAY)
    notify("8", KIND, DAY)

    assert OpsNotification.objects.count() == 2


def test_a_different_day_is_a_different_notice():
    notify("7", KIND, DAY)
    notify("7", KIND, date(2026, 8, 6))

    assert OpsNotification.objects.count() == 2


def test_whitespace_around_the_recipient_does_not_defeat_the_daily_key():
    """«7» и «7 » — один человек.

    Для ключа «одно на день» это две разные строки, и незамеченный пробел
    (из справочника, из формы) породил бы второе уведомление о том же.
    """
    first = notify("7", KIND, DAY)

    second = notify("  7  ", KIND, DAY)

    assert second.pk == first.pk
    assert OpsNotification.objects.count() == 1


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_a_blank_recipient_is_a_caller_bug_not_a_swallowed_failure(bad):
    # Инфраструктурный сбой глотается, ошибка вызывающего — нет: «сообщить
    # никому» надо чинить в коде, а не узнавать из журнала процесса.
    with pytest.raises(ValueError):
        notify(bad, KIND, DAY)

    assert not OpsNotification.objects.exists()


def test_an_infrastructure_failure_is_swallowed_and_returns_none(monkeypatch):
    """Побочный канал не роняет деловую операцию.

    Сдача дня принята, статус создан — падать из-за того, что кому-то не
    сообщили, они не должны.
    """
    def boom(**kwargs):
        raise RuntimeError("база недоступна")

    monkeypatch.setattr(OpsNotification.objects, "get_or_create", boom)

    assert notify("7", KIND, DAY) is None


def test_the_notice_lives_and_dies_with_the_caller_transaction():
    """Запись СИНХРОННАЯ, внутри транзакции вызывающего.

    Уведомление — следствие делового факта: откат операции обязан унести и
    уведомление о ней, иначе получатель узнаёт о том, чего не случилось.
    Отложенная «до коммита» запись развела бы их.
    """
    class Rollback(Exception):
        pass

    with pytest.raises(Rollback):
        with transaction.atomic():
            notify("7", KIND, DAY)
            # Видно ЗДЕСЬ ЖЕ, до коммита: запись не отложена.
            assert OpsNotification.objects.filter(recipient="7").exists()
            raise Rollback

    assert not OpsNotification.objects.filter(recipient="7").exists()


def test_the_daily_key_is_enforced_by_the_database():
    OpsNotification.objects.create(recipient="7", kind=KIND, business_date=DAY)

    with pytest.raises(IntegrityError), transaction.atomic():
        OpsNotification.objects.create(recipient="7", kind=KIND, business_date=DAY)


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_recipient_is_rejected_by_the_database(blank):
    # «Сообщено никому»: unique на пустой строке выполняется, и все безадресные
    # уведомления схлопнулись бы в одну строку.
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsNotification.objects.create(
            recipient=blank, kind=KIND, business_date=DAY
        )


def test_an_unknown_kind_is_rejected_by_the_database():
    # choices у CharField проверяются только в формах и full_clean, а раздел
    # пишет мимо них.
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsNotification.objects.create(
            recipient="7", kind="ЧТО_УГОДНО", business_date=DAY
        )


def test_the_database_dictionary_covers_every_declared_kind():
    """Гвард расхождения: CHECK — зеркало Kind, и оно ржавеет молча.

    Новый вид в TextChoices без правки CHECK даст IntegrityError на первом же
    боевом уведомлении, а не на выкатке.
    """
    check = next(
        c
        for c in OpsNotification._meta.constraints
        if c.name == "chk_ops_notif_kind"
    )
    allowed = set(check.condition.children[0][1])

    assert allowed == set(OpsNotification.Kind.values)
