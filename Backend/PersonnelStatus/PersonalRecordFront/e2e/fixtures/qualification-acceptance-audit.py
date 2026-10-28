"""Inspect the exact owned qualification database without issuing writes."""
import hashlib
import json
import os
import re
import django
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.db import connection, transaction
from organization_management.apps.employees.models import EmployeeServiceProfile
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
from organization_management.apps.operations import audit_service

fixture = json.loads(os.environ.get('FIXTURE_METADATA', '{}'))
marker = fixture.get('standMarker', '')
mode = os.environ.get('QUALIFICATION_ACCEPTANCE_AUDIT_PHASE', '')
if (os.environ.get('QUALIFICATION_ACCEPTANCE_READ') != '1' or mode not in ('before-withdrawal', 'final') or
        not re.fullmatch(r'qualification-browser-[a-f0-9]{10}', marker) or marker != os.environ.get('FIXTURE_STAND_MARKER') or
        fixture.get('database') != 'sj_qualification_acceptance_' + marker.replace('-', '_') or
        settings.DATABASES['default']['NAME'] != fixture['database'] or settings.DATABASES['default']['HOST'] != 'db'):
    raise RuntimeError('Audit only the exact explicitly identified owned qualification fixture.')
writes = json.loads(os.environ.get('QUALIFICATION_ACCEPTANCE_UI_WRITES', '[]'))
assert len(writes) == (6 if mode == 'final' else 5)
assert [row['method'] for row in writes] == ['PUT'] + ['POST'] * (len(writes) - 1)
assert all(row['role'] == 'editor' for row in writes)
actor = fixture['users']['editor']
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        cursor.execute('SHOW transaction_read_only')
        assert cursor.fetchone()[0] == 'on'
    assert User.objects.count() == 4
    assert not User.objects.filter(is_staff=True).exists() and not User.objects.filter(is_superuser=True).exists()
    for account in fixture['users'].values():
        assert User.objects.get(pk=account['id']).username == account['username']
    records = list(OpsEmployeeQualification.objects.order_by('created_at', 'id'))
    assert len(records) == 4
    for index, record in enumerate(records):
        body = writes[index + 1]['body']
        assert {key: body[key] for key in fixture['assessments'][index]} == fixture['assessments'][index]
        assert record.employee_id == fixture['people']['own']['id']
        assert record.recorded_by == str(actor['id']) and record.recorded_by_name == actor['username']
        assert record.request_key == body['request_key']
        assert record.request_hash == hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode('utf8')).hexdigest()
        for key in ('skill', 'score', 'basis'):
            assert getattr(record, key) == body[key]
        assert record.assessed_on.isoformat() == body['assessed_on']
        assert (record.valid_until.isoformat() if record.valid_until else None) == body['valid_until']
    assert len({row.request_key for row in records}) == 4
    chronological = list(OpsEmployeeQualification.objects.values_list('id', flat=True))
    assert chronological == [records[index].id for index in (3, 0, 2, 1)]
    profiles = list(EmployeeServiceProfile.objects.all())
    assert len(profiles) == 1
    profile = profiles[0]
    assert profile.employee_id == fixture['people']['own']['id'] and profile.revision == fixture['legacyRevision'] + 5
    expected = {**fixture['legacyProfile'], 'height_cm': 181,
        'skills': {'shooting': 4, 'hand_to_hand': 2, 'physical_fitness': 3}}
    assert profile.data == expected
    grants = list(UserRole.objects.order_by('id').values('id', 'user_id', 'role_code_id', 'scope_division_id', 'is_active'))
    assert len(grants) == 3 and all(row['scope_division_id'] is not None for row in grants)
    for key in ('editor', 'reader', 'foreign_editor'):
        account = fixture['users'][key]
        grant = next(row for row in grants if row['id'] == account['grantId'])
        assert grant == {'id': account['grantId'], 'user_id': str(account['id']), 'role_code_id': account['role'],
            'scope_division_id': account['scope'], 'is_active': key != 'editor' or mode == 'before-withdrawal'}
    events = list(OpsAuditLog.objects.filter(action=audit_service.EMPLOYEE_QUALIFICATION_RECORDED).order_by('id'))
    assert len(events) == 4
    for index, event in enumerate(events):
        assert event.actor_user_id == str(actor['id']) and event.entity_type == audit_service.ENTITY_EMPLOYEE
        assert event.entity_id == profile.employee_id
        assert event.old_value == {'revision': fixture['legacyRevision'] + 1 + index}
        assert event.new_value == {'qualification_id': str(records[index].id), 'skill': records[index].skill,
            'revision': fixture['legacyRevision'] + 2 + index}
    withdrawals = list(OpsAuditLog.objects.filter(action=audit_service.ACCESS_ROLE_REVOKED))
    assert len(withdrawals) == (1 if mode == 'final' else 0)
    if withdrawals:
        assert withdrawals[0].actor_user_id == 'qualification-fixture-transition'
print(json.dumps({'complete': True, 'readOnly': True, 'phase': mode, 'standMarker': marker,
    'database': fixture['database'], 'qualifications': 4, 'profileRevision': profile.revision,
    'requestKeysAndHashesMatch': True, 'allActorRowsMatch': True, 'chronologicalOrderMatches': True,
    'noForeignOrSelfProfilesOrQualifications': True, 'nonSkillProfileFieldsPreservedExceptExplicitHeight': True,
    'qualificationDomainAudits': 4, 'fixtureWithdrawals': len(withdrawals), 'ordinaryActors': 4,
    'globalGrants': 0, 'grants': grants,
    'records': [{'id': str(row.id), 'skill': row.skill, 'score': row.score, 'assessed_on': row.assessed_on.isoformat(),
        'valid_until': row.valid_until.isoformat() if row.valid_until else None, 'recorded_by': row.recorded_by,
        'request_key': row.request_key, 'request_hash': row.request_hash, 'created_at': row.created_at.isoformat()} for row in records]}, sort_keys=True))
