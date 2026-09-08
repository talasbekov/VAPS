"""Создатель ОМ (`owner_actor_id`) пишется В СЕРВИСЕ, одним сохранением
(Plane №949 — техдолг №947; закрыто ревью №825, 08.09.2026).

До этого идентификатор создателя ставила вьюха `create` ВТОРЫМ
`save(update_fields=["owner_actor_id"])` после того, как `create_event` уже
закоммитил строку: между двумя сохранениями ОМ существовал «ничьим», при
падении второго — оставался таким навсегда, а все остальные вызыватели
сервиса (сиды, будущие ручки) создателя не получали вовсе. Сервис при этом
уже получал ту же строку `actor` и писал из неё `owner_name`.

Актор — только идентификатор учётки (`resolve_actor_id` → `str(user.pk)`,
цифры). Системные метки сидов («stand-seed», «test») в поле «идентификатор
учётки» не пишутся — иначе право «создатель правит» получил бы никто, а поле
врало бы про тип.

КРАСНАЯ ПРОБА: убери `owner_actor_id` из `create_event` — первая проба
увидит пустую строку; пиши `actor` как есть — вторая увидит «stand-seed».
"""
import datetime as dt

import pytest

from organization_management.apps.ops import security_events as event_service

pytestmark = pytest.mark.django_db


def _create(actor):
    return event_service.create_event(
        title="Проба создателя",
        object_id=None,
        business_date=dt.date(2027, 3, 1).isoformat(),
        kind="INTERNAL",
        actor=actor,
    )


def test_the_service_records_the_creator_account_id():
    event = _create("4242")
    event.refresh_from_db()
    assert event.owner_actor_id == "4242"


def test_a_system_actor_is_not_a_creator_account():
    event = _create("stand-seed")
    event.refresh_from_db()
    assert event.owner_actor_id == ""
