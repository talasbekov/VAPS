import pytest
from datetime import date, timedelta
from django.utils import timezone
from django.urls import reverse
from rest_framework.test import APIClient
from openpyxl import load_workbook
import io

from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from django.contrib.auth import get_user_model

User = get_user_model()

@pytest.fixture(autouse=True)
def mock_template_path(tmp_path, monkeypatch):
    """
    Создает временный валидный xlsx шаблон и подменяет settings.BASE_DIR,
    чтобы код utils.py искал файл в правильном месте.
    """
    import os
    from openpyxl import Workbook
    from django.conf import settings

    # Создаем фиктивную структуру для apps/reports/
    reports_dir = tmp_path / "apps" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    template_file = reports_dir / "расход.xlsx"

    # Сохраняем минимально валидный workbook
    wb = Workbook()
    wb.save(template_file)

    # Подменяем BASE_DIR
    monkeypatch.setattr(settings, 'BASE_DIR', str(tmp_path))

    return str(template_file)

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def test_user():
    user, _ = User.objects.get_or_create(username='test_user', defaults={'password': 'password'})
    return user

@pytest.fixture
def super_user():
    user, _ = User.objects.get_or_create(username='super_user', defaults={'password': 'password', 'is_superuser': True})
    return user

@pytest.fixture
def structure_setup():
    """
    Создает тестовую структуру:
    Департамент -> Управление -> Отдел
    С разными штатными единицами, сотрудниками и статусами.
    """
    # 1. Подразделения (Divisions)
    department = Division.objects.create(name="Главный Департамент", code="root", division_type=Division.DivisionType.DEPARTMENT)
    directorate1 = Division.objects.create(name="Управление 1", code="dir1", division_type=Division.DivisionType.DIRECTORATE, parent=department)
    department.refresh_from_db()
    directorate1.refresh_from_db()

    # Подчиненный отдел
    division1 = Division.objects.create(name="Отдел 1", code="div1", division_type=Division.DivisionType.DIVISION, parent=directorate1)
    division1.refresh_from_db()

    # 2. Штатные единицы
    su_dept_1 = StaffUnit.objects.create(division=department, index=1)
    su_dir1_1 = StaffUnit.objects.create(division=directorate1, index=1)
    su_dir1_2 = StaffUnit.objects.create(division=directorate1, index=2)
    su_dir1_3 = StaffUnit.objects.create(division=directorate1, index=3)
    su_dir1_vacant = StaffUnit.objects.create(division=directorate1, index=4)
    su_div1_1 = StaffUnit.objects.create(division=division1, index=1)

    # 3. Сотрудники
    emp_dept = Employee.objects.create(personnel_number="001", last_name="Иванов", first_name="Иван", gender=Employee.Gender.MALE); su_dept_1.employee = emp_dept; su_dept_1.save()
    emp_dir1_1 = Employee.objects.create(personnel_number="002", last_name="Петров", first_name="Петр", gender=Employee.Gender.MALE); su_dir1_1.employee = emp_dir1_1; su_dir1_1.save()
    emp_dir1_2 = Employee.objects.create(personnel_number="003", last_name="Сидоров", first_name="Сидор", gender=Employee.Gender.MALE); su_dir1_2.employee = emp_dir1_2; su_dir1_2.save()
    emp_dir1_3 = Employee.objects.create(personnel_number="004", last_name="Смирнов", first_name="Алексей", gender=Employee.Gender.MALE); su_dir1_3.employee = emp_dir1_3; su_dir1_3.save()
    emp_div1_1 = Employee.objects.create(personnel_number="005", last_name="Николаев", first_name="Николай", gender=Employee.Gender.MALE); su_div1_1.employee = emp_div1_1; su_div1_1.save()

    # 4. Статусы
    today = timezone.now().date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    test_user, _ = User.objects.get_or_create(username='status_creator', defaults={'password': 'password'})

    # Иванов: В строю
    EmployeeStatus.objects.create(
        employee=emp_dept,
        status_type=EmployeeStatus.StatusType.IN_SERVICE,
        state=EmployeeStatus.StatusState.ACTIVE,
        start_date=yesterday, created_by=test_user
    )

    # Петров: В строю
    EmployeeStatus.objects.create(
        employee=emp_dir1_1,
        status_type=EmployeeStatus.StatusType.IN_SERVICE,
        state=EmployeeStatus.StatusState.ACTIVE,
        start_date=yesterday, created_by=test_user
    )

    # Сидоров: В отпуске
    EmployeeStatus.objects.create(
        employee=emp_dir1_2,
        status_type=EmployeeStatus.StatusType.VACATION,
        state=EmployeeStatus.StatusState.ACTIVE,
        start_date=yesterday, created_by=test_user,
        end_date=tomorrow
    )

    # Смирнов: На больничном
    EmployeeStatus.objects.create(
        employee=emp_dir1_3,
        status_type=EmployeeStatus.StatusType.SICK_LEAVE,
        state=EmployeeStatus.StatusState.ACTIVE,
        start_date=yesterday, created_by=test_user,
        end_date=tomorrow
    )

    # Николаев: В командировке
    EmployeeStatus.objects.create(
        employee=emp_div1_1,
        status_type=EmployeeStatus.StatusType.BUSINESS_TRIP,
        state=EmployeeStatus.StatusState.ACTIVE,
        start_date=yesterday, created_by=test_user,
        end_date=tomorrow
    )

    return {
        'department': department,
        'directorate1': directorate1,
    }


