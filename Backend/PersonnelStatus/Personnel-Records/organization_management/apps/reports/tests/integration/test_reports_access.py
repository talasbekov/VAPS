import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from organization_management.apps.divisions.models import Division
from organization_management.apps.common.models import Role, UserRole
from organization_management.apps.reports.models import Report

User = get_user_model()

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def test_data():
    dept1 = Division.objects.create(name="Dept 1", code="dept1", division_type=Division.DivisionType.DEPARTMENT)
    dir1 = Division.objects.create(name="Dir 1", code="dir1", division_type=Division.DivisionType.DIRECTORATE, parent=dept1)

    dept2 = Division.objects.create(name="Dept 2", code="dept2", division_type=Division.DivisionType.DEPARTMENT)

    r_sysadmin = Role.objects.create(code="ROLE_4", name="Сисадмин")
    r_head = Role.objects.create(code="ROLE_3", name="Нач Упр")

    u_admin = User.objects.create(username="admin", is_superuser=True)

    u_head = User.objects.create(username="head")
    UserRole.objects.create(user=u_head, role=r_head, scope_division=dir1)

    u_norole = User.objects.create(username="norole")

    return {
        "dept1": dept1,
        "dir1": dir1,
        "dept2": dept2,
        "u_admin": u_admin,
        "u_head": u_head,
        "u_norole": u_norole
    }


@pytest.mark.django_db
class TestReportsAccess:

    def test_unauthenticated_gets_401(self, api_client, test_data):
        url = reverse('report-expense', kwargs={'department_id': test_data['dept1'].id})
        response = api_client.get(url)
        assert response.status_code == 401

    def test_admin_can_access_any_department(self, api_client, test_data, monkeypatch):
        api_client.force_authenticate(user=test_data['u_admin'])
        response = api_client.get(reverse('report-expense', kwargs={'department_id': test_data['dept2'].id}))
        # Not 403. 200 if OK, 400/500 if template missing, but auth passed.
        assert response.status_code != 403

    def test_scoped_user_can_access_own_scope(self, api_client, test_data):
        api_client.force_authenticate(user=test_data['u_head'])
        # u_head is scoped to dir1. In report expense endpoint, we pass department.
        # dept1 is parent of dir1. So dir1's descendants don't include dept1.
        # Therefore current logic denies access!
        response = api_client.get(reverse('report-expense', kwargs={'department_id': test_data['dept1'].id}))
        assert response.status_code == 403

        # To test success, we create a user scoped to dept1
        from organization_management.apps.common.models import UserRole, Role
        u_dept_head = User.objects.create(username="dept_head")
        r_dept = Role.objects.create(code="ROLE_2", name="Обсервер деп")
        UserRole.objects.create(user=u_dept_head, role=r_dept, scope_division=test_data['dept1'])

        api_client.force_authenticate(user=u_dept_head)
        response = api_client.get(reverse('report-expense', kwargs={'department_id': test_data['dept1'].id}))
        assert response.status_code != 403

    def test_scoped_user_gets_403_for_out_of_scope(self, api_client, test_data):
        api_client.force_authenticate(user=test_data['u_head'])
        # dept2 is out of scope for u_head (who is scoped to dir1 inside dept1)
        url = reverse('report-expense', kwargs={'department_id': test_data['dept2'].id})
        response = api_client.get(url)
        assert response.status_code == 403
        assert response.data['detail'] == 'Департамент вне зоны ответственности'

    def test_user_without_scope_gets_403(self, api_client, test_data):
        api_client.force_authenticate(user=test_data['u_norole'])
        url = reverse('report-expense', kwargs={'department_id': test_data['dept1'].id})
        response = api_client.get(url)
        assert response.status_code == 403
        assert response.data['detail'] == 'Нет зоны ответственности'

    def test_list_visibility_scopes(self, api_client, test_data):
        # Admin creates reports
        test_user = test_data['u_admin']
        Report.objects.create(job_id="test_job_1", division=test_data['dir1'], created_by=test_user)
        Report.objects.create(job_id="test_job_2", division=test_data['dept2'], created_by=test_user)

        # Admin sees all (2)
        api_client.force_authenticate(user=test_user)
        response = api_client.get(reverse('report-list'))
        assert len(response.data['results']) == 2

        # u_head sees only Rep 1
        api_client.force_authenticate(user=test_data['u_head'])
        response = api_client.get(reverse('report-list'))
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['division'] == test_data['dir1'].id

        # u_norole sees 0
        api_client.force_authenticate(user=test_data['u_norole'])
        response = api_client.get(reverse('report-list'))
        assert len(response.data['results']) == 0
