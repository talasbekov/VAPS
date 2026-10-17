"""Existing imported identities and missing dates survive normal application edits."""
import pytest
from django.db import IntegrityError, transaction
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db


def test_imported_employee_dates_and_identity_survive_detail_and_edit(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        employee = Employee.objects.create(personnel_number='IMPORT_COMPAT', external_id='import-employee-1',
                                           birth_date=None, hire_date=None, gender=None)
    assert employee.statuses.filter(state='active').exists()
    client, _ = client_for('import_reader', 'IMPORT_READER', ['personnel.view'])
    response = client.get(f'/api/core/service-employees/{employee.pk}/')
    assert response.status_code == 200, response.content
    assert response.json()['hire_date'] is None
    employee.first_name = 'Corrected'
    employee.save()
    employee.refresh_from_db()
    assert employee.external_id == 'import-employee-1'
    assert employee.birth_date is None and employee.hire_date is None and employee.gender is None
    with pytest.raises(IntegrityError), transaction.atomic():
        Employee.objects.create(personnel_number='IMPORT_DUPLICATE', external_id='import-employee-1')


def test_staff_import_fields_survive_edit_and_new_slots_have_category_default():
    imported = StaffUnit.objects.create(index=1, external_id='import-slot-1', import_order=17, position_category='Imported category')
    imported.index = 2
    imported.save()
    imported.refresh_from_db()
    assert (imported.external_id, imported.import_order, imported.position_category) == ('import-slot-1', 17, 'Imported category')
    fresh = StaffUnit.objects.create(index=3)
    assert fresh.position_category == ''
    assert fresh.external_id is None and fresh.import_order is None
