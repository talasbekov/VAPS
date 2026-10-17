"""Bulk slot changes reject stale references without saving any earlier row."""
import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_staffing_section_permissions import tree
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
MISSING = 2147483647


@pytest.fixture
def bulk(tree):
    user = get_user_model().objects.create_superuser(username="bulk-reference-admin", password="test")
    api = APIClient(raise_request_exception=False)
    api.force_authenticate(user)
    parent = tree["units"]["left"]
    child = StaffUnit.objects.create(division=parent.division, position=parent.position, parent=parent, index=3)
    person = Employee.objects.create(personnel_number="BULK-REF", last_name="Reference")
    return api, parent, child, person


def post_status(person):
    return {"employee_id": person.pk, "start_date": timezone.localdate().isoformat(), "end_date": None}


@pytest.mark.parametrize("target,field", [
    ("parent", field) for field in ["division", "position", "employee", "vacancy", "parent_id"]
] + [
    ("child", field) for field in ["id", "division", "position", "employee", "vacancy", "parent_id"]
] + [
    ("new-child", field) for field in ["division", "position", "employee", "vacancy", "parent_id"]
] + [("status", "employee_id")])
def test_stale_reference_is_400_and_rolls_back_entire_bulk(bulk, target, field):
    api, parent, child, person = bulk
    body = {"index": 91, "children": [{"id": child.pk, "index": 92}], "employee_statuses": [post_status(person)]}
    if target == "parent":
        body[field] = MISSING
    elif target == "child":
        body["children"].append({"id": child.pk, field: MISSING})
    elif target == "new-child":
        body["children"].append({"division": parent.division_id, "position": parent.position_id, field: MISSING})
    else:
        body["employee_statuses"].append({**post_status(person), field: MISSING})
    before = list(StaffUnit.objects.order_by("pk").values())
    status_before = list(EmployeeStatus.objects.order_by("pk").values())
    response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", body, format="json")
    assert response.status_code == 400, response.content[:1000]
    assert list(StaffUnit.objects.order_by("pk").values()) == before
    assert list(EmployeeStatus.objects.order_by("pk").values()) == status_before


@pytest.mark.parametrize("field", ["division", "position"])
def test_new_child_requires_assignment_fields(bulk, field):
    api, parent, _, _ = bulk
    child = {"division": parent.division_id, "position": parent.position_id}
    del child[field]
    response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", {"index": 91, "children": [child]}, format="json")
    assert response.status_code == 400, response.content[:1000]
    parent.refresh_from_db()
    assert parent.index != 91


@pytest.mark.parametrize("target", ["parent", "child", "new-child"])
def test_new_inactive_position_assignment_is_rejected(bulk, target):
    api, parent, child, _ = bulk
    inactive = Position.objects.create(code="BULK-INACTIVE", name="Inactive", level=9, is_active=False)
    body = {"index": 91, "children": []}
    if target == "parent":
        body["position"] = inactive.pk
    else:
        body["children"] = [{"id": child.pk, "position": inactive.pk}] if target == "child" else [{"division": parent.division_id, "position": inactive.pk}]
    response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", body, format="json")
    assert response.status_code == 400, response.content[:1000]
    parent.refresh_from_db()
    child.refresh_from_db()
    assert parent.index != 91
    assert child.position_id != inactive.pk


def test_current_inactive_position_nullable_values_and_import_fields_survive(bulk):
    api, parent, child, person = bulk
    parent.position.is_active = False
    parent.position.save()
    parent.external_id, parent.import_order = "import-bulk-reference", 17
    parent.save()
    response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", {
        "position": parent.position_id, "index": 91, "employee": None, "vacancy": None, "parent_id": None,
        "children": [{"id": child.pk, "position": child.position_id, "index": 92}],
        "employee_statuses": [post_status(person)],
    }, format="json")
    assert response.status_code == 200, response.content[:1000]
    parent.refresh_from_db()
    child.refresh_from_db()
    assert (parent.index, child.index) == (91, 92)
    assert (parent.external_id, parent.import_order) == ("import-bulk-reference", 17)
    assert parent.employee_id is None and parent.vacancy_id is None and parent.parent_id is None
    assert EmployeeStatus.objects.filter(employee=person, end_date__isnull=True).exists()


def test_reference_locks_use_model_and_pk_order_even_when_children_are_reversed(bulk):
    api, parent, child, person = bulk
    second = StaffUnit.objects.create(division=parent.division, position=parent.position, parent=parent, index=4)
    with CaptureQueriesContext(connection) as queries:
        response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", {
            "division": parent.division_id, "position": parent.position_id,
            "children": [{"id": second.pk, "index": 94}, {"id": child.pk, "index": 93}],
            "employee_statuses": [post_status(person)],
        }, format="json")
    assert response.status_code == 200, response.content[:1000]
    models = sorted([type(parent.division), Position, Employee, StaffUnit], key=lambda model: model._meta.label_lower)
    locks = [query["sql"] for query in queries if "FOR UPDATE" in query["sql"]]
    assert len(locks) == len(models)
    for sql, model in zip(locks, models):
        assert f'FROM "{model._meta.db_table}"' in sql
        assert f'ORDER BY "{model._meta.db_table}"."id" ASC' in sql


@pytest.mark.parametrize("change", ["position", "division", "deleted"])
def test_root_is_revalidated_after_change_between_initial_read_and_lock(bulk, tree, monkeypatch, change):
    from organization_management.apps.staff_unit import views
    from organization_management.apps.staff_unit.tests.test_staff_write_target_scope import client
    api, parent, _, _ = bulk
    body = {"index": 91, "children": []}
    expected = 400
    if change == "position":
        Position.objects.filter(pk=parent.position_id).update(is_active=False)
        replacement = Position.objects.create(code="BULK-CONCURRENT", name="Current replacement", level=9)
        body["position"] = parent.position_id
    elif change == "division":
        api = client(tree)
        expected = 403
    original_lock = views._lock_bulk_references

    def change_before_lock(attrs, instance):
        # Deterministically simulate a committed change after get_object(),
        # before SELECT FOR UPDATE; the in-memory instance stays stale.
        if change == "position":
            StaffUnit.objects.filter(pk=instance.pk).update(position=replacement)
        elif change == "division":
            StaffUnit.objects.filter(pk=instance.pk).update(division=tree["right"])
        else:
            StaffUnit.objects.filter(pk=instance.pk).delete()
        return original_lock(attrs, instance)

    monkeypatch.setattr(views, "_lock_bulk_references", change_before_lock)
    response = api.patch(f"/api/staff_unit/staff-units/{parent.pk}/", body, format="json")
    assert response.status_code == expected, response.content[:1000]
    parent.refresh_from_db()
    assert parent.index != 91
