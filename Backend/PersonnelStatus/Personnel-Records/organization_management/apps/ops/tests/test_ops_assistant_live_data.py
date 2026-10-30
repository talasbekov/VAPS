from datetime import date, timedelta
import pytest
from organization_management.apps.core.tests.test_service_employees_api import people
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, URL
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object
from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject
from organization_management.apps.operations.models import UserRole, TemporaryDutyPermission
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops.assistant import provider

pytestmark = pytest.mark.django_db


def read(api, operation, **params):
    return api.post(URL, {'mode': 'answer', 'message': 'Прочитай доступные данные', 'conversationToken': None,
                         'readRequest': {'operation': operation, **params}}, format='json')


def event(code, owner='', chief=None):
    return OpsSecurityEvent.objects.create(code=code, title=code, object_name='Проверочный объект', business_date=date(2026,10,30),
        stage='RECON', readiness_percent=0, force_need=0, conflicts_count=0, owner_name='tests', owner_actor_id=owner, chief_employee_id=chief,
        recon_checklist=[], recon_sector_posts=[], demand_rows=[], demand_approved=False, approval_status='PENDING', force_requests=[], placement_assignments=[], journal_entries=[], closure_direction_summaries=[])


def test_statuses_and_summary_only_include_authorized_staff_and_no_private_fields(people, monkeypatch):
    root, child, foreign, rows = people
    api, user = jwt_actor('live-status', ('status.view', 'status.workspace'), root.pk)
    for employee in rows[:3]:
        EmployeeStatus.objects.create(employee=employee, status_type='vacation', state=EmployeeStatus.StatusState.ACTIVE, start_date=date(2026,10,1), end_date=date(2026,10,31))
    monkeypatch.setattr(provider, 'answer_from_context', lambda *a: pytest.fail('records reached LLM'))
    response = read(api, 'statuses', date='2026-10-30')
    assert response.status_code == 200, response.content
    data = response.json()
    assert data['mode'] == 'data' and data['readOnly']['count'] == 2
    assert {r['employeeId'] for r in data['readOnly']['rows']} == {rows[0].pk, rows[1].pk}
    assert all('documents' not in r and 'reason' not in r and 'iin' not in r for r in data['readOnly']['rows'])
    summary = read(api, 'status_summary', date='2026-10-30').json()['readOnly']
    assert summary['count'] == 2 and sum(r['count'] for r in summary['rows']) == 2
    assert read(api, 'statuses', employeeId=rows[2].pk).status_code == 404
    assert read(api, 'statuses', employeeId=2147483647).status_code == 404
    assert read(api, 'statuses', divisionId=foreign.pk).status_code == 404


def test_statuses_preserve_unknown_and_effective_actual_end(people):
    root, child, foreign, rows = people
    api, _ = jwt_actor('live-status-dates', ('status.view', 'status.workspace'), root.pk)
    EmployeeStatus.objects.create(employee=rows[0], status_type='vacation', state=EmployeeStatus.StatusState.COMPLETED,
        start_date=date(2026,10,1), end_date=date(2026,10,31), actual_end_date=date(2026,10,15))
    before = read(api, 'statuses', date='2026-10-10').json()['readOnly']['rows']
    after = read(api, 'statuses', date='2026-10-30').json()['readOnly']['rows']
    assert next(r for r in before if r['employeeId'] == rows[0].pk)['statusCode'] == 'vacation'
    assert all(r['statusCode'] is None for r in after)


