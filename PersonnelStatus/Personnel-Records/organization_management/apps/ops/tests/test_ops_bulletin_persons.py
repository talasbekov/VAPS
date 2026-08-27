"""Несколько охраняемых лиц у бюллетеня (Plane №188).

Заказчик: «Там есть выбрать справочник ОЛ, туда нужно добавить возможность
выбирать несколько или возможность добавления ОЛ в список».

ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ ПОМИМО «список сохранился». Список приехал РЯДОМ со
старым одиночным полем, и опасность у такой пары одна и та же во всех местах:
разойтись. Поэтому пробы держат три границы —

1. главное лицо = первое в списке (колонка «ОЛ» бланка одна, и кто-то обязан
   в неё попасть);
2. старое одиночное поле продолжает работать: им шлют мок-слой, сиды и все
   вызовы, написанные до №188;
3. история ГВО по лицу находит мероприятие и тогда, когда лицо в списке НЕ
   первое — иначе второй и третий участник теряют свою историю молча.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import gvo, security_events as event_service
from organization_management.apps.ops.api import serializers

pytestmark = pytest.mark.django_db


def _person(name):
    from organization_management.apps.operations.models_gvo import OpsProtectedPerson

    return OpsProtectedPerson.objects.create(
        name=name, category=OpsProtectedPerson.Category.FOREIGN
    )


@pytest.fixture
def alpha():
    return _person("Первое лицо")


@pytest.fixture
def beta():
    return _person("Второе лицо")


@pytest.fixture
def gamma():
    return _person("Третье лицо")


def make_event(**kwargs):
    params = {
        "title": "Проба лиц",
        "object_id": None,
        "business_date": dt.date(2026, 7, 1).isoformat(),
        "kind": "FOREIGN",
        "actor": "test",
    }
    params.update(kwargs)
    return event_service.create_event(**params)


def test_several_persons_are_saved_at_creation(alpha, beta, gamma):
    event = make_event(
        protected_person_ids=[str(alpha.pk), str(beta.pk), str(gamma.pk)]
    )

    assert set(event.protected_persons.values_list("pk", flat=True)) == {
        alpha.pk,
        beta.pk,
        gamma.pk,
    }


def test_the_first_person_becomes_the_main_one(alpha, gamma):
    """Главное лицо — ПЕРВОЕ НАЗВАННОЕ, а не первое по алфавиту.

    Выбор по алфавиту менял бы шапку документа от переименования человека.

    Пара выбрана НАРОЧНО ПРОТИВ алфавита: «Третье лицо» названо первым, а по
    алфавиту первым идёт «Первое лицо». Первая редакция этой пробы брала пару
    «Второе/Первое», где алфавит совпадал с порядком ввода, — и мутация
    «сортировать по имени» её не роняла: проба стерегла бы совпадение, а не
    правило.
    """
    event = make_event(protected_person_ids=[str(gamma.pk), str(alpha.pk)])

    assert event.protected_person_id == gamma.pk
    assert event.protected_person_name == "Третье лицо"


def test_duplicates_are_dropped_silently(alpha, beta):
    """Одно лицо, выбранное дважды, — оговорка ввода, а не заявление о двух
    людях. Отбивать это ошибкой значило бы требовать от человека внимания
    там, где намерение очевидно."""
    event = make_event(
        protected_person_ids=[str(alpha.pk), str(beta.pk), str(alpha.pk)]
    )

    assert event.protected_persons.count() == 2
    assert event.protected_person_id == alpha.pk


def test_an_unknown_person_in_the_list_is_refused(alpha):
    """Неизвестный идентификатор — отказ ПОЛЕМ, а не тихий пропуск.

    Молча выброшенное лицо человек заметит только по документу, в котором его
    нет, — то есть в худший момент.
    """
    with pytest.raises(DomainError) as raised:
        make_event(protected_person_ids=[str(alpha.pk), "999999"])

    assert "protectedPersonIds" in raised.value.detail


def test_the_old_single_field_still_works(alpha):
    """КРАСНАЯ ПРОБА СОВМЕСТИМОСТИ. Старое поле шлют мок-слой, сиды и всё,
    написанное до №188; починить окно и сломать остальное — не выполнение."""
    event = make_event(protected_person_id=str(alpha.pk))

    assert event.protected_person_id == alpha.pk
    assert list(event.protected_persons.values_list("pk", flat=True)) == [alpha.pk]


def test_the_list_can_be_edited_after_creation(alpha, beta, gamma):
    event = make_event(protected_person_ids=[str(alpha.pk)])

    updated = event_service.update_bulletin_details(
        event.pk,
        protected_person_ids=[str(beta.pk), str(gamma.pk)],
        actor="test",
    )

    assert set(updated.protected_persons.values_list("pk", flat=True)) == {
        beta.pk,
        gamma.pk,
    }
    assert updated.protected_person_id == beta.pk


def test_an_empty_list_removes_every_person(alpha, beta):
    event = make_event(protected_person_ids=[str(alpha.pk), str(beta.pk)])

    updated = event_service.update_bulletin_details(
        event.pk, protected_person_ids=[], actor="test"
    )

    assert updated.protected_persons.count() == 0
    assert updated.protected_person_id is None
    assert updated.protected_person_name == ""


def test_the_list_is_left_alone_when_the_key_is_absent(alpha, beta):
    """Ключа нет — список не трогаем. Та же граница, что у остальных полей
    правки (№192): иначе частичная правка стирала бы лиц."""
    event = make_event(protected_person_ids=[str(alpha.pk), str(beta.pk)])

    updated = event_service.update_bulletin_details(
        event.pk, title="Другое название", actor="test"
    )

    assert updated.protected_persons.count() == 2


def test_clearing_the_old_single_field_clears_the_list_too(alpha, beta):
    """Снятие через СТАРОЕ поле снимает и список.

    Оставить в списке того, кого сняли с главного поля, значило бы показать
    человеку на экране лицо, которое он только что убрал.
    """
    event = make_event(protected_person_ids=[str(alpha.pk), str(beta.pk)])

    updated = event_service.update_bulletin_details(
        event.pk, protected_person_id="", actor="test"
    )

    assert updated.protected_persons.count() == 0
    assert updated.protected_person_id is None


def test_the_serializer_carries_the_whole_list(alpha, beta):
    event = make_event(protected_person_ids=[str(beta.pk), str(alpha.pk)])

    body = serializers.serialize_security_event(event)

    # Главное поле — то, что читают клиенты до №188.
    assert body["protectedPersonId"] == str(beta.pk)
    assert body["protectedPersonName"] == "Второе лицо"
    # Список — по имени, чтобы вывод не зависел от порядка вставки.
    assert [row["name"] for row in body["protectedPersons"]] == [
        "Второе лицо",
        "Первое лицо",
    ]


def test_history_finds_the_event_for_a_person_who_is_not_the_main_one(alpha, beta):
    """История ГВО находит ОМ и по НЕ главному лицу.

    Это самая тихая из ошибок такого переезда: главное лицо свою историю
    видит, остальные — нет, и заметить это можно только зная, что мероприятие
    было.
    """
    event = make_event(protected_person_ids=[str(alpha.pk), str(beta.pk)])
    event.stage = "CLOSED"
    event.save(update_fields=["stage"])

    rows = gvo.person_event_history(beta.pk)

    assert [row["code"] for row in rows] == [event.code]


def test_history_has_no_duplicates_from_the_join(alpha):
    """Соединение по связи умеет удваивать строки — `distinct` это и лечит."""
    event = make_event(protected_person_ids=[str(alpha.pk)])
    event.stage = "CLOSED"
    event.save(update_fields=["stage"])

    rows = gvo.person_event_history(alpha.pk)

    assert len(rows) == 1


def test_the_bulletin_document_lists_every_person(alpha, beta):
    """Колонка «ОЛ» бланка одна — лица перечисляются через запятую, главное
    первым."""
    from organization_management.apps.ops.documents_bulletin import bulletin_rows

    event = make_event(protected_person_ids=[str(beta.pk), str(alpha.pk)])

    row = next(
        r
        for r in bulletin_rows(dt.date(2026, 7, 1))
        if r["event"] == event.title
    )

    assert row["person"] == "Второе лицо, Первое лицо"