@pytest.mark.django_db
class TestDailyExpenseIntegration:

    def test_expense_report_api_success(self, api_client, super_user, structure_setup):
        """
        Тестируем успешную генерацию отчета и его структуру через API.
        """
        api_client.force_authenticate(user=super_user)
        department = structure_setup['department']

        # Эндпоинт: /api/reports/reports/expense/<department_id>/
        url = reverse('report-expense', kwargs={'department_id': department.id})

        response = api_client.get(url)
        assert response.status_code == 200
        assert response['Content-Type'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

        # Проверяем содержимое файла
        wb = load_workbook(io.BytesIO(b"".join(response.streaming_content)))
        ws = wb.active

        # СТРОКА 1 (index 0 - header, index 1 - data)
        found_directorate = False
        for row in ws.iter_rows(values_only=True):
            if row[0] == "Управление 1":
                found_directorate = True
                assert row[1] == 5  # staff units count in directorate1 + division1 (su_dir1_1, su_dir1_2, su_dir1_3, su_dir1_vacant, su_div1_1)
                assert row[2] == 4  # employees count (Петров, Сидоров, Смирнов, Николаев)
                assert row[3] == 1  # in_service_count (Петров)
                assert row[4] == 1  # vacancies_count (su_dir1_vacant)
                assert row[5] == 1  # vacation_count (Сидоров)
                assert row[6] == 1  # trip (Николаев)
                assert row[7] == 1  # sick (Смирнов)

        assert found_directorate, "Управление 1 не найдено в отчете"

    def test_expense_report_function_direct(self, structure_setup):
        """
        Тестируем функцию generate_personnel_expense_report напрямую.
        Проверяем агрегацию и логику подсчета вакансий и сотрудников.
        """
        from organization_management.apps.reports.utils import generate_personnel_expense_report
        department = structure_setup['department']

        file_buffer, filename = generate_personnel_expense_report(department.id)

        # Проверяем структуру имени
        assert filename.startswith("расход_Главный Департамент_")
        assert filename.endswith(".xlsx")

        # Проверяем содержимое
        wb = load_workbook(io.BytesIO(file_buffer.read()))
        ws = wb.active

        # Ищем ИТОГО
        found_total = False
        for row in ws.iter_rows(values_only=True):
            if row[0] == "ИТОГО":
                found_total = True
                assert row[1] == 6  # total staff units (direct dept + all directorate descendants)
                assert row[2] == 5  # total employees (direct dept + all directorate descendants)
                assert row[3] == 2  # total in service (direct dept + all directorate descendants)
                assert row[4] == 1  # total vacancies
                assert row[5] == 1  # total vacation
                assert row[6] == 1  # total trip
                assert row[7] == 1  # total sick

        assert found_total, "Строка ИТОГО не найдена"
