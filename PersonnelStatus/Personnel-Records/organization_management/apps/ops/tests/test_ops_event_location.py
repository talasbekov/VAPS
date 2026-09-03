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
