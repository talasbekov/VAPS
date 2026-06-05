import pytest
from django.contrib.auth import get_user_model
from organization_management.apps.common.models import Role, UserRole
from organization_management.apps.divisions.models import Division
from organization_management.apps.common.services.permissions import PermissionService

User = get_user_model()

@pytest.fixture
def structure():
    department = Division.objects.create(name="Department", code="dept", division_type=Division.DivisionType.DEPARTMENT)
    directorate = Division.objects.create(name="Directorate", code="dir", division_type=Division.DivisionType.DIRECTORATE, parent=department)
    division = Division.objects.create(name="Division", code="div", division_type=Division.DivisionType.DIVISION, parent=directorate)
    return department, directorate, division

@pytest.fixture
def roles():
    r1 = Role.objects.create(code="ROLE_1", name="Обсервер орг", requires_scope=False)
    r2 = Role.objects.create(code="ROLE_2", name="Обсервер деп", requires_scope=True)
    r3 = Role.objects.create(code="ROLE_3", name="Нач Упр", requires_scope=True)
    r4 = Role.objects.create(code="ROLE_4", name="Сисадмин", requires_scope=False)
    r5 = Role.objects.create(code="ROLE_5", name="Кадровик", requires_scope=False)
    r6 = Role.objects.create(code="ROLE_6", name="Нач Отдела", requires_scope=True)
    r7 = Role.objects.create(code="ROLE_7", name="Делопроизводитель", requires_scope=True)
    return {"ROLE_1": r1, "ROLE_2": r2, "ROLE_3": r3, "ROLE_4": r4, "ROLE_5": r5, "ROLE_6": r6, "ROLE_7": r7}

@pytest.mark.django_db
class TestPermissionService:

    def create_user_with_role(self, username, role_obj, scope=None):
        user = User.objects.create(username=username)
        UserRole.objects.create(user=user, role=role_obj, scope_division=scope)
        return user

    def test_missing_role_fails_safe(self):
        user = User.objects.create(username="norole")
        service = PermissionService(user)
        assert service.get_role_code() is None
        assert service.get_visible_divisions().count() == 0

    def test_role_4_sees_all(self, roles, structure):
        user = self.create_user_with_role("admin", roles["ROLE_4"])
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_4"
        assert service.get_visible_divisions().count() == 3

    def test_role_2_sees_department_subtree(self, roles, structure):
        department, directorate, division = structure
        # UserRole needs effective_scope_division via department for ROLE_2
        # Let's attach them to the directorate and it should automatically find the department
        user = self.create_user_with_role("dept_obs", roles["ROLE_2"], scope=directorate)
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_2"
        # Since department is the top, it sees department, directorate, and division
        divisions = service.get_visible_divisions()
        assert divisions.count() == 3
        assert department in divisions

    def test_role_3_sees_directorate_subtree(self, roles, structure):
        department, directorate, division = structure
        user = self.create_user_with_role("dir_head", roles["ROLE_3"], scope=directorate)
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_3"
        divisions = service.get_visible_divisions()
        assert divisions.count() == 2
        assert directorate in divisions
        assert division in divisions
        assert department not in divisions

    def test_role_6_sees_only_division(self, roles, structure):
        department, directorate, division = structure
        user = self.create_user_with_role("div_head", roles["ROLE_6"], scope=division)
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_6"
        divisions = service.get_visible_divisions()
        assert divisions.count() == 1
        assert division in divisions

    def test_role_7_sees_only_division(self, roles, structure):
        department, directorate, division = structure
        user = self.create_user_with_role("clerk", roles["ROLE_7"], scope=division)
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_7"
        divisions = service.get_visible_divisions()
        assert divisions.count() == 1
        assert division in divisions

    def test_role_1_sees_all(self, roles, structure):
        user = self.create_user_with_role("obs_org", roles["ROLE_1"])
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_1"
        assert service.get_visible_divisions().count() == 3

    def test_role_5_sees_all(self, roles, structure):
        user = self.create_user_with_role("hr", roles["ROLE_5"])
        service = PermissionService(user)
        assert service.get_role_code() == "ROLE_5"
        assert service.get_visible_divisions().count() == 3

    def test_filter_helpers(self, roles, structure):
        # We will use ROLE_6 to verify filtering works strictly on division scoping
        department, directorate, division = structure
        user = self.create_user_with_role("div_head", roles["ROLE_6"], scope=division)
        service = PermissionService(user)

        from organization_management.apps.staff_unit.models import StaffUnit
        from organization_management.apps.employees.models import Employee
        from organization_management.apps.statuses.models import EmployeeStatus
        from django.utils import timezone
        from datetime import timedelta

        # Create staff units
        su_dept = StaffUnit.objects.create(division=department, index=1)
        su_div = StaffUnit.objects.create(division=division, index=1)

        # Create employees
        emp_dept = Employee.objects.create(personnel_number="A01"); su_dept.employee = emp_dept; su_dept.save()
        emp_div = Employee.objects.create(personnel_number="B01"); su_div.employee = emp_div; su_div.save()

        # Create statuses
        today = timezone.now().date()
        test_user = User.objects.create(username="status_creator")
        st_dept = EmployeeStatus.objects.create(employee=emp_dept, status_type=EmployeeStatus.StatusType.IN_SERVICE, state=EmployeeStatus.StatusState.ACTIVE, start_date=today, created_by=test_user)
        st_div = EmployeeStatus.objects.create(employee=emp_div, status_type=EmployeeStatus.StatusType.IN_SERVICE, state=EmployeeStatus.StatusState.ACTIVE, start_date=today, created_by=test_user)

        # Verify Staff Units
        qs_su = service.filter_staff_units(StaffUnit.objects.all())
        assert qs_su.count() == 1
        assert qs_su.first() == su_div

        # Verify Employees
        qs_emp = service.filter_employees(Employee.objects.all())
        assert qs_emp.count() == 1
        assert qs_emp.first() == emp_div

        # Verify Statuses
        qs_st = service.filter_statuses(EmployeeStatus.objects.all())
        assert qs_st.count() == 1
        assert qs_st.first() == st_div

        # Note: filter_secondments and filter_reports are complex to fixture here.
        # They will be covered in the view migration story (STORY-005).
