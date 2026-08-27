"""Правка сведений бюллетеня после создания (Plane №192).

Заказчик: «Нету кнопки Редактировать. После плюсика, поставить иконку для
редактирования». Кнопки не было потому, что править было нечем: у мероприятия
не существовало ни одной ручки правки, и опечатка в названии жила до удаления
мероприятия.

ГЛАВНОЕ, ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ, — не «поле сохранилось», а РАЗНИЦА между
«ключа нет» и «ключ пустой». Первое означает «не трогай», второе — «очисти».
Спутать их значит стирать охраняемое лицо и локацию при каждой частичной
правке, и заметить это можно будет только по жалобе.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import security_events as event_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def person():
    from organization_management.apps.operations.models_gvo import (
        OpsProtectedPerson,
    )

    return OpsProtectedPerson.objects.create(
        name="Охраняемое лицо пробы", category=OpsProtectedPerson.Category.OURS
    )


@pytest.fixture
def event(person):
    return event_service.create_event(
        title="Было название",
        object_id=None,
        business_date=dt.date(2026, 6, 1).isoformat(),
        business_date_end=dt.date(2026, 6, 3).isoformat(),
        kind="INTERNAL",
        event_time="09:00",
        protected_person_id=str(person.pk),
        location="Было место",
        actor="test",
    )


def test_the_title_is_edited(event):
    updated = event_service.update_bulletin_details(
        event.pk, title="Стало название", actor="test"
    )

    assert updated.title == "Стало название"


def test_fields_that_were_not_sent_are_left_alone(event, person):
    """КЛЮЧА НЕТ — ПОЛЕ НЕ ТРОГАЕМ. Красная проба против «очистить всё, что
    не прислали»: именно так частичная правка стирает лицо и локацию."""
    updated = event_service.update_bulletin_details(
        event.pk, title="Только название", actor="test"
    )

    assert updated.protected_person_id == person.pk
    assert updated.protected_person_name == "Охраняемое лицо пробы"
    assert updated.location == "Было место"
    assert updated.event_time == dt.time(9, 0)
    assert updated.business_date == dt.date(2026, 6, 1)
    assert updated.business_date_end == dt.date(2026, 6, 3)


def test_an_empty_value_clears_the_field(event):
    """КЛЮЧ ПУСТОЙ — ОЧИЩАЕМ. Обратная сторона той же границы: лицо и локацию
    законно снимают, и «не могу очистить» было бы таким же дефектом."""
    updated = event_service.update_bulletin_details(
        event.pk,
        protected_person_id="",
        location="",
        event_time="",
        business_date_end="",
        actor="test",
    )

    assert updated.protected_person_id is None
    assert updated.protected_person_name == "", "снимок подписи пережил снятие лица"
    assert updated.location == ""
    assert updated.event_time is None
    assert updated.business_date_end is None


def test_an_empty_title_is_refused(event):
    """Название очистить нельзя — это не необязательное поле."""
    with pytest.raises(DomainError) as raised:
        event_service.update_bulletin_details(event.pk, title="   ", actor="test")

    assert raised.value.http_status == 400
    assert "title" in raised.value.detail
    event.refresh_from_db()
    assert event.title == "Было название", "название всё-таки затёрлось"


def test_the_end_is_checked_against_the_new_start(event):
    """Пара дат проверяется на ТОЙ паре, которая получится.

    Прислали только начало — сравнивать надо с уже сохранённым окончанием, а
    не с прежним началом. Здесь новое начало заезжает ЗА сохранённое
    окончание 03.06, и это должно быть отказом.
    """
    with pytest.raises(DomainError) as raised:
        event_service.update_bulletin_details(
            event.pk, business_date="2026-06-10", actor="test"
        )

    assert raised.value.http_status == 400
    assert "businessDateEnd" in raised.value.detail


def test_both_dates_move_together(event):
    """Обе даты разом — разрешено: пара остаётся согласованной."""
    updated = event_service.update_bulletin_details(
        event.pk,
        business_date="2026-06-10",
        business_date_end="2026-06-12",
        actor="test",
    )

    assert updated.business_date == dt.date(2026, 6, 10)
    assert updated.business_date_end == dt.date(2026, 6, 12)


def test_a_bad_date_is_refused_by_field(event):
    with pytest.raises(DomainError) as raised:
        event_service.update_bulletin_details(
            event.pk, business_date="10.06.2026", actor="test"
        )

    assert "businessDate" in raised.value.detail
    event.refresh_from_db()
    assert event.business_date == dt.date(2026, 6, 1)


def test_an_unknown_person_is_refused(event, person):
    with pytest.raises(DomainError) as raised:
        event_service.update_bulletin_details(
            event.pk, protected_person_id="999999", actor="test"
        )

    assert "protectedPersonId" in raised.value.detail
    event.refresh_from_db()
    assert event.protected_person_id == person.pk


def test_a_closed_event_is_not_edited(event):
    """Закрытое мероприятие — история: сведения отработавшего наряда не
    переписываются."""
    event.stage = "CLOSED"
    event.save(update_fields=["stage"])

    with pytest.raises(DomainError) as raised:
        event_service.update_bulletin_details(
            event.pk, title="Переписали историю", actor="test"
        )

    assert raised.value.http_status == 422
    event.refresh_from_db()
    assert event.title == "Было название"


def test_an_edit_writes_the_journal_with_both_sides(event):
    """Журнал называет и КАК БЫЛО, и как стало.

    Одного «стало» мало: по этим полям сверяют уже выгруженный бюллетень, и
    вопрос всегда звучит как «а что там стояло раньше».
    """
    from organization_management.apps.operations.models_audit import OpsAuditLog

    event_service.update_bulletin_details(
        event.pk, title="Стало название", actor="test"
    )

    entry = OpsAuditLog.objects.filter(
        action="SECURITY_EVENT_DETAILS_UPDATED", entity_id=event.pk
    ).latest("created_at")
    assert entry.old_value["title"] == "Было название"
    assert entry.new_value["title"] == "Стало название"


def test_an_edit_that_changes_nothing_writes_no_journal_row(event):
    """Правка без единого поля следа не оставляет: «ничего не менял» — не
    событие, и лента, засоренная такими, перестаёт отвечать на свой вопрос."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    before = OpsAuditLog.objects.filter(
        action="SECURITY_EVENT_DETAILS_UPDATED"
    ).count()

    event_service.update_bulletin_details(event.pk, actor="test")

    assert (
        OpsAuditLog.objects.filter(
            action="SECURITY_EVENT_DETAILS_UPDATED"
        ).count()
        == before
    )
