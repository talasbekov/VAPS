"""Declared fixture injection: withdraw one nonce-bound editor grant before POST."""
import json
import os
import re
import django
django.setup()
from django.conf import settings
from django.db import transaction
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.employees.models import EmployeeServiceProfile
from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification

try:
    fixture = json.loads(os.environ.get('FIXTURE_METADATA', ''))
    marker, actor, run_id = fixture['standMarker'], fixture['users']['editor'], fixture['runId']
except (ValueError, KeyError, TypeError) as error:
    raise RuntimeError('Owned qualification fixture metadata is required for this transition.') from error
if (os.environ.get('QUALIFICATION_ACCEPTANCE_REVOKE') != '1' or
        not re.fullmatch(r'qualification-browser-[a-f0-9]{10}', marker) or
        not re.fullmatch(r'[a-f0-9]{32}', run_id) or marker != os.environ.get('FIXTURE_STAND_MARKER') or
        fixture['database'] != 'sj_qualification_acceptance_' + marker.replace('-', '_') or
        settings.DATABASES['default']['NAME'] != fixture['database'] or settings.DATABASES['default']['HOST'] != 'db' or
        actor['username'] != 'qa_qualification_' + run_id + '_editor' or
        actor['role'] != 'QA_QUAL_' + run_id[:12].upper() + '_EDITOR' or
        actor['scope'] != fixture['divisions']['departmentA']):
    raise RuntimeError('Withdraw only the exact owned qualification editor fixture grant.')
fields = ('id', 'user_id', 'role_code_id', 'scope_division_id', 'is_active')
with transaction.atomic():
    grant = UserRole.objects.select_for_update().filter(pk=actor['grantId'], user_id=str(actor['id']),
        role_code_id=actor['role'], scope_division_id=actor['scope'], is_active=True).first()
    if grant is None:
        raise RuntimeError('The exact active fixture editor grant is absent or already changed.')
    before = list(UserRole.objects.order_by('id').values(*fields))
    profiles = list(EmployeeServiceProfile.objects.order_by('pk').values('pk', 'data', 'revision', 'updated_at'))
    qualifications = list(OpsEmployeeQualification.objects.order_by('pk').values())
    RoleAdminService.revoke_role(str(actor['id']), actor['role'], actor['scope'], actor='qualification-fixture-transition')
    after = list(UserRole.objects.order_by('id').values(*fields))
    expected = [{**row, 'is_active': False} if row['id'] == actor['grantId'] else row for row in before]
    if after != expected:
        raise RuntimeError('Fixture transition changed more than its single expected grant.')
    if profiles != list(EmployeeServiceProfile.objects.order_by('pk').values('pk', 'data', 'revision', 'updated_at')) or qualifications != list(OpsEmployeeQualification.objects.order_by('pk').values()):
        raise RuntimeError('Qualification or profile data changed during the fixture grant transition.')
print(json.dumps({'complete': True, 'fixtureTransition': True, 'standMarker': marker,
    'actorId': str(actor['id']), 'grantId': actor['grantId'], 'before': before, 'after': after,
    'otherGrantsPreserved': True, 'qualificationAndProfileStatePreserved': True}, sort_keys=True))
