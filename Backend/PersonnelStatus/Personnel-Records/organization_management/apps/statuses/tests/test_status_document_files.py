"""Status document bytes retain the read scope of their parent status."""
from datetime import date

import pytest
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.reports.tests.integration.test_report_files import debug_media_urls
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus, StatusDocument

pytestmark = pytest.mark.django_db
BASE = '/api/statuses/statuses/'


def content_url(document, status_id=None):
    return f'{BASE}{status_id or document.status_id}/documents/{document.pk}/content/'


@pytest.fixture
def document_scene(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    own = Division.objects.create(name='Document own', division_type='department')
    other = Division.objects.create(name='Document other', division_type='department')
    rows = []
    for index, division in enumerate((own, other), 1):
        employee = Employee.objects.create(personnel_number=f'doc-{index}', first_name='Test', last_name='Document')
        StaffUnit.objects.create(index=index, division=division, employee=employee)
        row = employee.statuses.first() or EmployeeStatus.objects.create(
            employee=employee, status_type='in_service', state='active', start_date=date(2026, 1, 1),
        )
        document = StatusDocument.objects.create(status=row, title='Existing private document')
        # Historical files are deliberately kept in their original public-media storage.
        document.file.save(f'original-{index}.pdf', ContentFile(b'private status bytes'))
        rows.append(document)
    return own, other, rows


@pytest.mark.parametrize('scope', ['own', 'foreign', 'global', 'no_permission', 'write_only', 'anonymous'])
def test_document_download_enforces_parent_read_scope(document_scene, scope):
    own, other, documents = document_scene
    document = documents[0]
    client = APIClient()
    if scope != 'anonymous':
        permissions = () if scope == 'no_permission' else (('status.manage',) if scope == 'write_only' else ('status.view',))
        client, _ = client_for('doc-reader', 'DOC_READER', permissions,
                               scope_division_id=None if scope == 'global' else (other.pk if scope == 'foreign' else own.pk))
    response = client.get(content_url(document))
    if scope in ('own', 'global'):
        assert response.status_code == 200
        assert b''.join(response.streaming_content) == b'private status bytes'
        assert response['Content-Type'] == 'application/pdf'
        assert 'attachment' in response['Content-Disposition']
        assert document.file.name.split('/')[-1] in response['Content-Disposition']
        assert response['Cache-Control'] == 'private, no-store'
        assert response['X-Content-Type-Options'] == 'nosniff'
        document.refresh_from_db()
        assert document.file.storage.exists(document.file.name)
    elif scope == 'foreign':
        assert response.status_code == 404
    else:
        assert response.status_code in (401, 403)


def test_document_upload_and_detail_serialize_only_controlled_links(document_scene):
    own, _, documents = document_scene
    client, _ = client_for('doc-manager', 'DOC_MANAGER', ('status.manage', 'status.view'), scope_division_id=own.pk)
    row = documents[0].status
    response = client.post(f'{BASE}{row.pk}/upload_document/', {
        'title': 'New attachment', 'file': SimpleUploadedFile('new.pdf', b'new private bytes', content_type='application/pdf'),
    }, format='multipart')
    assert response.status_code == 201
    expected = f'{BASE}{row.pk}/documents/{response.data["id"]}/content/'
    assert response.data['file_url'] == expected
    assert response.data['file'] == expected
    detail = client.get(f'{BASE}{row.pk}/')
    assert detail.status_code == 200
    for document in detail.data['documents']:
        assert document['file'] == document['file_url'] == f'{BASE}{row.pk}/documents/{document["id"]}/content/'
    body = client.get(expected)
    assert body.status_code == 200
    assert b''.join(body.streaming_content) == b'new private bytes'


@pytest.mark.parametrize('prefix', ['status_documents/', './status_documents/', 'employees/../status_documents/', '%2e/status_documents/', 'ROOT_REENTRY'])
def test_old_status_media_urls_are_closed_for_every_user(document_scene, tmp_path, prefix):
    own, _, documents = document_scene
    client, _ = client_for('old-doc-reader', 'OLD_DOC_READER', ('status.view',), scope_division_id=own.pk)
    if prefix == 'ROOT_REENTRY':
        prefix = f'../{tmp_path.name}/status_documents/'
    suffix = documents[0].file.name.split('/', 1)[1]
    with debug_media_urls(tmp_path):
        for api in (APIClient(), client):
            assert api.get('/media/' + prefix + suffix).status_code == 404


def test_missing_file_and_wrong_parent_cannot_download(document_scene):
    own, _, documents = document_scene
    client, _ = client_for('doc-missing', 'DOC_MISSING', ('status.view',))
    assert client.get(content_url(documents[1], documents[0].status_id)).status_code == 404
    document = documents[0]
    document.file = 'status_documents/1999/01/missing.pdf'
    document.save(update_fields=['file'])
    assert client.get(content_url(document)).status_code == 404
    document.file = ''
    document.save(update_fields=['file'])
    assert client.get(content_url(document)).status_code == 404


@pytest.mark.parametrize('name', ['../outside.pdf', '/outside.pdf', 'status_documents/../../outside.pdf', 'employees/photos/photo.pdf', 'status_documents/../outside.pdf', 'status_documents\\..\\outside.pdf'])
def test_invalid_stored_paths_never_escape_document_directory(document_scene, tmp_path, name):
    (tmp_path / 'outside.pdf').write_bytes(b'must not leak')
    photo = tmp_path / 'employees' / 'photos' / 'photo.pdf'
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b'must not leak')
    client, _ = client_for('doc-path', 'DOC_PATH', ('status.view',))
    document = document_scene[2][0]
    document.file = name
    document.save(update_fields=['file'])
    assert client.get(content_url(document)).status_code == 404
