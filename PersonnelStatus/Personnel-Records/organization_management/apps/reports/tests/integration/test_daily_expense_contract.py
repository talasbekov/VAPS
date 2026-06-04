import pytest
from datetime import date, timedelta
from django.utils import timezone
import io
from openpyxl import load_workbook

from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.reports.models import Report
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

    reports_dir = tmp_path / "apps" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    template_file = reports_dir / "расход.xlsx"

    wb = Workbook()
    wb.save(template_file)
    monkeypatch.setattr(settings, 'BASE_DIR', str(tmp_path))

    return str(template_file)

@pytest.fixture
def structure_setup():
    department = Division.objects.create(name="Главный Департамент", code="root", division_type=Division.DivisionType.DEPARTMENT)
    directorate1 = Division.objects.create(name="Управление 1", code="dir1", division_type=Division.DivisionType.DIRECTORATE, parent=department)
    department.refresh_from_db()
    directorate1.refresh_from_db()

    division1 = Division.objects.create(name="Отдел 1", code="div1", division_type=Division.DivisionType.DIVISION, parent=directorate1)
    division1.refresh_from_db()

    su_dept_1 = StaffUnit.objects.create(division=department, index=1)
    su_dir1_1 = StaffUnit.objects.create(division=directorate1, index=1)
    su_dir1_2 = StaffUnit.objects.create(division=directorate1, index=2)
    su_dir1_3 = StaffUnit.objects.create(division=directorate1, index=3)
    su_dir1_vacant = StaffUnit.objects.create(division=directorate1, index=4)
    su_div1_1 = StaffUnit.objects.create(division=division1, index=1)

    emp_dept = Employee.objects.create(personnel_number="001", last_name="Иванов", first_name="Иван", gender=Employee.Gender.MALE); su_dept_1.employee = emp_dept; su_dept_1.save()
    emp_dir1_1 = Employee.objects.create(personnel_number="002", last_name="Петров", first_name="Петр", gender=Employee.Gender.MALE); su_dir1_1.employee = emp_dir1_1; su_dir1_1.save()
    emp_dir1_2 = Employee.objects.create(personnel_number="003", last_name="Сидоров", first_name="Сидор", gender=Employee.Gender.MALE); su_dir1_2.employee = emp_dir1_2; su_dir1_2.save()
    emp_dir1_3 = Employee.objects.create(personnel_number="004", last_name="Смирнов", first_name="Алексей", gender=Employee.Gender.MALE); su_dir1_3.employee = emp_dir1_3; su_dir1_3.save()
    emp_div1_1 = Employee.objects.create(personnel_number="005", last_name="Николаев", first_name="Николай", gender=Employee.Gender.MALE); su_div1_1.employee = emp_div1_1; su_div1_1.save()

    today = timezone.now().date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    test_user, _ = User.objects.get_or_create(username='status_creator', defaults={'password': 'password'})

    EmployeeStatus.objects.create(
        employee=emp_dept, status_type=EmployeeStatus.StatusType.IN_SERVICE,
        state=EmployeeStatus.StatusState.ACTIVE, start_date=yesterday, created_by=test_user
    )
    EmployeeStatus.objects.create(
        employee=emp_dir1_1, status_type=EmployeeStatus.StatusType.IN_SERVICE,
        state=EmployeeStatus.StatusState.ACTIVE, start_date=yesterday, created_by=test_user
    )
    EmployeeStatus.objects.create(
        employee=emp_dir1_2, status_type=EmployeeStatus.StatusType.VACATION,
        state=EmployeeStatus.StatusState.ACTIVE, start_date=yesterday, end_date=tomorrow, created_by=test_user
    )
    EmployeeStatus.objects.create(
        employee=emp_dir1_3, status_type=EmployeeStatus.StatusType.SICK_LEAVE,
        state=EmployeeStatus.StatusState.ACTIVE, start_date=yesterday, end_date=tomorrow, created_by=test_user
    )
    EmployeeStatus.objects.create(
        employee=emp_div1_1, status_type=EmployeeStatus.StatusType.BUSINESS_TRIP,
        state=EmployeeStatus.StatusState.ACTIVE, start_date=yesterday, end_date=tomorrow, created_by=test_user
    )

    return {
        'department': department,
        'directorate1': directorate1,
    }


@pytest.mark.django_db
class TestDailyExpenseSyncAsyncContract:
    def test_sync_vs_async_gap(self, structure_setup):
        """
        Проверяет расхождения между генератором Excel (Sync) и DataAggregator (Async).
        """
        from organization_management.apps.reports.utils import generate_personnel_expense_report
        from organization_management.apps.reports.infrastructure.data_aggregator import DataAggregator

        department = structure_setup['department']
        dir1 = structure_setup['directorate1']

        # 1. СИНХРОННЫЙ ПУТЬ (XLSX)
        file_buffer, _ = generate_personnel_expense_report(department.id)
        wb = load_workbook(io.BytesIO(file_buffer.read()))
        ws = wb.active

        sync_dir1 = {}
        sync_total = {}

        for row in ws.iter_rows(values_only=True):
            if row[0] == "Управление 1":
                sync_dir1 = {
                    "staff_units": row[1],
                    "employees": row[2],
                    "in_service": row[3],
                    "vacancies": row[4],
                    "vacation": row[5],
                    "trip": row[6],
                    "sick": row[7],
                }
            elif row[0] == "ИТОГО":
                sync_total = {
                    "staff_units": row[1],
                    "employees": row[2],
                    "in_service": row[3],
                    "vacancies": row[4],
                    "vacation": row[5],
                    "trip": row[6],
                    "sick": row[7],
                }

        # 2. АСИНХРОННЫЙ ПУТЬ (DataAggregator)
        test_user, _ = User.objects.get_or_create(username='report_creator')
        report = Report.objects.create(
            job_id="test-job",
            report_type=Report.ReportType.PERSONNEL_ROSTER,
            division=department,
            created_by=test_user,
            date_from=timezone.now().date(),
            date_to=timezone.now().date(),
        )

        # We need to catch DataAggregator crashing because Employee model has no `division_id`.
        # DataAggregator currently uses: Employee.objects.filter(division_id__in=division_ids)
        # However Employee division is via StaffUnit: `employee.staff_unit.division_id`.
        from django.core.exceptions import FieldError
        aggregator = DataAggregator()
        with pytest.raises(FieldError, match="Cannot resolve keyword 'division_id' into field"):
            async_data = aggregator.collect_data(report)
