"""Changing a slot must authorize both its original and destination scope."""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_staffing_section_permissions import (
    tree, ops_user,
)

pytestmark = pytest.mark.django_db


def client(tree, global_scope=False):
    user = ops_user('write-target', ['orgstructure.view', 'orgstructure.manage'],
                    None if global_scope else tree['left'])
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.mark.parametrize('case', [
    'single-division', 'bulk-division', 'child-division', 'bulk-parent',
    'child-parent', 'foreign-child', 'new-foreign-child', 'new-child-foreign-parent',
])
def test_staff_write_rejects_foreign_targets_without_partial_changes(tree, case):
    own = tree['units']['left']
    foreign = tree['units']['right']
    child = StaffUnit.objects.create(division=tree['left'], position=own.position,
                                    parent=own, index=3)
    bodies = {
        'single-division': {'division': tree['right'].pk},
        'bulk-division': {'division': tree['right'].pk, 'children': []},
        'child-division': {'index': 99, 'children': [{'id': child.pk, 'division': tree['right'].pk}]},
        'bulk-parent': {'parent_id': foreign.pk, 'children': []},
        'child-parent': {'index': 99, 'children': [{'id': child.pk, 'parent_id': foreign.pk}]},
        'foreign-child': {'index': 99, 'children': [{'id': foreign.pk, 'index': 98}]},
        'new-foreign-child': {'index': 99, 'children': [{'division': tree['right'].pk, 'position': own.position_id}]},
        'new-child-foreign-parent': {'index': 99, 'children': [{'division': tree['left'].pk, 'position': own.position_id, 'parent_id': foreign.pk}]},
    }
    api = client(tree)
    before = list(StaffUnit.objects.order_by('pk').values())
    response = api.patch(f'/api/staff_unit/staff-units/{own.pk}/', bodies[case], format='json')
    assert response.status_code == 403, response.content
    assert list(StaffUnit.objects.order_by('pk').values()) == before


@pytest.mark.parametrize('bulk', [False, True])
def test_global_staff_manager_can_move_slots_between_departments(tree, bulk):
    own = tree['units']['left']
    body = {'division': tree['right'].pk}
    if bulk:
        body['children'] = []
    response = client(tree, global_scope=True).patch(
        f'/api/staff_unit/staff-units/{own.pk}/', body, format='json')
    assert response.status_code == 200, response.content
    own.refresh_from_db()
    assert own.division_id == tree['right'].pk


def test_scoped_staff_manager_keeps_valid_bulk_changes(tree):
    own = tree['units']['left']
    response = client(tree).patch(f'/api/staff_unit/staff-units/{own.pk}/', {
        'index': 21, 'children': [{'division': tree['left'].pk,
                                 'position': own.position_id, 'index': 22}],
    }, format='json')
    assert response.status_code == 200, response.content
    own.refresh_from_db()
    assert own.index == 21
    assert own.children.get().index == 22


def test_staff_details_do_not_include_children_from_foreign_scope(tree):
    own = tree['units']['left']
    foreign = tree['units']['right']
    foreign.parent = own
    foreign.save()
    child = StaffUnit.objects.create(division=tree['left'], position=own.position,
                                    parent=own, index=3)
    response = client(tree).get(f'/api/staff_unit/staff-units/{own.pk}/')
    assert response.status_code == 200
    assert [row['id'] for row in response.json()['children']] == [child.pk]


def test_bulk_status_denial_does_not_report_success_or_save_other_fields(tree):
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.statuses.models import EmployeeStatus
    from django.utils import timezone
    from organization_management.apps.operations.models import StatusType
    StatusType.objects.get_or_create(code='sick_leave', defaults={
        'name': 'На больничном', 'priority': 10, 'report_column_code': 'SICK',
    })
    employee = Employee.objects.create(personnel_number='TARGET-SCOPE', last_name='Foreign')
    foreign = tree['units']['right']
    foreign.employee = employee
    foreign.save()
    own = tree['units']['left']
    before = list(EmployeeStatus.objects.order_by('pk').values())
    response = client(tree).patch(f'/api/staff_unit/staff-units/{own.pk}/', {
        'index': 99, 'employee_statuses': [{'employee_id': employee.pk,
                                         'status_type': 'sick_leave',
                                         'start_date': timezone.localdate().isoformat()}],
    }, format='json')
    assert response.status_code == 403, response.content
    own.refresh_from_db()
    assert own.index != 99
    assert list(EmployeeStatus.objects.order_by('pk').values()) == before
