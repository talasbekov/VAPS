"""UC-ADM-006: real API boundaries and account/employee ownership."""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.operations.models import Role, UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db

@pytest.fixture
def branches():
    root = Division.objects.create(name="Root", code="ONBOARD_ROOT", division_type="organization")
    own = Division.objects.create(name="Own", code="ONBOARD_OWN", parent=root, division_type="department")
    leaf = Division.objects.create(name="Leaf", code="ONBOARD_LEAF", parent=own, division_type="division")
    other = Division.objects.create(name="Foreign", code="ONBOARD_OTHER", parent=root, division_type="department")
    return root, own, leaf, other


def test_division_reads_require_permission_and_filter_tree(branches):
    root, own, leaf, other = branches
    denied, _ = client_for("no_read")
    for path in ["/api/divisions/divisions_tree/", "/api/divisions/divisions/"]:
        assert denied.get(path).status_code == 403
    scoped, _ = client_for("scoped", "SCOPED_READ", ["orgstructure.view"], own.pk)
    response = scoped.get("/api/divisions/divisions_tree/")
    assert response.status_code == 200, response.content
    assert response.json()["id"] == own.pk
    assert response.json()["parent"] is None
    assert [x["id"] for x in response.json()["children"]] == [leaf.pk]
    assert scoped.get(f"/api/divisions/divisions/{other.pk}/").status_code == 404
    response = scoped.get("/api/divisions/divisions/")
    data = response.json()
    rows = data["results"] if isinstance(data, dict) else data
    assert {row["id"] for row in rows} == {own.pk, leaf.pk}
    admin, _ = client_for("access", "ACCESS_ADMIN", ["admin.roles"])
    assert admin.get("/api/divisions/divisions_tree/").json()["id"] == root.pk


@pytest.mark.parametrize("codes,expected_status", [
    (["admin.roles"], 403),
    (["*"], 200),
    (["admin.roles", "orgstructure.view"], 200),
])
def test_scoped_admin_does_not_expand_division_tree(branches, codes, expected_status):
    root, own, leaf, other = branches
    client, _ = client_for("tree_scope_admin", "TREE_SCOPE_ADMIN", codes, own.pk)
    response = client.get("/api/divisions/divisions_tree/")
    assert response.status_code == expected_status, response.content
    if expected_status == 200:
        assert response.json()["id"] == own.pk
        assert response.json()["parent"] is None
        assert [child["id"] for child in response.json()["children"]] == [leaf.pk]


def test_absence_statistics_use_grant_without_employee_link(branches):
    _, own, leaf, other = branches
    scoped, user = client_for("status_reader", "STATUS_READ", ["status.view"], own.pk)
    employees = []
    for index, division in enumerate([own, leaf, other], 1):
        employee = Employee.objects.create(personnel_number=f"ONBOARD{index}", last_name=f"Employee{index}")
        StaffUnit.objects.create(division=division, employee=employee, index=index)
        employees.append(employee)
    EmployeeStatus.objects.filter(employee__in=employees).update(status_type="vacation", start_date=timezone.localdate())
    response = scoped.get("/api/statuses/statuses/absence_statistics/")
    assert response.status_code == 200, response.content
    assert response.json()["staff_count"] == 2
    for action in ["planned", "history"]:
        assert scoped.get(f"/api/statuses/statuses/{action}/", {"employee_id": employees[-1].pk}).status_code == 403
    response = scoped.get("/api/statuses/statuses/")
    assert response.status_code == 200
    assert str(employees[-1].pk) not in {str(row["employee"]) for row in response.json()["results"]}


def test_employee_link_is_exclusive_audited_and_can_be_removed():
    admin, actor = client_for("account_admin", "ACCOUNT_ADMIN", ["admin.roles"])
    target = get_user_model().objects.create_user(username="target")
    other = get_user_model().objects.create_user(username="other")
    employee = Employee.objects.create(personnel_number="LINK1", last_name="Worker")
    path = f"/api/operations/accounts/{target.pk}/"
    response = admin.patch(path, {"employee_id": employee.pk}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["employee_id"] == employee.pk
    assert Employee.objects.get(pk=employee.pk).user_id == target.pk
    event = OpsAuditLog.objects.get(action="ACCESS_ACCOUNT_EMPLOYEE_LINKED", entity_id=target.pk)
    assert event.actor_user_id == str(actor.pk)
    assert event.new_value["employee_id"] == employee.pk
    response = admin.patch(f"/api/operations/accounts/{other.pk}/", {"employee_id": employee.pk}, format="json")
    assert response.status_code == 400
    assert admin.patch(path, {"first_name": "Changed"}, format="json").status_code == 200
    assert Employee.objects.get(pk=employee.pk).user_id == target.pk
    assert admin.patch(path, {"employee_id": None}, format="json").status_code == 200
    assert Employee.objects.get(pk=employee.pk).user_id is None
    denied, _ = client_for("no_admin")
    assert denied.patch(path, {"employee_id": employee.pk}, format="json").status_code == 403
    assert denied.get("/api/operations/accounts/employee-options/").status_code == 403
    assert admin.get("/api/operations/accounts/employee-options/", {"search": "Worker"}).json()["count"] == 1


def test_role_assignment_rejects_missing_user_and_scoped_wildcard(branches):
    _, own, _, _ = branches
    admin, user = client_for("grant_admin", "GRANT_ADMIN", ["*"])
    Role.objects.create(code="EMPTY_ROLE", name="Empty")
    url = "/api/operations/user-roles/"
    for invalid in ["not-a-user", "999999999999999999999999999999999999"]:
        assert admin.post(url, {"user_id": invalid, "role_code": "EMPTY_ROLE"}, format="json").status_code == 400
    assert admin.post(url, {"user_id": str(user.pk), "role_code": "GRANT_ADMIN", "scope_division_id": own.pk}, format="json").status_code == 400
    assert not UserRole.objects.filter(role_code_id="GRANT_ADMIN", scope_division_id=own.pk).exists()


def test_menu_permission_codes_exist_and_have_server_guards():
    import re
    from pathlib import Path
    from organization_management.apps.operations.management.commands.seed_operations import PERMISSIONS
    from organization_management.apps.ops.access_catalog import catalog
    applications = Path(__file__).resolve().parents[5]
    frontend = next(applications / name for name in ("frontend", "PersonalRecordFront") if (applications / name).is_dir())
    source = frontend / "entities/portal-access/index.ts"
    text = source.read_text(encoding="utf-8").split("export const MODULE_PERMISSION =", 1)[1].split("} as const", 1)[0]
    text = re.sub(r"//[^\n]*", "", text)
    codes = set(re.findall(r'"([a-z_]+\.[a-z_]+)"', text))
    known = {row[0] for row in PERMISSIONS}
    assert codes <= known
    guarded = set(catalog())
    assert codes <= guarded
