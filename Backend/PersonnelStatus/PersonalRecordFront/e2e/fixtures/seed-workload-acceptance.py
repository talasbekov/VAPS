"""Explicit facts only, in a new synthetic workload database."""
import hashlib
import json
import os
import sys
from datetime import date, datetime, timedelta
sys.path.insert(0, '/app')
import django
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.db import transaction
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import Permission, Role, RolePermission
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_status import OpsEmployeeStatus, OpsStatusParticipation
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.management.commands.seed_operations import PERMISSIONS
from organization_management.apps.operations.management.commands.seed_operations import Command as ReferenceCommand

if not settings.DATABASES['default']['NAME'].startswith('sj_coverage_acceptance_') or settings.DATABASES['default']['HOST'] != 'db':
    raise RuntimeError('Workload fixtures require a sj_coverage_acceptance_ database on the isolated db host.')
if any(model.objects.exists() for model in (User, Employee, Division, StaffUnit, OpsDutyLogEntry,
        OpsDutyRecordSupplement, OpsEmployeeStatus, OpsStatusParticipation)):
    raise RuntimeError('Workload fixtures require an empty database with no users, structure or workload sources.')
day = Clock.today_local() - timedelta(days=1)
def instant(time):
    return datetime.fromisoformat(day.isoformat() + 'T' + time + ':00+05:00')

with transaction.atomic():
    call_command('seed_status_types')
    ReferenceCommand()._seed_analytics()
    department = Division.objects.create(name='Учебный департамент нагрузки', code='QA-COVER-DEP', division_type='department')
    mine = Division.objects.create(name='Учебное управление нагрузки', code='QA-COVER-MINE', division_type='directorate', parent=department)
    child = Division.objects.create(name='Учебный отдел нагрузки', code='QA-COVER-CHILD', division_type='division', parent=mine)
    foreign = Division.objects.create(name='Чужое управление нагрузки', code='QA-COVER-FOREIGN', division_type='directorate')
    people = {}
    for index, (key, division, surname) in enumerate((('own', mine, 'УчётныйПервый'), ('child', child, 'УчётныйВторой'), ('foreign', foreign, 'ЧужойУчётный'), ('om', mine, 'УчастникУчебный')), 201):
        employee = Employee.objects.create(first_name='Тест', last_name=surname, personnel_number=f'QC{index:05d}', iin=f'{index:012d}', hire_date=date(2020, 1, 1))
        StaffUnit.objects.create(division=division, employee=employee, index=index)
        people[key] = {'id': employee.pk, 'name': f'{surname} Тест', 'division': division.pk}
    StaffUnit.objects.create(division=mine, index=205)
    for start, end, actual_start, actual_end, cancelled in (
        ('08:00', '10:00', '08:00', '09:30', False),
        ('09:00', '11:00', '09:00', '10:30', False),
        ('11:00', '12:00', None, None, True),
    ):
        OpsDutyLogEntry.objects.create(employee_id=people['own']['id'], employee_name=people['own']['name'],
            division_id=mine.pk, division_name=mine.name, service_duty_code='QA_COVERAGE', service_duty_label='Учебная проверка интервала',
            planned_start=instant(start), planned_end=instant(end), actual_start=instant(actual_start) if actual_start else None,
            actual_end=instant(actual_end) if actual_end else None, created_by='synthetic-coverage-seed',
            cancelled_at=instant('07:00') if cancelled else None, cancelled_by='synthetic-coverage-seed' if cancelled else '',
            cancelled_reason='Учебная отмена' if cancelled else '', note='QA-COVERAGE-PRIVATE-NOTE', document_basis='QA-COVERAGE-PRIVATE-BASIS')
    OpsDutyLogEntry.objects.create(employee_id=people['foreign']['id'], employee_name=people['foreign']['name'],
        division_id=foreign.pk, division_name=foreign.name, service_duty_code='QA_COVERAGE', service_duty_label='Чужая учебная смена',
        planned_start=instant('08:00'), planned_end=instant('11:00'), created_by='synthetic-coverage-seed')
    OpsEmployeeStatus.objects.create(employee_id=people['child']['id'], status_type_code='VACATION',
        date_start=day, date_end=day+timedelta(days=1), created_by='synthetic-coverage-seed', comment='QA-COVERAGE-PRIVATE-STATUS')
    om = OpsEmployeeStatus.objects.create(employee_id=people['om']['id'], status_type_code='IN_EVENT',
        date_start=day, date_end=day+timedelta(days=1), created_by='synthetic-coverage-seed',
        source_ref='security-event:98765', comment='QA-COVERAGE-PRIVATE-EVENT')
    OpsStatusParticipation.objects.create(status=om, event_id=98765, kind_code='PHYSICAL_SQUAD')
    role_specs = (
        ('scoped', mine, ('analytics.view', 'analytics.personal_detail', 'status.view')),
        ('scoped_om', mine, ('analytics.view', 'analytics.personal_detail', 'status.view', 'analytics.operations')),
        ('global_om', None, ('analytics.view', 'analytics.personal_detail', 'analytics.operations')),
        ('no_status', mine, ('analytics.view', 'analytics.personal_detail')),
        ('summary', mine, ('analytics.view', 'status.view')),
        ('denied', mine, ('status.view',)),
    )
    users = {}
    for key, scope, permissions in role_specs:
        role = Role.objects.create(code='QA_COVER_' + key.upper(), name='Учебная аналитика ' + key)
        for code in permissions:
            permission, _ = Permission.objects.get_or_create(code=code, defaults={'name': dict(PERMISSIONS)[code]})
            assert permission.is_active
            RolePermission.objects.create(role_code=role, permission_code=permission)
        user = User.objects.create_user(username='qa_coverage_' + key, password=os.environ['FIXTURE_PASSWORD'], email='')
        RoleAdminService.assign_role(str(user.pk), role.code, scope.pk if scope else None, actor='synthetic-coverage-seed')
        users[key] = {'id': user.pk, 'username': user.username, 'permissions': list(permissions), 'scope': scope.pk if scope else None}
    result = {'database': settings.DATABASES['default']['NAME'], 'businessDate': day.isoformat(), 'today': Clock.today_local().isoformat(),
        'people': people, 'users': users, 'divisions': {'mine': mine.pk, 'child': child.pk, 'foreign': foreign.pk},
        'expected': {'ownPlannedMinutes': 180, 'ownActualMinutes': 150, 'scopedEmployees': 2, 'globalOmEmployees': 3,
            'sourceLogRows': 4, 'sourceStatusRows': 2, 'sourceParticipationRows': 1, 'staffSlots': 5},
        'sensitiveCanaries': ['QA-COVERAGE-PRIVATE-NOTE', 'QA-COVERAGE-PRIVATE-BASIS', 'QA-COVERAGE-PRIVATE-STATUS', 'QA-COVERAGE-PRIVATE-EVENT', '98765']}
print('FIXTURE_JSON=' + json.dumps(result, ensure_ascii=True))
