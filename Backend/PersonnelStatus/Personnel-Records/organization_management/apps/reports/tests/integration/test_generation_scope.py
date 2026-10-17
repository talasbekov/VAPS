"""Legacy report jobs retain their authorized scope through the worker queue."""
import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import UserRole
from organization_management.apps.reports.models import Report
from organization_management.apps.reports.tasks import generate_report_task
from organization_management.apps.reports.tests.integration.test_reports_access import grant_scope

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(monkeypatch, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    own = Division.objects.create(name='Report own', code='REPORT-OWN')
    foreign = Division.objects.create(name='Report foreign', code='REPORT-FOREIGN')
    user = get_user_model().objects.create_user(username='generation-scoped')
    grant_scope(user, own, role_code='GENERATION_SCOPE')
    client = APIClient()
    client.force_authenticate(user)
    queued = []
    monkeypatch.setattr(generate_report_task, 'delay', lambda report_id: queued.append(report_id))
    return client, user, own, foreign, queued


@pytest.mark.parametrize('has_grant', [True, False])
@pytest.mark.parametrize('selection', [{}, {'division': None}])
def test_missing_division_cannot_request_service_wide_report(setup, has_grant, selection):
    client, user, _, _, queued = setup
    if not has_grant:
        UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    response = client.post(reverse('report-generate'), selection, format='json')
    assert response.status_code == 403, response.data
    assert not Report.objects.exists()
    assert queued == []


@pytest.mark.parametrize('superuser', [False, True])
def test_global_reader_keeps_service_wide_generation(setup, superuser):
    client, user, _, _, queued = setup
    if superuser:
        user.is_superuser = True
        user.save()
    else:
        UserRole.objects.filter(user_id=str(user.pk)).update(scope_division_id=None)
    response = client.post(reverse('report-generate'), {'division': None}, format='json')
    assert response.status_code == 202, response.data
    assert queued == [Report.objects.get().pk]


def test_generated_job_owns_result_and_audit_metadata(setup):
    client, user, own, _, queued = setup
    other = get_user_model().objects.create_user(username='forged-report-author')
    response = client.post(reverse('report-generate'), {
        'division': own.pk, 'job_id': 'forged-job', 'status': 'completed',
        'file': SimpleUploadedFile('forged.pdf', b'forged contents'),
        'error_message': 'forged error', 'completed_at': '2026-10-08T12:00:00Z',
        'created_by': other.pk, 'created_at': '2000-01-01T00:00:00Z',
    }, format='multipart')
    assert response.status_code == 202, response.data
    report = Report.objects.get(pk=queued[0])
    assert report.job_id != 'forged-job'
    assert report.status == Report.JobStatus.PENDING
    assert not report.file
    assert report.error_message == ''
    assert report.completed_at is None
    assert report.created_by == user
    assert report.created_at.year != 2000


def worker_spy(monkeypatch):
    seen = []
    def collect(report):
        seen.append(report.division_id)
        return {}
    monkeypatch.setattr('organization_management.apps.reports.tasks.DataAggregator.collect_data', lambda self, report: collect(report))
    monkeypatch.setattr('organization_management.apps.reports.tasks.PDFGenerator.generate', lambda self, data, report: ('report.pdf', b'pdf'))
    monkeypatch.setattr('organization_management.apps.reports.tasks.send_report_ready_notification', lambda report: None)
    return seen


@pytest.mark.parametrize('change', ['grant_revoked', 'grant_moved', 'division_deleted', 'creator_deleted'])
def test_worker_rechecks_scope_before_collecting(setup, monkeypatch, change):
    client, user, own, foreign, queued = setup
    response = client.post(reverse('report-generate'), {'division': own.pk}, format='json')
    assert response.status_code == 202
    if change == 'grant_revoked':
        UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    elif change == 'grant_moved':
        UserRole.objects.filter(user_id=str(user.pk)).update(scope_division_id=foreign.pk)
    elif change == 'division_deleted':
        own.delete()
    else:
        user.delete()
    seen = worker_spy(monkeypatch)
    generate_report_task(queued[0])
    report = Report.objects.get(pk=queued[0])
    assert seen == []
    assert report.status == Report.JobStatus.FAILED
    assert not report.file


def test_deleted_selected_division_cannot_expand_even_global_author(setup, monkeypatch):
    client, user, own, _, queued = setup
    UserRole.objects.filter(user_id=str(user.pk)).update(scope_division_id=None)
    response = client.post(reverse('report-generate'), {
        'division': own.pk, 'filters': {'_generation_scope': {'division_id': None}},
    }, format='json')
    assert response.status_code == 202
    own.delete()
    seen = worker_spy(monkeypatch)
    generate_report_task(queued[0])
    report = Report.objects.get(pk=queued[0])
    assert seen == []
    assert report.status == Report.JobStatus.FAILED
    # Historical ownership still allows inspecting the failed job.
    assert client.get(reverse('report-detail', args=[report.pk])).status_code == 200


def test_worker_keeps_scoped_selected_generation_and_overwrites_scope_input(setup, monkeypatch):
    client, _, own, foreign, queued = setup
    response = client.post(reverse('report-generate'), {
        'division': own.pk,
        'filters': {'custom': 'retained', '_generation_scope': {'division_id': foreign.pk}},
    }, format='json')
    assert response.status_code == 202
    seen = worker_spy(monkeypatch)
    generate_report_task(queued[0])
    report = Report.objects.get(pk=queued[0])
    assert seen == [own.pk]
    assert report.status == Report.JobStatus.COMPLETED
    assert report.filters['custom'] == 'retained'
    assert report.filters['_generation_scope'] == {'division_id': own.pk}


@pytest.mark.parametrize('global_scope', [False, True])
def test_legacy_null_division_jobs_require_global_scope(setup, monkeypatch, global_scope):
    _, user, _, _, _ = setup
    if global_scope:
        UserRole.objects.filter(user_id=str(user.pk)).update(scope_division_id=None)
    report = Report.objects.create(created_by=user, job_id='legacy-null')
    seen = worker_spy(monkeypatch)
    generate_report_task(report.pk)
    report.refresh_from_db()
    assert seen == ([None] if global_scope else [])
    assert report.status == (Report.JobStatus.COMPLETED if global_scope else Report.JobStatus.FAILED)


@pytest.mark.parametrize('filters', [[], 'not-an-object', 1])
def test_malformed_filters_cannot_bypass_server_selection(setup, filters):
    client, _, own, _, queued = setup
    response = client.post(reverse('report-generate'), {'division': own.pk, 'filters': filters}, format='json')
    assert response.status_code == 400
    assert queued == []
    assert not Report.objects.exists()
