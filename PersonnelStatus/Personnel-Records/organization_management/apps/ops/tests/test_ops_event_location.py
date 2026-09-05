"""Локация ОМ структурой и лицо на мероприятии с атрибутами (Plane №418).

Создание и правка принимают `countryId`/`cityId`/`address` — строка
`location` собирается сервером и остаётся у всех прежних читателей; город
чужой страны — отказ полем; вызов без структуры (как до №418) кладёт строку
в `address`. Лица получают атрибуты визита через `protectedPersonDetails`,
состав по-прежнему задаёт `protectedPersonIds`; строки прежней связи
пережили переезд на промежуточную модель.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventPerson,
)
from organization_management.apps.operations.models_geo import OpsCity, OpsCountry
from organization_management.apps.operations.models_gvo import OpsProtectedPerson

from .test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def kz():
    country = OpsCountry.objects.get(code="KZ")
    return country, OpsCity.objects.get(country=country, name="Астана")


def test_create_with_structure_composes_location_and_keeps_readers(manager):  # noqa: F811
    country, city = kz()
    resp = create_event(
        manager, make_object(), countryId=str(country.pk), cityId=str(city.pk),
        address="пр. Мәңгілік Ел, 8",
    )
    assert resp.status_code == 201, resp.data
    body = resp.json()
    assert body["location"] == "Казахстан, Астана, пр. Мәңгілік Ел, 8"
    assert (body["countryId"], body["countryName"]) == (str(country.pk), "Казахстан")
    assert (body["cityId"], body["cityName"]) == (str(city.pk), "Астана")
    assert body["address"] == "пр. Мәңгілік Ел, 8"
    # Реестр читает ту же строку.
    row = next(r for r in manager.get(URL).json()["results"] if r["id"] == body["id"])
    assert row["location"] == body["location"]


def test_city_of_another_country_is_refused_by_the_field(manager):  # noqa: F811
    country, _ = kz()
    ru = OpsCountry.objects.get(code="RU")
    moscow = OpsCity.objects.get(country=ru, name="Москва")
    resp = create_event(
        manager, make_object(), countryId=str(country.pk), cityId=str(moscow.pk)
    )
    assert resp.status_code == 400
    assert "cityId" in resp.json()["details"]
    # Город без страны — страна выводится из города.
    resp = create_event(manager, make_object(code="OBJ-2"), cityId=str(moscow.pk))
    assert resp.status_code == 201, resp.data
    assert resp.json()["countryName"] == "Россия"
    assert resp.json()["location"] == "Россия, Москва"


def test_legacy_string_location_lands_in_address(manager):  # noqa: F811
    resp = create_event(manager, make_object(), location="г. Астана, Акорда")
    assert resp.status_code == 201, resp.data
    body = resp.json()
    assert body["location"] == "г. Астана, Акорда"
    assert body["address"] == "г. Астана, Акорда"
    assert body["countryId"] is None


def test_details_patch_recomposes_location(manager):  # noqa: F811
    country, city = kz()
    event_id = create_event(manager, make_object(), location="старая строка").json()["id"]
    resp = manager.patch(
        f"{URL}{event_id}/details/",
        {"countryId": str(country.pk), "cityId": str(city.pk), "address": "Акорда"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.json()["location"] == "Казахстан, Астана, Акорда"
    # Правка только адреса: страна и город остаются.
    resp = manager.patch(f"{URL}{event_id}/details/", {"address": "Резиденция"}, format="json")
    assert resp.json()["location"] == "Казахстан, Астана, Резиденция"
    assert resp.json()["cityName"] == "Астана"


def test_hiding_a_city_does_not_lock_editing_events_that_already_use_it(manager):  # noqa: F811
    """Скрытый город не запирает правку бюллетеня (Plane №617/№495).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Окно правки шлёт `countryId`/`cityId` ВСЕГДА, а
    `resolve_location` требовал `is_active` от всего, что пришло, — включая
    уже сохранённые координаты. Администратор снимал галочку у города, и после
    этого НИ ОДНО поле НИ ОДНОГО мероприятия в этом городе больше не
    сохранялось: переименование, время, лица — всё отвечало 400 «Город не
    найден в справочнике», про поле, которого человек не касался.

    Это прямо противоречит замыслу, записанному на модели: у ссылки стоит
    `SET_NULL` с доводом «скрытие города из справочника не вправе стирать
    историю мероприятий». Скрытие — обычная операция ведения справочника, а
    последствие наступало не сразу и не у того, кто скрывал.

    Мутация, на которой проба обязана краснеть: убрать `unchanged` из вызова
    `resolve_location` в `update_bulletin_details` — переименование ответит 400.
    """
    country, city = kz()
    event_id = create_event(
        manager, make_object(), countryId=str(country.pk), cityId=str(city.pk),
        address="Акорда",
    ).json()["id"]

    OpsCity.objects.filter(pk=city.pk).update(is_active=False)

    # Окно правки шлёт координаты всегда — воспроизводим его буквально.
    resp = manager.patch(
        f"{URL}{event_id}/details/",
        {
            "title": "Переименовано после скрытия города",
            "countryId": str(country.pk),
            "cityId": str(city.pk),
            "address": "Акорда",
        },
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.json()["title"] == "Переименовано после скрытия города"
    assert resp.json()["cityName"] == "Астана", "город потерян вместе с правкой"

    # И правка ОДНОГО адреса, где координаты подставляет сам сервер.
    resp = manager.patch(f"{URL}{event_id}/details/", {"address": "Резиденция"}, format="json")
    assert resp.status_code == 200, resp.data
    assert resp.json()["location"] == "Казахстан, Астана, Резиденция"


def test_a_hidden_city_still_cannot_be_chosen_anew(manager):  # noqa: F811
    """Скрытый город можно СОХРАНИТЬ прежним, но не ВЫБРАТЬ (Plane №617).

    Половина правки без этой пробы бессмысленна: если ослабить проверку для
    всего подряд, скрытая строка справочника снова станет выбираемой, и
    скрытие перестанет что-либо значить. Проверяются оба входа — заведение
    нового ОМ и перевод существующего в скрытый город.
    """
    country, city = kz()
    hidden = OpsCity.objects.create(country=country, name="Скрытый", is_active=False)

    resp = create_event(
        manager, make_object(), countryId=str(country.pk), cityId=str(hidden.pk)
    )
    assert resp.status_code == 400, resp.data
    assert "cityId" in resp.json()["details"], resp.json()

    event_id = create_event(
        # Свой код объекта: код уникален, и второй `make_object()` в одной
        # пробе столкнулся бы на нём (та же оговорка, что у пробы про город
        # чужой страны выше).
        manager, make_object(code="OBJ-HIDDEN"),
        countryId=str(country.pk), cityId=str(city.pk),
    ).json()["id"]
    resp = manager.patch(
        f"{URL}{event_id}/details/",
        {"countryId": str(country.pk), "cityId": str(hidden.pk)},
        format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "cityId" in resp.json()["details"], resp.json()


def test_the_registry_does_not_pay_two_queries_per_row_for_the_location(manager):  # noqa: F811
    """Число запросов реестра НЕ растёт вместе с числом строк (Plane №619).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. С №418 подпись строки несёт локацию, а `location_view`
    разыменовывает `event.country.name` и `event.city.name`. Queryset списка
    остался прежним — и на каждую строку приходилось ДВА лишних round-trip:
    страница календаря берёт 200 строк, то есть около 400 запросов на один
    заход. Ровно этот регресс уже описан в соседнем комментарии применительно к
    объектам посещения — и был воспроизведён заново.

    Проба считает ТОЛЬКО запросы к справочникам страны и города, а не все
    подряд. Причина не в аккуратности: в реестре есть и ДРУГИЕ построчные
    запросы (замерено — около восьми на строку), они заведены своими
    карточками, и общий счётчик краснел бы от них, а не от этого дефекта.
    Смешав всё в одно число, проба сообщала бы «реестр дорогой» — утверждение
    верное и бесполезное.

    Сравниваются ДВА замера, а не пин на числе: абсолютное число зависит от
    прав, сессии и соседних правок и краснело бы от чужой работы.

    Мутация, на которой проба обязана краснеть: снять
    `select_related("country", "city")` — обращений к справочникам станет по
    два на строку вместо нуля.
    """
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    country, city = kz()
    for number in range(3):
        create_event(
            manager, make_object(code=f"OBJ-N{number}"),
            countryId=str(country.pk), cityId=str(city.pk),
        )

    def geo_queries(captured):
        return [
            q["sql"]
            for q in captured
            if "operations_opscountry" in q["sql"] or "operations_opscity" in q["sql"]
        ]

    with CaptureQueriesContext(connection) as queries:
        assert manager.get(f"{URL}?page_size=50").status_code == 200
    few = len(geo_queries(queries.captured_queries))

    for number in range(3, 9):
        create_event(
            manager, make_object(code=f"OBJ-N{number}"),
            countryId=str(country.pk), cityId=str(city.pk),
        )

    with CaptureQueriesContext(connection) as queries:
        resp = manager.get(f"{URL}?page_size=50")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) >= 9, "строк меньше, чем заведено"

    many = len(geo_queries(queries.captured_queries))
    assert many == few, (
        f"обращений к справочникам локации стало {many} против {few} — реестр "
        "добирает страну и город построчно"
    )


def test_registry_does_not_fetch_persons_and_vehicles_per_row(manager):  # noqa: F811
    """Лица бюллетеня и машины не добираются построчно (Plane №499, №786).

    🔴 ЗАМЕР, А НЕ ВПЕЧАТЛЕНИЕ. `person_links_view` и `list_event_vehicles`
    строили СВОИ queryset поверх строки реестра, и набор запроса их не
    подтягивал: страница добирала по запросу на каждое мероприятие за лицами и
    ещё по одному за машинами. Календарь берёт `page_size=200` — то есть по
    400 лишних round-trip на один заход.

    Считаются обращения К ЭТИМ ДВУМ таблицам, а не все запросы страницы: общее
    число зависит от соседних полей, которые эта карточка не трогает, и
    привязка к нему сделала бы пробу ложно-красной при любой чужой правке.

    Красная на мутации: убрать `Prefetch` из набора запроса реестра либо
    вернуть помощникам собственный queryset — обращений станет по одному на
    строку вместо нуля.
    """
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    country, city = kz()
    person = OpsProtectedPerson.objects.create(name="Ахметов", category="OURS")
    for number in range(3):
        create_event(
            manager, make_object(code=f"OBJ-P{number}"),
            countryId=str(country.pk), cityId=str(city.pk),
            protectedPersonIds=[str(person.pk)],
        )

    def linked(captured):
        return [
            q["sql"]
            for q in captured
            if "ops_security_events_protected_persons" in q["sql"]
            or "ops_event_vehicles" in q["sql"]
        ]

    with CaptureQueriesContext(connection) as queries:
        assert manager.get(f"{URL}?page_size=50").status_code == 200
    few = len(linked(queries.captured_queries))

    for number in range(3, 9):
        create_event(
            manager, make_object(code=f"OBJ-P{number}"),
            countryId=str(country.pk), cityId=str(city.pk),
            protectedPersonIds=[str(person.pk)],
        )

    with CaptureQueriesContext(connection) as queries:
        resp = manager.get(f"{URL}?page_size=50")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) >= 9, "строк меньше, чем заведено"

    many = len(linked(queries.captured_queries))
    assert many == few, (
        f"обращений за лицами и машинами стало {many} против {few} — реестр "
        "добирает их построчно"
    )


def test_person_details_live_on_the_link_and_survive_reset(manager):  # noqa: F811
    first = OpsProtectedPerson.objects.create(name="Абаев", category="OURS")
    second = OpsProtectedPerson.objects.create(name="Бекова", category="OURS")
    resp = create_event(
        manager, make_object(),
        protectedPersonIds=[str(first.pk), str(second.pk)],
        protectedPersonDetails=[
            {"id": str(first.pk), "arrivalAt": "2026-08-10T09:30", "flightArrival": "KC 871",
             "isSenior": True},
        ],
    )
    assert resp.status_code == 201, resp.data
    rows = {r["id"]: r for r in resp.json()["protectedPersons"]}
    assert rows[str(first.pk)]["arrivalAt"] == "2026-08-10T09:30"
    assert rows[str(first.pk)]["flightArrival"] == "KC 871"
    assert rows[str(first.pk)]["isSenior"] is True
    assert rows[str(first.pk)]["code"] == first.display_code
    assert rows[str(second.pk)]["isSenior"] is False
    event_id = resp.json()["id"]

    # Правка атрибутов без смены состава; неверная дата — отказ полем.
    resp = manager.patch(
        f"{URL}{event_id}/details/",
        {"protectedPersonDetails": [{"id": str(second.pk), "departureAt": "2026-08-11T18:00",
                                     "flightDeparture": "KC 872"}]},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    rows = {r["id"]: r for r in resp.json()["protectedPersons"]}
    assert rows[str(second.pk)]["departureAt"] == "2026-08-11T18:00"
    assert rows[str(first.pk)]["flightArrival"] == "KC 871"
    resp = manager.patch(
        f"{URL}{event_id}/details/",
        {"protectedPersonDetails": [{"id": str(first.pk), "arrivalAt": "вчера"}]},
        format="json",
    )
    assert resp.status_code == 400
    assert "protectedPersonDetails" in resp.json()["details"]

    # Состав по-прежнему задаёт список: снятое лицо уходит вместе с атрибутами.
    resp = manager.patch(
        f"{URL}{event_id}/details/", {"protectedPersonIds": [str(second.pk)]}, format="json"
    )
    assert [r["id"] for r in resp.json()["protectedPersons"]] == [str(second.pk)]
    assert OpsSecurityEventPerson.objects.filter(event_id=event_id).count() == 1
    assert OpsSecurityEvent.objects.get(pk=event_id).protected_persons.count() == 1
