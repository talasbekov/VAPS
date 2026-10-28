"""Create qualification fixtures only in this exact empty owned database."""
import json
import os
import re
import sys
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

sys.path.insert(0, '/app')
import django
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.db import transaction
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee, EmployeeServiceProfile
from organization_management.apps.employees.service_profile import normalize_profile
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.management.commands.seed_operations import PERMISSIONS

marker = os.environ.get('FIXTURE_STAND_MARKER', '')
if os.environ.get('QUALIFICATION_ACCEPTANCE_FIXTURE') != '1' or not re.fullmatch(r'qualification-browser-[a-f0-9]{10}', marker):
    raise RuntimeError('Explicit qualification fixture opt-in and owned stand marker are required.')
expected_database = 'sj_qualification_acceptance_' + marker.replace('-', '_')
if settings.DATABASES['default']['NAME'] != expected_database or settings.DATABASES['default']['HOST'] != 'db':
    raise RuntimeError('Use only the exact marker-bound qualification acceptance database on db.')
try:
    origin = urlsplit(os.environ.get('FIXTURE_ORIGIN', ''))
    origin.port
except ValueError as error:
    raise RuntimeError('FIXTURE_ORIGIN must identify the isolated loopback HTTP origin.') from error
if origin.scheme not in ('http', 'https') or origin.hostname not in ('127.0.0.1', 'localhost', '::1') or (
        origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment):
    raise RuntimeError('FIXTURE_ORIGIN must identify the isolated loopback HTTP origin.')
password = os.environ.get('FIXTURE_PASSWORD', '')
if len(password) < 16:
    raise RuntimeError('A separate qualification fixture password of at least16 characters is required.')
if any(model.objects.exists() for model in (User, Employee, Division, StaffUnit, UserRole,
        EmployeeServiceProfile, OpsEmployeeQualification, OpsSecurityEvent, OpsAssistantTask)):
    raise RuntimeError('Qualification fixtures require an empty database without actors, profiles or business sources.')
today = Clock.today_local()
run_id = uuid.uuid4().hex

with transaction.atomic():
    call_command('seed_status_types')
    department_a = Division.objects.create(name='Учебный департамент квалификации А', code='QK-DEP-A', division_type='department')
    department_b = Division.objects.create(name='Учебный департамент квалификации Б', code='QK-DEP-B', division_type='department')
    own = Division.objects.create(name='Учебное управление квалификации А', code='QK-DIR-A', division_type='directorate', parent=department_a)
    foreign = Division.objects.create(name='Учебное управление квалификации Б', code='QK-DIR-B', division_type='directorate', parent=department_b)
    users, accounts = {}, {}
    roles = (
        ('editor', department_a, ('personnel.view', 'orgstructure.manage', 'admin.roles')),
        ('reader', department_a, ('personnel.view',)),
        ('foreign_editor', department_b, ('personnel.view', 'orgstructure.manage', 'admin.roles')),
        ('self', None, ()),
    )
    for key, scope, permissions in roles:
        user = User.objects.create_user(username='qa_qualification_' + run_id + '_' + key, password=password, email='')
        accounts[key] = user
        role_code, grant_id = None, None
        if permissions:
            role_code = 'QA_QUAL_' + run_id[:12].upper() + '_' + key.upper()
            role = Role.objects.create(code=role_code, name='Учебная квалификация ' + key)
            for code in permissions:
                permission, _ = Permission.objects.get_or_create(code=code, defaults={'name': dict(PERMISSIONS)[code]})
                if not permission.is_active:
                    raise RuntimeError('Expected an active canonical fixture permission: ' + code)
                RolePermission.objects.create(role_code=role, permission_code=permission)
            RoleAdminService.assign_role(str(user.pk), role.code, scope.pk, actor='qualification-fixture-seed')
            grant_id = UserRole.objects.get(user_id=str(user.pk), role_code_id=role.code, scope_division_id=scope.pk).pk
        users[key] = {'id': user.pk, 'username': user.username, 'role': role_code,
            'scope': scope.pk if scope else None, 'grantId': grant_id, 'permissions': list(permissions)}
    people = {}
    records = {}
    for index, (key, division, surname) in enumerate((('own', own, 'УчебныйКвалификацияА'),
            ('foreign', foreign, 'УчебныйКвалификацияБ'), ('self', foreign, 'УчебныйЛичныйПрофиль')), 1):
        fields = {'user': accounts['self']} if key == 'self' else {}
        employee = Employee.objects.create(first_name='Тест', last_name=surname,
            personnel_number='QK' + run_id[:10] + str(index), iin=f'99000000000{index}', hire_date='2020-01-01', **fields)
        StaffUnit.objects.create(employee=employee, division=division, index=index)
        records[key] = employee
        people[key] = {'id': employee.pk, 'name': surname + ' Тест', 'divisionId': division.pk}
    legacy = normalize_profile({'skills': {'shooting': 5, 'hand_to_hand': 3}, 'height_cm': 180, 'weight_kg': 75})
    profile = EmployeeServiceProfile.objects.create(employee=records['own'], data=legacy)
    checks = [
        {'skill': 'shooting', 'score': 4, 'assessed_on': (today-timedelta(days=1)).isoformat(),
         'valid_until': today.isoformat(), 'basis': 'Учебная ведомость актуальной проверки'},
        {'skill': 'shooting', 'score': 3, 'assessed_on': (today-timedelta(days=10)).isoformat(),
         'valid_until': (today-timedelta(days=1)).isoformat(), 'basis': 'Учебная ведомость более ранней проверки'},
        {'skill': 'hand_to_hand', 'score': 2, 'assessed_on': (today-timedelta(days=2)).isoformat(),
         'valid_until': (today-timedelta(days=1)).isoformat(), 'basis': 'Учебная ведомость с истёкшим сроком'},
        {'skill': 'physical_fitness', 'score': 3, 'assessed_on': today.isoformat(),
         'valid_until': None, 'basis': 'Учебная ведомость без срока действия'},
    ]
    fixture = {'database': expected_database, 'standMarker': marker, 'origin': origin.geturl().rstrip('/'),
        'runId': run_id, 'today': today.isoformat(), 'tomorrow': (today+timedelta(days=1)).isoformat(),
        'users': users, 'people': people, 'divisions': {'departmentA': department_a.pk, 'departmentB': department_b.pk,
            'own': own.pk, 'foreign': foreign.pk}, 'legacyProfile': legacy, 'legacyRevision': profile.revision,
        'assessments': checks, 'superusers': User.objects.filter(is_superuser=True).count(),
        'staffUsers': User.objects.filter(is_staff=True).count(), 'qualificationCount': OpsEmployeeQualification.objects.count()}
print('FIXTURE_JSON=' + json.dumps(fixture, ensure_ascii=True))
