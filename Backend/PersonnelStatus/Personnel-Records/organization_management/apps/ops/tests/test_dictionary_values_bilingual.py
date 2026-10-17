"""Двуязычные значения справочников: `labelKk` у ОМ, `name_kk` у кадровых (UC-REF-001)."""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db

ENTRIES = "/api/ops/dictionaries/RETURN_REASONS/entries/"


def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


@pytest.fixture
def api():
    client, _ = client_for(
        "kk-editor", "KK_EDITOR", ["dictionary.view", "dictionary_value.manage"]
    )
    return client


def test_models_store_kazakh_names():
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="KK", label="Погода",
        label_kk="Ауа райы", is_active=True,
    )
    position = Position.objects.create(
        name="Инспектор", name_kk="Тексеруші", code="KK_POS", level=40
    )
    rank = Rank.objects.create(name="Лейтенант", name_kk="Лейтенант", code="KK_LT", level=10)

    assert OpsDictionaryEntry.objects.get(pk=entry.pk).label_kk == "Ауа райы"
    assert Position.objects.get(pk=position.pk).name_kk == "Тексеруші"
    assert Rank.objects.get(pk=rank.pk).name_kk == "Лейтенант"


def test_kazakh_name_defaults_to_empty_string():
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="EMPTY", label="Пусто", is_active=True,
    )
    assert entry.label_kk == ""


def test_create_returns_and_stores_label_kk(api):
    response = api.post(
        ENTRIES,
        {"code": "weather", "label": "Погода", "labelKk": " Ауа райы ", "description": ""},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == "Ауа райы"
    assert OpsDictionaryEntry.objects.get(code="WEATHER").label_kk == "Ауа райы"


def test_create_without_label_kk_yields_empty_string(api):
    response = api.post(
        ENTRIES, {"code": "fog", "label": "Туман", "description": ""}, format="json"
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == ""


def test_patch_updates_label_kk(api):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="ICE", label="Гололёд", is_active=True,
    )
    response = api.patch(
        entry_url(entry),
        {"label": "Гололёд", "description": "", "labelKk": "Көктайғақ"},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["labelKk"] == "Көктайғақ"
    entry.refresh_from_db()
    assert (entry.label, entry.label_kk) == ("Гололёд", "Көктайғақ")


def test_patch_without_label_kk_key_leaves_it_untouched(api):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="WIND", label="Ветер",
        label_kk="Жел", is_active=True,
    )
    response = api.patch(
        entry_url(entry), {"label": "Сильный ветер", "description": ""}, format="json"
    )
    assert response.status_code == 200, response.content
    entry.refresh_from_db()
    assert (entry.label, entry.label_kk) == ("Сильный ветер", "Жел")


def test_update_audit_carries_old_and_new_label_kk(api, monkeypatch):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="RAIN", label="Дождь",
        label_kk="Жаңбыр", is_active=True,
    )
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))

    response = api.patch(
        entry_url(entry),
        {"label": "Дождь", "description": "", "labelKk": "Нөсер"},
        format="json",
    )

    assert response.status_code == 200, response.content
    event = next(
        item for item in recorded
        if item["action"] == audit_service.DICTIONARY_ENTRY_UPDATED
    )
    assert event["old_value"]["labelKk"] == "Жаңбыр"
    assert event["new_value"]["labelKk"] == "Нөсер"


def test_position_round_trips_name_kk(api):
    created = api.post(
        "/api/dictionaries/positions/",
        {"name": "Инспектор", "name_kk": "Тексеруші", "code": "INSPECTOR", "level": 40},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["name_kk"] == "Тексеруші"
    pk = created.json()["id"]

    patched = api.patch(
        f"/api/dictionaries/positions/{pk}/", {"name_kk": "Бақылаушы"}, format="json"
    )
    assert patched.status_code == 200, patched.content
    assert Position.objects.get(pk=pk).name_kk == "Бақылаушы"


def test_rank_round_trips_name_kk(api):
    created = api.post(
        "/api/dictionaries/ranks/",
        {"name": "Лейтенант", "name_kk": "Лейтенант", "code": "LT", "level": 10},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["name_kk"] == "Лейтенант"
    assert Rank.objects.get(code="LT").name_kk == "Лейтенант"


def test_supported_languages_are_ru_and_kk(settings):
    assert settings.LANGUAGE_CODE == "ru"
    assert [code for code, _ in settings.LANGUAGES] == ["ru", "kk"]


def test_label_kk_null_is_stored_as_empty_string(api):
    response = api.post(
        ENTRIES, {"code": "NULLKK", "label": "Ноль", "labelKk": None, "description": ""},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == ""


def test_label_kk_longer_than_column_is_a_form_error(api):
    response = api.post(
        ENTRIES,
        {"code": "LONGKK", "label": "Длинно", "labelKk": "ә" * 300, "description": ""},
        format="json",
    )
    assert response.status_code == 400, response.content
    assert response.json()["details"]["labelKk"] == ["Не более 255 символов."]
    assert not OpsDictionaryEntry.objects.filter(code="LONGKK").exists()
