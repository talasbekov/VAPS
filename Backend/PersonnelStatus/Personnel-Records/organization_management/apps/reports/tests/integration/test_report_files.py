"""Stored report bytes have the same authorization as their metadata."""
from contextlib import contextmanager
from importlib import reload
from urllib.parse import urlsplit

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import override_settings
from django.urls import clear_url_caches, reverse
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import UserRole
from organization_management.apps.reports.models import Report
from organization_management.apps.reports.tests.integration.test_reports_access import grant_scope

pytestmark = pytest.mark.django_db


@contextmanager
def debug_media_urls(media_root):
    from organization_management.config import urls
    try:
        with override_settings(DEBUG=True, MEDIA_ROOT=media_root):
            reload(urls)
            clear_url_caches()
            yield
    finally:
        reload(urls)
        clear_url_caches()


@pytest.fixture
def stored_report(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    owner = get_user_model().objects.create_user(username='report-file-owner')
    stranger = get_user_model().objects.create_user(username='report-file-stranger')
    division = Division.objects.create(name='Report file scope', code='REPORT-FILE')
    report = Report.objects.create(created_by=owner, division=division,
                                   status=Report.JobStatus.COMPLETED, job_id='file-scope')
    report.file.save('report_known_id.pdf', ContentFile(b'private report bytes'))
    return owner, stranger, report


def authenticated(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.parametrize('prefix', ['/media/reports/', '/media/./reports/', '/media/employees/../reports/', '/media/%2e/reports/', 'ROOT_REENTRY'])
def test_known_media_path_never_bypasses_scoped_api(stored_report, tmp_path, prefix):
    owner, stranger, report = stored_report
    if prefix == 'ROOT_REENTRY':
        prefix = f'/media/../{tmp_path.name}/reports/'
    outsiders = [APIClient(), authenticated(stranger)]
    with debug_media_urls(tmp_path):
        for api in outsiders:
            assert api.get(reverse('report-download', args=[report.pk])).status_code in (401, 403, 404)
            response = api.get(prefix + report.file.name.split('/')[-1])
            assert response.status_code == 404


def test_download_and_serialized_file_use_authenticated_content(stored_report):
    owner, stranger, report = stored_report
    api = authenticated(owner)
    response = api.get(reverse('report-download', args=[report.pk]))
    assert response.status_code == 200
    url = response.data['download_url']
    assert urlsplit(url).path == f'/api/reports/reports/{report.pk}/content/'
    detail = api.get(reverse('report-detail', args=[report.pk]))
    assert urlsplit(detail.data['file']).path == urlsplit(url).path
    body = api.get(url)
    assert body.status_code == 200
    assert b''.join(body.streaming_content) == b'private report bytes'
    assert 'attachment' in body['Content-Disposition']
    assert 'no-store' in body['Cache-Control']
    assert authenticated(stranger).get(url).status_code == 404
    assert APIClient().get(url).status_code in (401, 403)
    # Same historical ownership contract; no newly required grant for creator.
    scoped = get_user_model().objects.create_user(username='report-file-scoped-reader')
    grant_scope(scoped, report.division, role_code='REPORT_FILE_READER')
    scoped_body = authenticated(scoped).get(url)
    assert scoped_body.status_code == 200
    assert b''.join(scoped_body.streaming_content) == b'private report bytes'
    UserRole.objects.filter(user_id=str(scoped.pk)).update(is_active=False)
    assert authenticated(scoped).get(url).status_code == 404


def test_missing_artifact_is_404_not_server_error(stored_report):
    owner, _, report = stored_report
    ready = authenticated(owner).get(f'/api/reports/reports/{report.pk}/content/')
    assert ready.status_code == 200
    assert b''.join(ready.streaming_content) == b'private report bytes'
    report.file.storage.delete(report.file.name)
    response = authenticated(owner).get(f'/api/reports/reports/{report.pk}/content/')
    assert response.status_code == 404


def test_report_without_artifact_keeps_null_file_and_not_ready_response(stored_report):
    owner, _, report = stored_report
    report.file = None
    report.save()
    api = authenticated(owner)
    assert api.get(reverse('report-detail', args=[report.pk])).data['file'] is None
    assert api.get(reverse('report-download', args=[report.pk])).status_code == 404
    assert api.get(f'/api/reports/reports/{report.pk}/content/').status_code == 404


def test_report_media_guard_does_not_block_employee_photos(tmp_path):
    photo = tmp_path / 'employees' / 'photos' / 'public-example.jpg'
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b'employee photo fixture')
    with debug_media_urls(tmp_path):
        response = APIClient().get('/media/employees/photos/public-example.jpg')
        assert response.status_code == 200
        assert b''.join(response.streaming_content) == b'employee photo fixture'
