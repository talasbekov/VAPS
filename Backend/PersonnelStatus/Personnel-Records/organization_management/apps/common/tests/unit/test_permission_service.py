import pytest
from unittest.mock import MagicMock
from django.contrib.auth import get_user_model
from organization_management.apps.common.services.permissions import PermissionService
from organization_management.apps.divisions.models import Division
from organization_management.apps.reports.models import Report
from organization_management.apps.common.models import Role, UserRole

User = get_user_model()

@pytest.fixture
def superuser():
    return User(id=1, is_superuser=True)

@pytest.fixture
def user_no_role():
    return User(id=2, is_superuser=False)

@pytest.mark.django_db
class TestPermissionService:

    @pytest.fixture
    def setup_divisions(self):
        root = Division.objects.create(name="Root", code="root", division_type=Division.DivisionType.DEPARTMENT)
        child = Division.objects.create(name="Child", code="child", division_type=Division.DivisionType.DIRECTORATE, parent=root)
        grandchild = Division.objects.create(name="Grandchild", code="gc", division_type=Division.DivisionType.DIVISION, parent=child)
        unrelated = Division.objects.create(name="Unrelated", code="ur", division_type=Division.DivisionType.DEPARTMENT)

        return {
            "root": root,
            "child": child,
            "grandchild": grandchild,
            "unrelated": unrelated
        }

    @pytest.fixture
    def user_with_role(self, setup_divisions):
        user = User.objects.create(username="testuser")
        role = Role.objects.create(code="ROLE_2", name="Dir Head", hierarchy_level=2)
        UserRole.objects.create(
            user=user,
            role=role,
            scope_division=setup_divisions["child"],
        )
        # Ensure role_info is accessible
        user.refresh_from_db()
        return user

    def test_get_user_division_with_role(self, user_with_role, setup_divisions):
        division = PermissionService.get_user_division(user_with_role)
        assert division == setup_divisions["child"]

    def test_get_user_division_no_role(self, user_no_role):
        division = PermissionService.get_user_division(user_no_role)
        assert division is None

    def test_get_accessible_divisions_superuser(self, superuser, setup_divisions):
        divisions = PermissionService.get_accessible_divisions(superuser)
        assert divisions.count() == 4

    def test_get_accessible_divisions_no_role(self, user_no_role, setup_divisions):
        divisions = PermissionService.get_accessible_divisions(user_no_role)
        assert divisions.count() == 0

    def test_get_accessible_divisions_with_role(self, user_with_role, setup_divisions):
        divisions = PermissionService.get_accessible_divisions(user_with_role)
        assert divisions.count() == 2
        division_ids = list(divisions.values_list("id", flat=True))
        assert setup_divisions["child"].id in division_ids
        assert setup_divisions["grandchild"].id in division_ids
        assert setup_divisions["root"].id not in division_ids

    def test_can_access_division(self, user_with_role, superuser, setup_divisions):
        assert PermissionService.can_access_division(superuser, setup_divisions["root"].id) is True

        assert PermissionService.can_access_division(user_with_role, setup_divisions["child"].id) is True
        assert PermissionService.can_access_division(user_with_role, setup_divisions["grandchild"].id) is True
        assert PermissionService.can_access_division(user_with_role, setup_divisions["root"].id) is False
        assert PermissionService.can_access_division(user_with_role, setup_divisions["unrelated"].id) is False

    def test_can_access_report_created_by_user(self, user_with_role, setup_divisions):
        # Even if report is for an unrelated division, owner can access
        report = Report.objects.create(
            created_by=user_with_role,
            division=setup_divisions["unrelated"],
            report_type=Report.ReportType.PERSONNEL_ROSTER,
            status=Report.JobStatus.COMPLETED
        )
        assert PermissionService.can_access_report(user_with_role, report) is True

    def test_can_access_report_in_division_scope(self, user_with_role, superuser, setup_divisions):
        other_user = User.objects.create(username="other")

        # Report created by someone else, but in user's division scope
        report1 = Report.objects.create(
            created_by=other_user,
            division=setup_divisions["child"],
            report_type=Report.ReportType.PERSONNEL_ROSTER,
            status=Report.JobStatus.COMPLETED,
            job_id="job_1"
        )
        assert PermissionService.can_access_report(user_with_role, report1) is True
        assert PermissionService.can_access_report(superuser, report1) is True

        # Report created by someone else, NOT in user's division scope
        report2 = Report.objects.create(
            created_by=other_user,
            division=setup_divisions["root"],
            report_type=Report.ReportType.PERSONNEL_ROSTER,
            status=Report.JobStatus.COMPLETED,
            job_id="job_2"
        )
        assert PermissionService.can_access_report(user_with_role, report2) is False
        assert PermissionService.can_access_report(superuser, report2) is True
