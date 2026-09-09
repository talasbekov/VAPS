"""№1043: directory boundaries, filtering before pagination and safe detail."""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.ops.tests.test_ops_personnel_rating import rating_policy, rated

pytestmark = pytest.mark.django_db
URL = '/api/core/service-employees/'


@pytest.fixture
def people():
    StatusType.objects.get_or_create(code='IN_SERVICE', defaults={
        'name': 'В строю', 'priority': 999, 'report_column_code': 'IN_SERVICE',
    })
    root = Division.objects.create(name='Свой департамент')
    child = Division.objects.create(name='Своё управление', parent=root)
    foreign = Division.objects.create(name='Чужой департамент')
    position = Position.objects.create(name='Инспектор', code='S1043', level=1)
    rows = []
    for i, division in enumerate([root, child, foreign, None]):
        emp = Employee.objects.create(
            personnel_number=f'10430{i}', last_name=f'Аманов{i}',
            first_name='Асан', callsign=f'Сокол{i}', iin=f'10000000000{i}',
            personal_phone='PRIVATE', notes='PRIVATE',
            work_phone='101', work_email='service@example.test',
        )
        if division:
            StaffUnit.objects.create(division=division, position=position, employee=emp, index=i)
        rows.append(emp)
    return root, child, foreign, rows


def test_anonymous_and_no_permission_cannot_list(people):
    assert APIClient().get(URL).status_code in (401, 403)
    api, _ = client_for('s1043-no-right')
    assert api.get(URL).status_code == 403


def test_scope_filters_rows_count_and_options(people):
    root, child, foreign, rows = people
    api, _ = client_for('s1043-scoped', 'S1043-R', ['personnel.view'], root.pk)
    response = api.get(URL, {'page_size': 1})
    assert response.status_code == 200
    assert response.data['count'] == 2
    assert len(response.data['results']) == 1
    assert response.data['results'][0]['id'] == rows[0].pk
    assert api.get(URL, {'division_id': foreign.pk}).data['count'] == 0
    assert api.get(f'{URL}{rows[2].pk}/').status_code == 404
    assert api.get(f'{URL}{rows[3].pk}/').status_code == 404
    options = api.get(f'{URL}options/').json()
    assert {d['id'] for d in options['divisions']} == {root.pk, child.pk}


@pytest.mark.parametrize('search', ['Аманов1 Асан', '104301', 'Сокол1'])
def test_search_and_subtree_before_pagination(people, search):
    root, _, _, rows = people
    api, _ = client_for('s1043-search', 'S1043-S', ['personnel.view'], root.pk)
    response = api.get(URL, {'search': search, 'division_id': root.pk, 'page_size': 1})
    assert response.status_code == 200
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == rows[1].pk


def test_self_reads_only_own_safe_card(people):
    _, _, _, rows = people
    api, user = client_for('s1043-self')
    rows[0].user = user
    rows[0].save(update_fields=['user'])
    assert api.get(URL).status_code == 200
    assert [r['id'] for r in api.get(URL).data['results']] == [rows[0].pk]
    response = api.get(f'{URL}{rows[0].pk}/')
    assert response.status_code == 200
    assert response.data['id'] == rows[0].pk
    assert response.data['current_status']['name'] == 'В строю'
    assert response.data['rating'] is None
    assert response.data['evaluations_count'] == 0
    assert response.data['work_phone'] == '101'
    assert response.data['work_email'] == 'service@example.test'
    assert not {'iin', 'notes', 'personal_phone', 'personal_email', 'birth_date'} & set(response.data)
    assert api.get(f'{URL}{rows[1].pk}/').status_code == 404
    rows[0].is_active = False
    rows[0].save(update_fields=['is_active'])
    assert api.get(f'{URL}{rows[0].pk}/').status_code == 404


def test_current_status_uses_live_interval_and_filter(people):
    _, _, _, rows = people
    today = Clock.today_local()
    StatusType.objects.create(code='S1043-VAC', name='Отпуск', priority=1, report_column_code='VACATION')
    OpsEmployeeStatus.objects.create(
        employee_id=rows[1].pk, status_type_code='S1043-VAC',
        date_start=today, date_end=today + timedelta(days=2),
    )
    api, _ = client_for('s1043-status', 'S1043-A', ['personnel.view'])
    response = api.get(URL, {'status': 'S1043-VAC', 'page_size': 1})
    assert response.status_code == 200
    assert response.data['count'] == 1
    assert response.data['results'][0]['current_status'] == {
        'code': 'S1043-VAC', 'name': 'Отпуск', 'date_end': (today + timedelta(days=2)).isoformat(),
    }


@pytest.mark.parametrize('params', [
    {'division_id': 'bad'}, {'page_size': '0'}, {'page_size': '101'},
    {'page': '-1'}, {'rating_min': 'NaN'}, {'rating_max': '11'},
    {'rating_min': '8', 'rating_max': '2'}, {'participation': 'bad'}, {'status': 'UNKNOWN'},
])
def test_bad_filters_are_400(people, params):
    api, _ = client_for('s1043-validation', 'S1043-V', ['personnel.view'])
    assert api.get(URL, params).status_code == 400