def test_event_scope_owner_chief_and_detail_are_filtered_before_count(people):
    root, child, foreign, rows = people
    api, actor = jwt_actor('live-events', ('event.view',), root.pk)
    _, other = jwt_actor('live-events-owner', ('event.view',), foreign.pk)
    rows[2].user = other; rows[2].save(update_fields=['user'])
    own = event('LIVE-OWN', str(actor.pk))
    chief = event('LIVE-CHIEF', chief=rows[1].pk)
    hidden = event('LIVE-HIDDEN', str(other.pk), rows[2].pk)
    unknown = event('LIVE-UNKNOWN')
    result = read(api, 'events').json()['readOnly']
    assert result['count'] == 2 and {r['id'] for r in result['rows']} == {own.pk, chief.pk}
    assert read(api, 'event_detail', eventId=hidden.pk).status_code == 404
    assert read(api, 'event_detail', eventId=2147483647).status_code == 404
    assert read(api, 'events', search='HIDDEN').json()['readOnly']['count'] == 0
    assert read(api, 'event_detail', eventId=own.pk).json()['readOnly']['rows'][0]['code'] == own.code


def test_visit_chief_does_not_expose_other_visits_or_coordinates(people):
    root, child, foreign, rows = people
    api, _ = jwt_actor('live-visits', ('event.view',), root.pk)
    parent = event('LIVE-VISITS')
    own = OpsSecurityEventVisitObject.objects.create(event=parent, security_object=make_object('LV1'), position=0, object_name='Свой объект', chief_employee_id=rows[0].pk)
    hidden = OpsSecurityEventVisitObject.objects.create(event=parent, security_object=make_object('LV2'), position=1, object_name='Чужой объект', chief_employee_id=rows[2].pk)
    data = read(api, 'event_objects', eventId=parent.pk).json()['readOnly']
    assert data['count'] == 1 and data['rows'][0]['id'] == own.pk
    assert 'Чужой объект' not in str(data) and 'coordinates' not in str(data)


def test_temporary_single_event_grant_is_not_global_read(people):
    root, child, foreign, rows = people
    api, actor = jwt_actor('live-bound', ('profile.view',))
    _, holder = jwt_actor('live-bound-role', ('event.view', 'status.view', 'status.workspace'))
    target, hidden = event('LIVE-TEMP'), event('LIVE-TEMP-HIDDEN')
    now = Clock.now()
    TemporaryDutyPermission.objects.create(user_id=str(actor.pk), duty_role_code=UserRole.objects.get(user_id=str(holder.pk)).role_code_id,
        event_id=target.pk, starts_at=now-timedelta(hours=1), ends_at=now+timedelta(hours=1), created_by='tests')
    data = read(api, 'events').json()['readOnly']
    assert data['count'] == 1 and data['rows'][0]['id'] == target.pk
    assert read(api, 'event_detail', eventId=hidden.pk).status_code == 404
    assert read(api, 'statuses').status_code == 403


@pytest.mark.parametrize('params', [{'role':'ADMIN'}, {'scope':'all'}, {'page':0}, {'page':1001}, {'employeeId':True}, {'date':'2026-02-30'}, {'operation':'sql'}, {'search':'x'*101}])
def test_read_spec_is_strict_and_cannot_set_authority(params):
    api, _ = jwt_actor('live-invalid', ('*',))
    body = {'operation':'statuses', **params}
    response = api.post(URL, {'mode':'answer','message':'read','conversationToken':None,'readRequest':body}, format='json')
    assert response.status_code == 400


def test_natural_followup_uses_signed_filters_without_storing_records(people):
    from organization_management.apps.ops.assistant.conversation import read_context, load
    from organization_management.apps.ops.assistant.answers import authority
    root, child, foreign, rows = people
    api, actor = jwt_actor('live-paging', ('event.view',), root.pk)
    for i in range(12):event(f'PAGE-{i}',str(actor.pk))
    first=read(api,'events').json()
    second=api.post(URL,{'mode':'answer','message':'Следующая страница','conversationToken':first['conversationToken']},format='json')
    assert second.status_code==200,second.content
    assert second.json()['readOnly']['page']==2 and len(second.json()['readOnly']['rows'])==2
    assert not {r['id'] for r in first['readOnly']['rows']} & {r['id'] for r in second.json()['readOnly']['rows']}


