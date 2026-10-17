"""The UI must use the same authority as the acknowledgement endpoint."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, seed_role
from organization_management.apps.ops import my_assignments
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_my_assignments import placed, on_acknowledgement
from .test_ops_security_events_api import make_employee, manager  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("endpoint", ["event", "profile"])
@pytest.mark.parametrize("case,expected", [
    ("own", True), ("foreign", False), ("unscoped", False),
    ("reader", False), ("inactive_role", False), ("linked", False),
    ("without_staff", False), ("inactive_employee", False),
])
def test_confirmation_capability_matches_real_unit_head_authority(manager, endpoint, case, expected):  # noqa: F811
    home = Division.objects.create(name="Capability home", division_type=Division.DivisionType.DIRECTORATE)
    section = Division.objects.create(name="Capability section", parent=home, division_type=Division.DivisionType.DIVISION)
    foreign = Division.objects.create(name="Capability foreign", division_type=Division.DivisionType.DIRECTORATE)
    employee = make_employee("Capability", "Employee")
    if case != "without_staff":
        StaffUnit.objects.create(division=section, employee=employee, index=1)
    base, assignment_id = placed(manager, employee)
    event = on_acknowledgement(base)
    # A reader can inspect all these rows. Reading a profile must not grant
    # the right to answer for its owner, even with global status.manage.
    client, user = client_for("capability-viewer", "CAPABILITY_READER", perms=("event.view", "status.manage"))
    if case != "reader":
        seed_role("DIRECTORATE_HEAD", ())
        scope = foreign.pk if case == "foreign" else None if case == "unscoped" else home.pk
        RoleAdminService.assign_role(str(user.pk), "DIRECTORATE_HEAD", scope, actor="test")
        if case == "inactive_role":
            UserRole.objects.filter(user_id=str(user.pk), role_code_id="DIRECTORATE_HEAD").update(is_active=False)
    if case == "linked":
        _, account = client_for("capability-owner")
        employee.user = account
        employee.save(update_fields=["user"])
    elif case == "inactive_employee":
        employee.is_active = False
        employee.save(update_fields=["is_active"])
    assert (my_assignments.acknowledgement_authority(event, assignment_id, user.pk) == "unit_head") is expected
    if endpoint == "event":
        response = client.get(base)
        assert response.status_code == 200, response.content
        row = response.json()["placementAssignments"][0]
    else:
        response = client.get(f"/api/ops/security-events/my-assignments/?employee={employee.pk}")
        assert response.status_code == 200, response.content
        row = response.json()["results"][0]
    assert row.get("canConfirmWithoutAccount") is expected, row


def test_bulk_authority_respects_sibling_scopes_and_refreshed_identity(django_assert_num_queries):
    root = Division.objects.create(name="Shared root", division_type=Division.DivisionType.DEPARTMENT)
    own = Division.objects.create(name="Own", parent=root, division_type=Division.DivisionType.DIRECTORATE)
    sibling = Division.objects.create(name="Sibling", parent=root, division_type=Division.DivisionType.DIRECTORATE)
    _, user = client_for("bulk-capability-head", "DIRECTORATE_HEAD", perms=(), scope_division_id=own.pk)
    employees = []
    for index in range(12):
        employee = make_employee(f"Bulk-{index}", "Employee")
        StaffUnit.objects.create(division=own if index < 6 else sibling, employee=employee, index=index)
        employees.append(employee)
    ids = [str(employee.pk) for employee in employees]
    with django_assert_num_queries(2):
        authorities = my_assignments.confirmation_authorities(ids, user.pk)
    assert [authorities[key] for key in ids] == ["unit_head"] * 6 + [None] * 6
    # A new request must observe transfers, linked accounts and revoked roles.
    StaffUnit.objects.filter(employee=employees[0]).update(division=sibling)
    employees[1].user = user
    employees[1].save(update_fields=["user"])
    changed = my_assignments.confirmation_authorities(ids, user.pk)
    assert changed[ids[0]] is None
    assert changed[ids[1]] == "self"
    assert changed[ids[2]] == "unit_head"
    UserRole.objects.filter(user_id=str(user.pk), role_code_id="DIRECTORATE_HEAD").update(is_active=False)
    revoked = my_assignments.confirmation_authorities(ids, user.pk)
    assert revoked[ids[1]] == "self"
    assert all(value is None for key, value in revoked.items() if key != ids[1])