def event_for(employee, code, stage='CONDUCT', days=0):
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    return OpsSecurityEvent.objects.create(
        code=code, title=code, object_name='Объект', passport_binding=None,
        business_date=Clock.today_local() + timedelta(days=days), stage=stage,
        readiness_percent=0, force_need=1, conflicts_count=0, owner_name='', approval_status='PENDING',
        recon_checklist=[], recon_sector_posts=[{'id': 'p1', 'post': 'Пост 1', 'task': 'Проверять пропуска'}],
        demand_rows=[], demand_approved=False, force_requests=[],
        placement_assignments=[{'id': 'a1', 'employeeId': str(employee.pk), 'postId': 'p1'}],
        journal_entries=[], closure_direction_summaries=[], closed_at=None,
    )


def test_rating_filter_uses_same_aggregate_and_excludes_superseded(people, rating_policy):
    from organization_management.apps.operations.models_rating import OpsEventEvaluation
    from organization_management.apps.ops.ratings import aggregate_rating_by_personnel
    _, _, _, rows = people
    rated(rows[0], 4)
    rated(rows[1], 9)
    api, _ = client_for('s1043-ratings', 'S1043-RATING', ['personnel.view'])
    response = api.get(URL, {'rating_min': '8', 'page_size': 1})
    assert response.status_code == 200
    assert response.data['count'] == 1
    row = response.data['results'][0]
    assert row['id'] == rows[1].pk
    assert row['rating'] == 9
    assert row['rating'] == aggregate_rating_by_personnel()[str(rows[1].pk)]
    assert row['evaluations_count'] == 1
    assert row['rated_events_count'] == 1
    OpsEventEvaluation.objects.filter(participant_code=f'employee-{rows[1].pk}').update(superseded_by_code='replaced')
    assert api.get(URL, {'rating_min': '8'}).data['count'] == 0
    OpsEventEvaluation.objects.filter(participant_code=f'employee-{rows[1].pk}').update(
        superseded_by_code=None, withdrawn_at='2026-09-09T00:00:00Z',
    )
    assert api.get(URL, {'rating_min': '8'}).data['count'] == 0


def test_participation_count_and_nearest_ignore_closed_declined_and_past(people):
    _, _, _, rows = people
    event_for(rows[1], 'S1043-CLOSED', 'CLOSED')
    event_for(rows[1], 'S1043-PAST', days=-2)
    event_for(rows[1], 'S1043-FUTURE', days=3)
    nearest = event_for(rows[1], 'S1043-NEXT', days=1)
    nearest.chief_employee_id = rows[0].pk
    nearest.chief_name = 'Старший объекта'
    nearest.save(update_fields=['chief_employee_id', 'chief_name'])
    denied = event_for(rows[0], 'S1043-DECLINED')
    denied.placement_assignments[0]['declinedAt'] = '2026-09-09T00:00:00Z'
    denied.save(update_fields=['placement_assignments'])
    api, _ = client_for('s1043-active', 'S1043-ACTIVE', ['personnel.view'])
    response = api.get(URL, {'participation': 'active', 'page_size': 1})
    assert response.status_code == 200
    assert response.data['count'] == 1
    row = response.data['results'][0]
    assert row['id'] == rows[1].pk
    assert row['active_assignments_count'] == 2
    assert row['next_assignment']['event_code'] == 'S1043-NEXT'
    assert row['next_assignment']['chief_name'] == 'Старший объекта'
    assert row['next_assignment']['chief_callsign'] == rows[0].callsign
    assert row['next_assignment']['chief_work_phone'] == '101'
    assert api.get(URL, {'participation': 'none'}).data['count'] == 3
    detail = api.get(f'{URL}{rows[1].pk}/').data
    assert len(detail['assignments']) == 2
    assert detail['assignments'][0]['task'] == 'Проверять пропуска'


def test_closed_history_exposes_current_source_evaluation_only_in_scope(people, rating_policy):
    from organization_management.apps.operations.models_rating import OpsEvaluationEvent, OpsEventEvaluation
    root, _, _, rows = people
    event = event_for(rows[1], 'S1043-HISTORY', 'CLOSED')
    rated(rows[1], 8)
    OpsEvaluationEvent.objects.filter(event_code=f'ev-{rows[1].pk}').update(security_event_id=event.pk)
    api, user = client_for('s1043-history', 'S1043-HISTORY', ['personnel.view'], root.pk)
    OpsEventEvaluation.objects.filter(participant_code=f'employee-{rows[1].pk}').update(
        comment='Выполнено в срок', evaluator_user_id=str(user.pk),
    )
    response = api.get(f'{URL}{rows[1].pk}/')
    assert response.status_code == 200
    assert len(response.data['history']) == 1
    assert response.data['assignments'] == []
    assert response.data['evaluations'][0]['score'] == 8
    assert response.data['evaluations'][0]['comment'] == 'Выполнено в срок'
    assert response.data['evaluations'][0]['author'] == 's1043-history'
    assert api.get(f'{URL}{rows[2].pk}/').status_code == 404


def test_queries_do_not_grow_per_employee(people):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    _, _, _, rows = people
    for i, employee in enumerate(rows):
        event_for(employee, f'S1043-Q{i}')
    api, _ = client_for('s1043-query', 'S1043-QUERY', ['personnel.view'])
    with CaptureQueriesContext(connection) as one:
        assert api.get(URL, {'page_size': 1}).status_code == 200
    with CaptureQueriesContext(connection) as many:
        assert api.get(URL, {'page_size': 4}).status_code == 200
    assert len(many) <= len(one)
