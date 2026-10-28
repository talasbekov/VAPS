"""Synthetic assistant catalogue and actors in an explicitly empty test DB."""
import json
import os
import re
import sys
import uuid
from urllib.parse import urlsplit
sys.path.insert(0, '/app')
import django
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.models_assistant import OpsAssistantTask, OpsAssistantMessage, OpsAssistantReceipt
from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.management.commands.seed_operations import PERMISSIONS
from organization_management.apps.ops.assistant.credentials import seal, FORMAT

stand_marker = os.environ.get('FIXTURE_STAND_MARKER', '')
if not re.fullmatch(r'assistant-acceptance-[a-f0-9]{10}', stand_marker):
    raise RuntimeError('Set FIXTURE_STAND_MARKER to this newly owned assistant-acceptance-<10hex> stand.')
expected_database = 'sj_assistant_acceptance_' + stand_marker.replace('-', '_')
if settings.DATABASES['default']['NAME'] != expected_database or settings.DATABASES['default']['HOST'] != 'db':
    raise RuntimeError('Assistant fixtures require the exact marker-bound sj_assistant_acceptance_ database on the isolated db host.')
if any(model.objects.exists() for model in (User, Employee, Division, StaffUnit, UserRole,
        OpsAssistantTask, OpsAssistantMessage, OpsAssistantReceipt, OpsAssistantConnection,
        OpsSecurityEvent, OpsSecurityEventVisitObject, OpsSecurityObject, OpsProtectedPerson)):
    raise RuntimeError('Assistant fixtures require an empty database without actors, structure, tasks or OM sources.')
try:
    origin = urlsplit(os.environ.get('FIXTURE_ORIGIN', ''))
    origin.port
except ValueError as error:
    raise RuntimeError('FIXTURE_ORIGIN must be the isolated loopback HTTP origin.') from error
if origin.scheme not in ('http', 'https') or origin.hostname not in ('127.0.0.1', 'localhost', '::1') or (
        origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment):
    raise RuntimeError('FIXTURE_ORIGIN must be the isolated loopback HTTP origin without credentials, query or path.')
password = os.environ.get('FIXTURE_PASSWORD', '')
model_key = os.environ.get('FIXTURE_MODEL_KEY', '')
if len(password) < 16 or len(model_key) < 32:
    raise RuntimeError('Assistant fixtures require separate generated login and model credentials.')
run_id = uuid.uuid4().hex
with transaction.atomic():
    users = {}
    for key, permissions in (
        ('owner', ('event.create', 'event.manage', 'event.view', 'event.bulletin', 'catalog.view')),
        ('observer', ('event.view', 'catalog.view')),
    ):
        user = User.objects.create_user(username='qa_assistant_' + run_id + '_' + key, password=password, email='')
        role = Role.objects.create(code='QA_ASSIST_' + run_id[:12].upper() + '_' + key.upper(), name='Учебный помощник ' + key)
        for code in permissions:
            permission, _ = Permission.objects.get_or_create(code=code, defaults={'name': dict(PERMISSIONS)[code]})
            if not permission.is_active:
                raise RuntimeError('Expected active fixture permission: ' + code)
            RolePermission.objects.create(role_code=role, permission_code=permission)
        RoleAdminService.assign_role(str(user.pk), role.code, None, actor='synthetic-assistant-seed')
        users[key] = {'id': user.pk, 'username': user.username, 'role': role.code, 'permissions': list(permissions)}
    target = OpsSecurityObject.objects.create(code='QA-ASSIST-' + run_id[:12], name='Аккорда',
        object_type='Госучреждение', region='Учебный регион', address='Учебный адрес',
        object_state=OpsSecurityObject.ObjectState.ACTIVE, passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED)
    employee = Employee.objects.create(personnel_number='QA' + run_id[:12], first_name='Улан', last_name='Мусахан',
        birth_date='1990-01-01', gender='M', iin='940000000000', hire_date='2015-01-01', employment_status='working')
    person = OpsProtectedPerson.objects.create(name='Учебное ОЛ 800', callsign='800', category='OURS')
    OpsAssistantConnection.objects.create(id=1, provider='openai', base_url='http://fixture.invalid/v1',
        model='synthetic-assistant-browser', api_key=seal(model_key), api_key_format=FORMAT,
        updated_by=str(users['owner']['id']))
    fixture = {'database': settings.DATABASES['default']['NAME'], 'origin': origin.geturl().rstrip('/'), 'standMarker': stand_marker,
        'runId': run_id, 'users': users, 'object': {'id': target.pk, 'name': target.name},
        'chief': {'id': employee.pk, 'answer': 'Улан Мусахан'}, 'protectedPerson': {'id': person.pk, 'answer': '800'},
        'title': 'Встреча', 'businessDate': '2027-06-01', 'superusers': User.objects.filter(is_superuser=True).count()}
print('FIXTURE_JSON=' + json.dumps(fixture, ensure_ascii=True))
