"""Synthetic identities in an explicitly new acceptance database only."""
import json
import os
import sys
import uuid
from urllib.parse import urlsplit
from datetime import date, timedelta
import django

sys.path.insert(0, '/app')
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.db import transaction
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Permission, Role, RolePermission, StatusType, UserRole
from organization_management.apps.operations.models_status import OpsEmployeeStatus, OpsStatusParticipation
from organization_management.apps.operations.models_submission import OpsDailySubmission
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.management.commands.seed_operations import PERMISSIONS

if not settings.DATABASES['default']['NAME'].startswith('sj_daily_acceptance_') or settings.DATABASES['default']['HOST'] != 'db':
    raise RuntimeError('Daily fixtures require a sj_daily_acceptance_ database on the isolated db host.')
if any(model.objects.exists() for model in (User, Employee, Division, StaffUnit, OpsEmployeeStatus,
        OpsStatusParticipation, OpsDailySubmission, OpsDutyLogEntry, OpsDutyRecordSupplement, UserRole)):
    raise RuntimeError('Daily fixtures require an empty database without users, structure, grants or daily/duty sources.')
try:
    origin = urlsplit(os.environ.get('FIXTURE_ORIGIN', ''))
    origin.port
except ValueError as error:
    raise RuntimeError('FIXTURE_ORIGIN must be the isolated loopback HTTP origin.') from error
if origin.scheme not in ('http', 'https') or origin.hostname not in ('127.0.0.1', 'localhost', '::1') or (
        origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment):
    raise RuntimeError('FIXTURE_ORIGIN must be the isolated loopback HTTP origin without credentials, query or path.')
password = os.environ.get('FIXTURE_PASSWORD', '')
if len(password) < 16:
    raise RuntimeError('Set a separate FIXTURE_PASSWORD of at least 16 characters.')
run_id = uuid.uuid4().hex
# An early day in the next month exercises the padded calendar label and month
# navigation on every run, instead of relying on today's day-of-month.
business_date = (Clock.today_local().replace(day=28) + timedelta(days=4)).replace(day=1)

with transaction.atomic():
    call_command('seed_status_types')
    department = Division.objects.create(name='Учебный департамент Альфа', code='QA-DEP-A', division_type='department', is_summary_node=True)
    mine = Division.objects.create(name='Учебное управление Альфа', code='QA-DIR-A', division_type='directorate', parent=department)
    child = Division.objects.create(name='Учебный отдел Альфа', code='QA-UNIT-A', division_type='division', parent=mine)
    foreign_dep = Division.objects.create(name='Учебный департамент Бета', code='QA-DEP-B', division_type='department', is_summary_node=True)
    foreign = Division.objects.create(name='Чужое учебное управление', code='QA-DIR-B', division_type='directorate', parent=foreign_dep)
    people = {}
    for index, (key, division, surname) in enumerate((('own', mine, 'УчебныйПервый'), ('child', child, 'УчебныйВторой'), ('foreign', foreign, 'ЧужойУчебный')), 101):
        employee = Employee.objects.create(first_name='Тест', last_name=surname, personnel_number=f'QA{index:05d}', iin=f'{index:012d}', hire_date=date(2020, 1, 1))
        StaffUnit.objects.create(division=division, employee=employee, index=index)
        people[key] = {'id': employee.pk, 'name': f'{surname} Тест'}
    StaffUnit.objects.create(division=mine, employee=None, index=104)
    identities = {}
    roles = (
        ('chief', mine, ('status.view', 'status.manage', 'daily_report.mark_update')),
        ('officer', department, ('status.view', 'daily_report.generate')),
        ('reader', mine, ('status.view',)),
    )
    for key, scope, permissions in roles:
        role_code = 'DEPARTMENT_EXPENSE_OFFICER' if key == 'officer' else 'QA_DAILY_' + key.upper()
        role, _ = Role.objects.get_or_create(code=role_code, defaults={'name': 'Учебная роль ' + key})
        # Only this empty synthetic database: exercise the department UI with
        # the recognized role code and exactly two daily permissions.
        RolePermission.objects.filter(role_code=role).delete()
        for code in permissions:
            permission, _ = Permission.objects.get_or_create(code=code, defaults={'name': dict(PERMISSIONS)[code]})
            if not permission.is_active:
                raise RuntimeError('Expected active fixture permission: ' + code)
            RolePermission.objects.create(role_code=role, permission_code=permission)
        user = User.objects.create_user(username='qa_daily_' + run_id + '_' + key, password=password, email='')
        RoleAdminService.assign_role(str(user.pk), role.code, scope.pk, actor='synthetic-acceptance-seed')
        identities[key] = {'id': user.pk, 'username': user.username, 'role': role.code, 'scope': scope.pk, 'permissions': list(permissions)}
    for code in ('IN_SERVICE', 'VACATION'):
        if not StatusType.objects.filter(code=code, is_active=True).exists():
            raise RuntimeError('Expected active native status: ' + code)
    fixture = {
        'database': settings.DATABASES['default']['NAME'], 'businessDate': business_date.isoformat(),
        'origin': origin.geturl().rstrip('/'), 'runId': run_id,
        'divisions': {key: {'id': division.pk, 'name': division.name} for key, division in (('department', department), ('mine', mine), ('child', child), ('foreignDepartment', foreign_dep), ('foreign', foreign))},
        'people': people, 'users': identities,
        'expected': {'ownRoster': 2, 'ownStaff': 3, 'ownVacancies': 1, 'vacation': 1, 'inService': 1},
        'superusers': User.objects.filter(is_superuser=True).count(),
    }
print('FIXTURE_JSON=' + json.dumps(fixture, ensure_ascii=True))
