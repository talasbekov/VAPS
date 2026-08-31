import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import (
    Permission as OpsPermission,
    Role as OpsRole,
    RolePermission as OpsRolePermission,
)
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.reports.models import Report

User = get_user_model()


def grant_scope(user, division, *, role_code):
    """Область отчётов даёт ГРАНТ ПРАВА РАЗДЕЛА (Plane №352, Ш-6).

    Раньше её задавала портальная роль с одним `scope_division`; её каталог
    снесён. Способ описания области сменился, ПРОВЕРЯЕМОЕ ПОВЕДЕНИЕ — нет:
    человек видит своё подразделение и всё под ним.
    """
    role, _ = OpsRole.objects.get_or_create(
        code=role_code, defaults={"name": role_code}
    )
    permission, _ = OpsPermission.objects.get_or_create(
        code="orgstructure.view", defaults={"name": "Просмотр оргструктуры"}
    )
    OpsRolePermission.objects.get_or_create(
        role_code=role, permission_code=permission
    )
    RoleAdminService.assign_role(
        str(user.pk), role.code, division.id, actor="test"
    )


@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def test_data():
    dept1 = Division.objects.create(name="Dept 1", code="dept1", division_type=Division.DivisionType.DEPARTMENT)
    dir1 = Division.objects.create(name="Dir 1", code="dir1", division_type=Division.DivisionType.DIRECTORATE, parent=dept1)

    dept2 = Division.objects.create(name="Dept 2", code="dept2", division_type=Division.DivisionType.DEPARTMENT)

    u_admin = User.objects.create(username="admin", is_superuser=True)

    # Начальник управления: область — грант права раздела на своё управление
    # (Plane №352, Ш-6). Роли `ROLE_4`/`ROLE_3` заводились здесь, чтобы
    # раздать области; их каталога больше нет.
    u_head = User.objects.create(username="head")
    grant_scope(u_head, dir1, role_code="TEST_DIR_SCOPE")

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
        u_dept_head = User.objects.create(username="dept_head")
        grant_scope(u_dept_head, test_data['dept1'], role_code="TEST_DEPT_SCOPE")

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

    def test_generate_report_forbidden_unrelated_division(self, api_client, test_data):
        api_client.force_authenticate(user=test_data['u_head'])
        url = reverse('report-list') + 'generate/'
        data = {'division': test_data['dept2'].id, 'report_type': Report.ReportType.PERSONNEL_ROSTER}
        response = api_client.post(url, data)
        assert response.status_code == 403
        assert response.data['detail'] == 'Подразделение вне зоны ответственности'

    def test_generate_report_success_in_scope(self, api_client, test_data, monkeypatch):
        u_dept_head = User.objects.create(username="dept_head2")
        grant_scope(u_dept_head, test_data['dept1'], role_code="TEST_DEPT_SCOPE_2")

        api_client.force_authenticate(user=u_dept_head)
        # mock celery task
        monkeypatch.setattr('organization_management.apps.reports.tasks.generate_report_task.delay', lambda x: True)

        url = reverse('report-list') + 'generate/'
        data = {'division': test_data['dir1'].id, 'report_type': Report.ReportType.PERSONNEL_ROSTER}
        response = api_client.post(url, data)
        assert response.status_code == 202

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

    def test_the_list_is_ordered_by_the_model(self, api_client, test_data):
        """Порядок пагинируемого списка задаёт модель.

        Пин литеральный: поведенческая проба тут вакуумна — на нескольких
        записях планировщик и без ordering обычно отдаёт их в порядке
        вставки, а страницы разъезжаются уже на объёме. Второй ключ `-id`
        проверяется отдельно: `created_at` — auto_now_add, и записи одной
        транзакции делят его до микросекунды, так что без tie-breaker
        порядок между ними не определён ничем.
        """
        assert Report._meta.ordering == ['-created_at', '-id']

        test_user = test_data['u_admin']
        first = Report.objects.create(job_id="ord_1", created_by=test_user)
        second = Report.objects.create(job_id="ord_2", created_by=test_user)
        # `created_at` выставляется auto_now_add и у двух подряд созданных
        # записей различается на микросекунды — совпадение штампа, ради
        # которого и нужен `-id`, здесь воспроизводится явно (update() не
        # трогает auto_now_add).
        Report.objects.filter(pk__in=[first.pk, second.pk]).update(
            created_at=first.created_at
        )
        assert first.pk < second.pk

        api_client.force_authenticate(user=test_user)
        response = api_client.get(reverse('report-list'))

        assert [row['job_id'] for row in response.data['results']] == [
            "ord_2",
            "ord_1",
        ]
