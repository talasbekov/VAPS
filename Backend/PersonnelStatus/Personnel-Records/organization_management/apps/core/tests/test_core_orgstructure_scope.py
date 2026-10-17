"""Core aliases must enforce the same grant scope as the structure tree."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, seed_role
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db
PATHS = ("divisions", "staffing-slots", "vacancies")


@pytest.fixture
def structure():
    root = Division.objects.create(name="Scope root", code="CS-ROOT")
    own = Division.objects.create(name="Own department", code="CS-OWN", parent=root)
    child = Division.objects.create(name="Own child", code="CS-CHILD", parent=own)
    foreign = Division.objects.create(name="Foreign department", code="CS-FOREIGN", parent=root)
    divisions = {"root": root, "own": own, "child": child, "foreign": foreign}
    slots = {key: StaffUnit.objects.create(division=node, index=index)
             for index, (key, node) in enumerate(divisions.items(), start=1)}
    return divisions, slots


def rows(response):
    assert response.status_code == 200, response.content
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


@pytest.mark.parametrize("resource", PATHS)
@pytest.mark.parametrize("permission", ("orgstructure.view", "*"))
def test_scoped_structure_reads_exclude_sibling_and_ancestor(structure, resource, permission):
    divisions, slots = structure
    api, _ = client_for("core-scope-reader", "CORE_SCOPE_READER", [permission], divisions["own"].pk)
    objects = divisions if resource == "divisions" else slots
    url = f"/api/core/{resource}/"
    assert {row["id"] for row in rows(api.get(url))} == {objects["own"].pk, objects["child"].pk}
    for key in ("own", "child"):
        assert api.get(f"{url}{objects[key].pk}/").status_code == 200
    for key in ("foreign", "root"):
        assert api.get(f"{url}{objects[key].pk}/").status_code == 404


@pytest.mark.parametrize("resource", PATHS)
def test_global_structure_grant_preserves_all_rows_and_details(structure, resource):
    divisions, slots = structure
    api, _ = client_for("core-global-reader", "CORE_GLOBAL_READER", ["orgstructure.view"])
    objects = divisions if resource == "divisions" else slots
    url = f"/api/core/{resource}/"
    assert {obj.pk for obj in objects.values()} <= {row["id"] for row in rows(api.get(url))}
    assert api.get(f"{url}{objects['foreign'].pk}/").status_code == 200


@pytest.mark.parametrize("resource", PATHS)
def test_unrelated_global_grant_cannot_widen_scoped_structure_read(structure, resource):
    divisions, slots = structure
    api, user = client_for("core-mixed-reader", "CORE_MIXED_READER", ["orgstructure.view"], divisions["own"].pk)
    seed_role("CORE_GLOBAL_PERSONNEL", ["personnel.view"])
    RoleAdminService.assign_role(str(user.pk), "CORE_GLOBAL_PERSONNEL", None, actor="test")
    objects = divisions if resource == "divisions" else slots
    assert {row["id"] for row in rows(api.get(f"/api/core/{resource}/"))} == {objects["own"].pk, objects["child"].pk}


def test_vacancy_division_filter_intersects_authorized_scope(structure):
    divisions, slots = structure
    api, _ = client_for("core-vacancy-reader", "CORE_VACANCY_READER", ["orgstructure.view"], divisions["own"].pk)
    assert rows(api.get(f"/api/core/vacancies/?division_id={divisions['foreign'].pk}")) == []
    assert [row["id"] for row in rows(api.get(f"/api/core/vacancies/?division_id={divisions['child'].pk}"))] == [slots["child"].pk]


def test_scoped_division_keeps_contract_parent_ids_without_expanding_parent_record(structure):
    divisions, _ = structure
    api, _ = client_for("core-parent-reader", "CORE_PARENT_READER", ["orgstructure.view"], divisions["own"].pk)
    row = api.get(f"/api/core/divisions/{divisions['own'].pk}/").json()
    assert row["parent"] == divisions["root"].pk
    assert row["organization"] == divisions["root"].pk
    assert row["name"] == divisions["own"].name
    assert api.get(f"/api/core/divisions/{row['parent']}/").status_code == 404
