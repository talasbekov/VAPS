"""Справочники «страна → город» и код `OL-N` охраняемого лица (Plane №417).

Код выдаётся сам и не правится; сид миграции 0078 оставляет справочник
непустым; чтение — под `catalog.view` (как у охраняемых лиц), без права —
403; скрытые строки не приезжают; города — по стране.
"""
import pytest

from organization_management.apps.operations.models_geo import OpsCity, OpsCountry
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

COUNTRIES = "/api/ops/countries/"


def test_protected_person_gets_a_sequential_code_it_cannot_change():
    first = OpsProtectedPerson.objects.create(name="Первый", category="OURS")
    second = OpsProtectedPerson.objects.create(name="Второй", category="OURS")
    assert first.code == f"OL-{first.pk}"
    assert second.code == f"OL-{second.pk}"
    assert first.code != second.code

    # Правка имени код не трогает.
    first.name = "Первый (переименован)"
    first.save()
    first.refresh_from_db()
    assert first.code == f"OL-{first.pk}"
    # Мимо save() (bulk_create) код в базе не появляется, но выводим.
    OpsProtectedPerson.objects.bulk_create(
        [OpsProtectedPerson(name="Массовый", category="OURS")]
    )
    bulk = OpsProtectedPerson.objects.get(name="Массовый")
    assert bulk.code is None and bulk.display_code == f"OL-{bulk.pk}"


def test_seed_left_the_dictionary_populated_and_the_api_reads_it():
    assert OpsCountry.objects.filter(code="KZ").exists()
    kz = OpsCountry.objects.get(code="KZ")
    assert OpsCity.objects.filter(country=kz, name="Астана").exists()

    api, _ = client_for("reader", "READER", perms=("catalog.view",))
    resp = api.get(COUNTRIES)
    assert resp.status_code == 200, resp.data
    rows = resp.json()["results"]
    assert {"id": str(kz.pk), "code": "KZ", "name": "Казахстан"} in rows

    cities = api.get(f"{COUNTRIES}{kz.pk}/cities/")
    assert cities.status_code == 200
    names = [c["name"] for c in cities.json()["results"]]
    assert "Астана" in names and "Алматы" in names
    assert all(c["countryId"] == str(kz.pk) for c in cities.json()["results"])


def test_hidden_rows_do_not_arrive_and_unknown_country_is_404():
    hidden = OpsCountry.objects.create(code="ZZ", name="Скрытая", is_active=False)
    kz = OpsCountry.objects.get(code="KZ")
    OpsCity.objects.create(country=kz, name="Скрытый город", is_active=False)
    api, _ = client_for("reader2", "READER", perms=("catalog.view",))

    codes = [c["code"] for c in api.get(COUNTRIES).json()["results"]]
    assert "ZZ" not in codes
    names = [c["name"] for c in api.get(f"{COUNTRIES}{kz.pk}/cities/").json()["results"]]
    assert "Скрытый город" not in names
    assert api.get(f"{COUNTRIES}{hidden.pk}/cities/").status_code == 404


def test_reading_needs_catalog_view_not_event_view():
    api, _ = client_for("viewer", "VIEWER", perms=("event.view",))
    assert api.get(COUNTRIES).status_code == 403
    nobody, _ = client_for("nobody")
    assert nobody.get(COUNTRIES).status_code == 403


def test_person_catalog_carries_the_code():
    person = OpsProtectedPerson.objects.create(name="Кодовый", category="OURS")
    api, _ = client_for("reader3", "READER", perms=("catalog.view",))
    rows = api.get("/api/ops/protected-persons/").json()["results"]
    assert {"id": str(person.pk), "code": person.code} in [
        {"id": r["id"], "code": r["code"]} for r in rows
    ]
