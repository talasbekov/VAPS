"""Право на значения справочников отделено от `dictionary.manage` (UC-REF-001, BR13).

Держатель только `dictionary.manage` видит справочники, но не меняет значения:
все четыре операции отбиваются сервером 403, включая прямые запросы.
"""
import pytest

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db

VALUE = "dictionary_value.manage"
# JOURNAL_ENTRY_TYPES — единственный справочник, где удаление доходит до 204:
# связи у него отслеживаются, и у свежей записи их ноль.
ENTRIES = "/api/ops/dictionaries/JOURNAL_ENTRY_TYPES/entries/"
POSITIONS = "/api/dictionaries/positions/"


def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


@pytest.fixture
def entry():
    return OpsDictionaryEntry.objects.create(
        dictionary_code="JOURNAL_ENTRY_TYPES", code="PROBE",
        label="Проба", description="", is_active=True,
    )


@pytest.fixture
def position():
    return Position.objects.create(name="Проба", code="PROBE_POS", level=50)


def _entry_mutations(api, entry):
    body = {"code": "NEW_ONE", "label": "Новое", "description": ""}
    return {
        "create": api.post(ENTRIES, body, format="json"),
        "patch": api.patch(
            entry_url(entry), {"label": "Иначе", "description": ""}, format="json"
        ),
        "set_active": api.post(
            entry_url(entry) + "set-active/", {"isActive": False}, format="json"
        ),
        "delete": api.delete(entry_url(entry)),
    }


def test_dictionary_manage_alone_is_refused_on_every_entry_mutation(entry):
    api, _ = client_for(
        "dict-manage-only", "DICT_MANAGE_ONLY",
        ["dictionary.view", "dictionary.manage"],
    )
    for name, response in _entry_mutations(api, entry).items():
        assert response.status_code == 403, (name, response.content)
    assert api.get(ENTRIES).status_code == 200


def test_value_permission_allows_every_entry_mutation(entry):
    api, _ = client_for(
        "dict-value-manager", "DICT_VALUE_MANAGER", ["dictionary.view", VALUE]
    )
    responses = _entry_mutations(api, entry)
    assert responses["create"].status_code == 201, responses["create"].content
    assert responses["patch"].status_code == 200, responses["patch"].content
    assert responses["set_active"].status_code == 200, responses["set_active"].content
    assert responses["delete"].status_code == 204, responses["delete"].content


def test_view_only_reads_entries_but_cannot_write(entry):
    api, _ = client_for("dict-viewer", "DICT_VIEWER", ["dictionary.view"])
    assert api.get(ENTRIES).status_code == 200
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code == 403, created.content


def test_signed_in_user_without_rights_is_refused(entry):
    api, _ = client_for("dict-nobody")
    assert api.get(ENTRIES).status_code == 403
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code == 403, created.content


def _staff_mutations(api, position):
    return {
        "create": api.post(
            POSITIONS, {"name": "Новая", "code": "NEW_POS", "level": 60},
            format="json",
        ),
        "patch": api.patch(
            f"{POSITIONS}{position.pk}/", {"name": "Иначе"}, format="json"
        ),
        "delete": api.delete(f"{POSITIONS}{position.pk}/"),
    }


def test_staff_dictionary_refuses_dictionary_manage_alone(position):
    api, _ = client_for(
        "staff-manage-only", "STAFF_MANAGE_ONLY",
        ["dictionary.view", "dictionary.manage"],
    )
    for name, response in _staff_mutations(api, position).items():
        assert response.status_code == 403, (name, response.content)
    assert api.get(POSITIONS).status_code == 200


def test_staff_dictionary_accepts_value_permission(position):
    api, _ = client_for(
        "staff-value-manager", "STAFF_VALUE_MANAGER", ["dictionary.view", VALUE]
    )
    responses = _staff_mutations(api, position)
    assert responses["create"].status_code == 201, responses["create"].content
    assert responses["patch"].status_code == 200, responses["patch"].content
    assert responses["delete"].status_code == 204, responses["delete"].content


def test_anonymous_is_refused_on_read_and_write(entry):
    from rest_framework.test import APIClient

    api = APIClient()
    assert api.get(ENTRIES).status_code in (401, 403)
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code in (401, 403), created.content
