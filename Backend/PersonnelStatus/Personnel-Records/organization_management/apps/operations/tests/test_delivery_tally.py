"""Счёт рассылки: считается ДОСТАВЛЕННОЕ, а не попытки (Plane №829).

🔴 ЗАЧЕМ ОТДЕЛЬНАЯ ПРОБА, если правило уже проверено у трёх рассылок. До №829
оно жило тремя копиями, и проверялось тоже трижды — по одной пробе на модуль
(`test_ops_forces_notify`, `test_ops_placement_return_notify` и соседи). Теперь
правило ОДНО, и проверять его надо там же, где оно живёт: иначе четвёртый
модуль, написанный без помощника, снова унесёт правило с собой, а пробы соседей
останутся зелёными и ничего не скажут.

Разбор, почему правило вообще нужно: `notify()` по замыслу глотает любое
исключение и возвращает `None` — рассылка не должна ронять бизнес-операцию.
Значит безусловный `notified += 1` пишет в аудит доставку, которой не было
(карточки №561, №809).
"""
import datetime as dt

import pytest

from organization_management.apps.operations import notify_service

DAY = dt.date(2026, 9, 24)


def test_a_swallowed_failure_is_not_counted_as_delivered(monkeypatch):
    """Отказ `notify` не превращается в «доставлено».

    Красная мутация — считать безусловно (`self.notified += 1` до проверки):
    `notified` станет 1, а `undelivered` пустым.
    """
    monkeypatch.setattr(notify_service, "notify", lambda *a, **kw: None)
    tally = notify_service.DeliveryTally()

    landed = tally.deliver("42", "KIND", DAY, {}, label="Иванов")

    assert landed is False
    assert tally.notified == 0
    assert tally.undelivered == ["Иванов · 42"]


def test_a_delivered_row_is_counted_and_not_listed(monkeypatch):
    """Удачная доставка считается и в список недоставленного НЕ попадает."""
    monkeypatch.setattr(notify_service, "notify", lambda *a, **kw: object())
    tally = notify_service.DeliveryTally()

    assert tally.deliver("42", "KIND", DAY, {}, label="Иванов") is True
    assert tally.notified == 1
    assert tally.undelivered == []


def test_the_signature_names_both_the_person_and_the_account(monkeypatch):
    """Подпись недоставленного — «имя · учётка», один формат на все модули.

    Имя нужно тому, кто пойдёт звонить человеку, учётка — тому, кто пойдёт
    смотреть, почему запись не легла. Разноформатная графа заставила бы
    читателя журнала ветвиться (найдено ревью, задача №825).
    """
    monkeypatch.setattr(notify_service, "notify", lambda *a, **kw: None)
    tally = notify_service.DeliveryTally()

    tally.deliver("u-7", "KIND", DAY, {}, label="Петров П.П.")

    assert tally.undelivered == ["Петров П.П. · u-7"]


def test_a_person_without_an_account_is_not_a_delivery_failure(monkeypatch):
    """«Учётки нет» — это НЕ отказ доставки, и путать их нельзя.

    Списки разные по смыслу: `unlinked` — просить некого (заводить учётку),
    `undelivered` — просили, но не легло (смотреть, почему). Слив их в один,
    разбор «почему не отреагировали» пошёл бы не туда.
    """
    called = []
    monkeypatch.setattr(notify_service, "notify", lambda *a, **kw: called.append(a))
    tally = notify_service.DeliveryTally()

    tally.skip_unlinked("Сидоров")

    assert tally.unlinked == ["Сидоров"]
    assert tally.undelivered == []
    assert tally.notified == 0
    assert called == [], "у сотрудника без учётки рассылку звать не за чем"
