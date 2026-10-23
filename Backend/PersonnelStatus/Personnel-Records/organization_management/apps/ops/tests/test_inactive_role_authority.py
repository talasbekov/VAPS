"""Role definitions govern direct role authority as well as permission grants."""
import pytest
from django.contrib.auth.models import User

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import Role, UserRole
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import my_assignments, security_events
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_my_assignments import on_acknowledgement, placed
from .test_ops_security_events_api import manager  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("code", ["DIRECTORATE_HEAD", "HEAD_DIRECTORATE_LINE", "HEAD_OPS_UNIT"])
def test_disabled_head_role_revokes_confirmation_without_deleting_assignment(code):
    home = Division.objects.create(name="Definition head", division_type="directorate")
    employee = Employee.objects.create(personnel_number="definition-target", first_name="Target", last_name="Without account")
    StaffUnit.objects.create(division=home, employee=employee, index=1)
    _api, user = client_for("definition-head", code, scope_division_id=home.pk)
    grant = UserRole.objects.get(user_id=str(user.pk), role_code_id=code)
    assert my_assignments.confirmation_authorities([employee.pk], user.pk) == {str(employee.pk): "unit_head"}
    Role.objects.filter(pk=code).update(is_active=False)
    assert my_assignments.confirmation_authorities([employee.pk], user.pk) == {str(employee.pk): None}
    grant.refresh_from_db()
    assert grant.is_active
    Role.objects.filter(pk=code).update(is_active=True)
    assert my_assignments.confirmation_authorities([employee.pk], user.pk) == {str(employee.pk): "unit_head"}


def test_disabled_head_role_cannot_bypass_acknowledgement_api_permission(manager):  # noqa: F811
    home = Division.objects.create(name="API definition head", division_type="directorate")
    employee = Employee.objects.create(personnel_number="definition-api", first_name="Target", last_name="Without account")
    StaffUnit.objects.create(division=home, employee=employee, index=1)
    base, assignment_id = placed(manager, employee)
    event = on_acknowledgement(base)
    api, _user = client_for("definition-api-head", "DIRECTORATE_HEAD", scope_division_id=home.pk)
    body = {"deliveryMethod": "Verbally", "accountAbsenceBasis": "Account not created"}
    accepted = api.post(f"{base}acknowledge/{assignment_id}/", body, format="json")
    assert accepted.status_code == 200, accepted.content
    event.refresh_from_db()
    Role.objects.filter(pk="DIRECTORATE_HEAD").update(is_active=False)
    before = event.placement_assignments
    response = api.post(f"{base}acknowledge/{assignment_id}/", body, format="json")
    assert response.status_code == 403, response.content
    event.refresh_from_db()
    assert event.placement_assignments == before


def test_inactive_approval_role_is_not_a_candidate_for_new_authority():
    actor = User.objects.create_user("candidate-selector")
    candidate = User.objects.create_user("candidate-disabled")
    Employee.objects.create(personnel_number="definition-candidate", first_name="Candidate", last_name="Head", user=candidate)
    role, _ = Role.objects.update_or_create(code="HEAD_OPS_UNIT", defaults={"name": "Head", "is_active": True})
    UserRole.objects.create(user_id=str(candidate.pk), role_code=role)
    assert str(candidate.pk) in {row["userId"] for row in security_events.approval_candidates(actor=actor)}
    role.is_active = False
    role.save(update_fields=["is_active"])
    assert str(candidate.pk) not in {row["userId"] for row in security_events.approval_candidates(actor=actor)}
    role.is_active = True
    role.save(update_fields=["is_active"])
    assert str(candidate.pk) in {row["userId"] for row in security_events.approval_candidates(actor=actor)}