def test_inflight_grant_revoke_discards_read_data(people,monkeypatch):
    from organization_management.apps.ops.assistant import live_data
    root, child, foreign, rows=people
    api,actor=jwt_actor('live-revoke',('status.view','status.workspace'),root.pk)
    original=live_data.execute
    def execute(*args):
        result=original(*args)
        UserRole.objects.filter(user_id=str(actor.pk)).update(is_active=False)
        return result
    monkeypatch.setattr(live_data,'execute',execute)
    assert read(api,'statuses').status_code==409


def test_absence_filter_uses_catalog_in_service_aliases(people):
    from organization_management.apps.operations.models import StatusType
    root, child, foreign, rows=people
    StatusType.objects.create(code='ON_SITE_TEST',legacy_code='on_site_test',name='На месте',priority=999,report_column_code='IN_SERVICE')
    EmployeeStatus.objects.create(employee=rows[0],status_type='on_site_test',state=EmployeeStatus.StatusState.ACTIVE,start_date=date(2026,10,1),end_date=date(2026,10,31))
    api,_=jwt_actor('live-absence',('status.view','status.workspace'),root.pk)
    assert read(api,'statuses',date='2026-10-30',absentOnly=True).json()['readOnly']['count']==0


def test_canonical_status_winner_prefers_active_and_priority_over_later_completed_or_plan(people):
    root,child,foreign,rows=people
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(employee=rows[0],status_type='vacation',state='active',start_date=date(2026,10,1),end_date=date(2026,10,31)),
        EmployeeStatus(employee=rows[0],status_type='business_trip',state='completed',start_date=date(2026,10,10),end_date=date(2026,10,31),actual_end_date=date(2026,10,30)),
        EmployeeStatus(employee=rows[0],status_type='training',state='planned',start_date=date(2026,10,25),end_date=date(2026,10,31)),
    ])
    api,_=jwt_actor('live-priority',('status.view','status.workspace'),root.pk)
    result=read(api,'statuses',date='2026-10-30').json()['readOnly']
    assert next(r for r in result['rows'] if r['employeeId']==rows[0].pk)['statusCode']=='vacation'
    assert read(api,'statuses',date='2026-10-30',absentOnly=True).json()['readOnly']['count']==1


@pytest.mark.parametrize('spec',[{'operation':[]},{'operation':{}},{'operation':'events','stage':{}},{'operation':'events','search':'\x00'}])
def test_malformed_spec_returns_validation_instead_of_500(spec):
    api,_=jwt_actor('live-shape',('*',))
    response=api.post(URL,{'mode':'answer','message':'read','conversationToken':None,'readRequest':spec},format='json')
    assert response.status_code==400


def test_daily_submission_source_does_not_link_status_only_reader_to_forbidden_forces_ui():
    api,_=jwt_actor('live-daily-link',('status.view',))
    data=read(api,'daily_submissions').json()
    assert all(s['href']!='/employees?view=daily' for s in data['sources'])


def test_legacy_directory_also_rechecks_topology_before_issuing_response(people,monkeypatch):
    from organization_management.apps.ops.assistant import reads
    root,child,foreign,rows=people
    api,_=jwt_actor('live-old-tree',('personnel.view',),root.pk)
    original=reads.execute_read
    def execute(*args):
        result=original(*args)
        child.parent=foreign;child.save(update_fields=['parent'])
        return result
    monkeypatch.setattr(reads,'execute_read',execute)
    response=api.post(URL,{'mode':'answer','message':'Покажи доступных сотрудников','conversationToken':None},format='json')
    assert response.status_code==409


def test_global_event_reader_sees_existing_legacy_events_and_detail():
    first,second=event('GLOBAL-ONE'),event('GLOBAL-TWO')
    api,_=jwt_actor('live-global-events',('event.view',))
    result=read(api,'events').json()['readOnly']
    assert result['count']==2
    assert {row['id'] for row in result['rows']}=={first.pk,second.pk}
    assert read(api,'event_detail',eventId=first.pk).status_code==200
