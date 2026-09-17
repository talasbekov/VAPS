"""Plane #1278: catalog maintenance preserves identity and enforces rights."""
import pytest
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
URL = '/api/ops/protected-persons/'


def test_dictionary_manager_can_create_and_edit_person_without_changing_identity():
    api, _ = client_for('dictionary-editor', 'DICT_EDITOR', ['dictionary.manage', 'catalog.view'])
    created = api.post(URL, {'name': 'Учебное лицо', 'category': 'OURS'}, format='json')
    assert created.status_code == 201
    person = created.json()
    changed = api.patch(f"{URL}{person['id']}/", {'name': 'Учебное лицо изменено', 'country': 'Учебная страна'}, format='json')
    assert changed.status_code == 200
    assert changed.json()['code'] == person['code']
    assert changed.json()['category'] == 'OURS'
    assert changed.json()['name'] == 'Учебное лицо изменено'
    assert api.get(URL).json()['results'][0]['country'] == 'Учебная страна'


def test_person_edit_validates_fields_and_rejects_server_owned_values():
    api, _ = client_for('dictionary-validator', 'DICT_VALIDATOR', ['dictionary.manage'])
    person = OpsProtectedPerson.objects.create(name='До', category='OURS')
    url = f'{URL}{person.pk}/'
    for body in ({'name': ' '}, {'category': 'UNKNOWN'}, {'name': 'x' * 300}, {'code': 'OL-999'}, {'is_active': False}):
        response = api.patch(url, body, format='json')
        assert response.status_code == 400, response.content
        person.refresh_from_db()
        assert person.name == 'До'
        assert person.is_active


def test_catalog_reader_cannot_edit_person():
    api, _ = client_for('dictionary-reader', 'DICT_READER', ['catalog.view'])
    person = OpsProtectedPerson.objects.create(name='До', category='OURS')
    assert api.patch(f'{URL}{person.pk}/', {'name': 'После'}, format='json').status_code == 403
    person.refresh_from_db()
    assert person.name == 'До'


def test_person_edit_backfills_legacy_code():
    api, _ = client_for('dictionary-legacy', 'DICT_LEGACY', ['dictionary.manage'])
    OpsProtectedPerson.objects.bulk_create([OpsProtectedPerson(name='До', category='OURS')])
    person = OpsProtectedPerson.objects.get(name='До')
    assert not person.code
    response = api.patch(f'{URL}{person.pk}/', {'name': 'После'}, format='json')
    assert response.status_code == 200
    person.refresh_from_db()
    assert person.name == 'После'
    assert person.code == f'OL-{person.pk}'


def test_admin_person_is_discoverable_in_dictionaries():
    from django.contrib import admin
    from organization_management.admin_categories import MODEL_CATEGORY
    assert OpsProtectedPerson in admin.site._registry
    assert MODEL_CATEGORY['operations.OpsProtectedPerson'] == 'Справочники'


@pytest.mark.parametrize('body', [[{'name': 'Нельзя'}], ['name'], 'name'])
def test_person_edit_rejects_non_object_body(body):
    api, _ = client_for('dictionary-body', 'DICT_BODY', ['dictionary.manage'])
    person = OpsProtectedPerson.objects.create(name='До', category='OURS')
    response = api.patch(f'{URL}{person.pk}/', body, format='json')
    assert response.status_code == 400
    person.refresh_from_db()
    assert person.name == 'До'
