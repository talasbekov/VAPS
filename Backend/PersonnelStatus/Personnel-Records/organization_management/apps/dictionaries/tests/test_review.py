"""UC-REF-001: confirmation, history, immutable identity, and shared geo data."""
import pytest
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.models_geo import OpsCountry, OpsCity
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.ops.tests.test_dictionary_lifecycle import event

pytestmark = pytest.mark.django_db

@pytest.fixture
def api():
    api, user = client_for("review_editor", "REVIEW_EDITOR", ["dictionary.view", "dictionary_value.manage", "catalog.view"])
    user.first_name = "Автор"; user.last_name = "Изменений"; user.save()
    return api


def test_similarity_matches_case_spaces_kazakh_and_requires_explicit_confirmation(api):
    OpsDictionaryEntry.objects.create(dictionary_code="RETURN_REASONS", code="OLD", label="Возврат на проверку", label_kk="Қайта тексеру", is_active=True)
    url = "/api/ops/dictionaries/RETURN_REASONS/entries/"
    payload = {"code": "NEW", "label": "Новое название", "labelKk": "  ҚАЙТА   тексеру  "}
    response = api.post(url, payload, format="json")
    assert response.status_code == 409, response.content
    assert response.json()["error_code"] == "DICTIONARY_SIMILAR_ENTRIES"
    assert len(response.json()["details"]["similarEntries"]) == 1
    assert not OpsDictionaryEntry.objects.filter(code="NEW").exists()
    assert api.post(url, {**payload, "confirmSimilar": "true"}, format="json").status_code == 409
    response = api.post(url, {**payload, "confirmSimilar": True}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["lastChange"]["actor"] == "Автор Изменений"
    assert response.json()["lastChange"]["operation"] == "DICTIONARY_ENTRY_CREATED"


def test_fuzzy_staff_confirmation_and_immutable_code(api):
    Position.objects.create(name="Руководитель отдела", name_kk="Бөлім басшысы", code="LEAD", level=1)
    url = "/api/dictionaries/positions/"
    listed = api.get(url).json()
    assert listed["count"] >= 1 and isinstance(listed["results"], list)
    payload = {"name": "Руководитель отделa", "name_kk": "", "code": "LEAD2", "level": 1}
    assert api.post(url, payload, format="json").status_code == 409
    response = api.post(url, {**payload, "confirmSimilar": True}, format="json")
    assert response.status_code == 201, response.content
    pk = response.json()["id"]
    assert api.patch(f"{url}{pk}/", {"code": "CHANGED"}, format="json").status_code == 400
    assert api.post(f"{url}{pk}/set-active/", {"is_active": False}, format="json").status_code == 200
    assert api.patch(f"{url}{pk}/", {"name": "Changed"}, format="json").status_code == 409
    from organization_management.apps.core.api.serializers import PositionSerializer
    assert PositionSerializer(Position.objects.get(pk=pk)).data["is_active"] is False


def test_om_inactive_cannot_be_corrected_and_chain_has_all_generations(api):
    url = "/api/ops/dictionaries/"
    old = OpsDictionaryEntry.objects.create(dictionary_code="RETURN_REASONS", code="FIRST", label="First", is_active=True)
    second = api.post(f"{url}entries/{old.pk}/supersede/", {"code": "SECOND", "label": "Second"}, format="json")
    assert second.status_code == 201, second.content
    third = api.post(f"{url}entries/{second.json()['id']}/supersede/", {"code": "THIRD", "label": "Third"}, format="json")
    assert third.status_code == 201
    assert api.patch(f"{url}entries/{old.pk}/", {"label": "Wrong"}, format="json").status_code == 409
    rows = api.get(f"{url}RETURN_REASONS/entries/").json()["results"]
    assert all(set(row["replacementFamily"]["memberIds"]) == {str(old.pk), second.json()["id"], third.json()["id"]} for row in rows)
    assert next(row for row in rows if row["id"] == third.json()["id"])["lastChange"]["operation"] == "DICTIONARY_ENTRY_SUPERSEDED"


def test_geo_crud_uses_same_picker_data_and_preserves_event_history(api):
    countries = "/api/dictionaries/countries/"
    cities = "/api/dictionaries/cities/"
    response = api.post(countries, {"code": "ZZ", "name": "Тестовая страна", "name_kk": "Сынақ елі"}, format="json")
    assert response.status_code == 201, response.content
    country = response.json()["id"]
    assert str(country) in {row["id"] for row in api.get("/api/ops/countries/").json()["results"]}
    response = api.post(cities, {"name": "Тестоград", "country": country}, format="json")
    assert response.status_code == 201, response.content
    city = response.json()["id"]
    item = event(country_id=country, city_id=city, address="Адрес", location="Тестовая страна, Тестоград, Адрес")
    assert api.patch(f"{cities}{city}/", {"name": "Тестоград исправленная"}, format="json").status_code == 200
    item.refresh_from_db()
    assert "Тестоград исправленная" in item.location
    response = api.delete(f"{cities}{city}/")
    assert response.status_code == 200, response.content
    assert response.json()["result"] == "deactivated"
    item.refresh_from_db(); assert item.city_id == city
    assert api.get(f"/api/ops/countries/{country}/cities/").json()["results"] == []
    assert OpsCity.objects.get(pk=city).inactive_since is not None
    assert api.delete(f"{countries}{country}/").status_code == 200
    assert OpsCountry.objects.get(pk=country).is_active is False
    assert OpsAuditLog.objects.filter(entity_type="city", entity_id=city, action="DICTIONARY_ENTRY_SET_ACTIVE").exists()


def test_geo_successor_keeps_old_references_and_mutations_need_value_permission(api):
    country = OpsCountry.objects.create(code="ZZ", name="Тестовая страна")
    city = OpsCity.objects.create(country=country, name="Прежний город")
    item = event(country=country, city=city)
    response = api.post(f"/api/dictionaries/cities/{city.pk}/supersede/", {"name": "Новый город", "country": country.pk}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["supersedes"] == city.pk
    item.refresh_from_db(); assert item.city_id == city.pk
    reader, _ = client_for("geo_reader", "GEO_READER", ["dictionary.view", "dictionary.manage"])
    assert reader.get("/api/dictionaries/cities/").status_code == 200
    assert reader.post("/api/dictionaries/cities/", {"name": "Forbidden", "country": country.pk}, format="json").status_code == 403
    assert reader.delete(f"/api/dictionaries/cities/{city.pk}/").status_code == 403
    assert {"COUNTRIES", "CITIES", "POSITIONS", "RANKS", "STATUS_TYPES"} <= {row["code"] for row in api.get("/api/ops/dictionaries/").json()["results"]}
