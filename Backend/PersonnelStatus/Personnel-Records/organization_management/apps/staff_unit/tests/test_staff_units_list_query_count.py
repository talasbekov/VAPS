"""The complete staffing list must not query relations for every slot.

Removing any relation preload or the active-status prefetch must break the
query budget. The payload checks guard against reducing queries by omitting
people, nullable slots, or the actual ACTIVE status.
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import Permission, Role, RolePermission, StatusType
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit, Vacancy
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def scene():
    root = Division.objects.create(
        name="Служба", code="list-query-root", division_type="organization",
    )
    department = Division.objects.create(
        name="Департамент", code="list-query-dept", division_type="department", parent=root,
    )
    own = Division.objects.create(
        name="Своё управление", code="list-query-own", division_type="directorate", parent=department,
    )
    foreign = Division.objects.create(
        name="Чужое управление", code="list-query-foreign", division_type="directorate", parent=department,
    )
    position = Position.objects.create(name="Инспектор", code="list-query-position", level=8)
    return {"own": own, "foreign": foreign, "position": position}


@pytest.fixture
def admin_client():
    client = APIClient()
    client.force_authenticate(get_user_model().objects.create_superuser(username="list-query-admin"))
    return client


def create_slots(division, position, count, prefix):
    # Explicit history avoids employee-creation signals adding background
    # statuses to a fixture whose read semantics we need to control.
    employees = Employee.objects.bulk_create([
        Employee(
            personnel_number=f"{prefix}-{index}", first_name="Имя", last_name=f"Фамилия{index}",
            hire_date=date(2000, 1, 1), birth_date=date(1980, 1, 1),
        )
        for index in range(count)
    ])
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(
            employee=employee, status_type="vacation", state="active",
            start_date=date(2000, 1, 2), end_date=date(2000, 1, 5),
        )
        for employee in employees
    ])
    return [
        StaffUnit.objects.create(
            division=division, position=position, employee=employee, index=index,
        )
        for index, employee in enumerate(employees, 1)
    ]


@pytest.mark.parametrize("page_size", [10, 50, 100])
def test_list_query_count_is_bounded_as_the_page_grows(scene, admin_client, page_size):
    units = create_slots(scene["own"], scene["position"], page_size + 1, "list-bound")

    with CaptureQueriesContext(connection) as queries:
        response = admin_client.get(reverse("staffunit-list"), {"page_size": page_size})

    assert response.status_code == 200, response.data
    payload = response.data
    assert payload["count"] == page_size + 1
    assert payload["next"] is not None
    assert {row["id"] for row in payload["results"]} == {unit.pk for unit in units[:page_size]}
    for row in payload["results"]:
        assert row["division"] == {"id": scene["own"].pk, "name": "Своё управление"}
        assert row["position"]["id"] == scene["position"].pk
        assert row["employee"]["id"] is not None
        assert row["employee"]["current_status"] == {
            "status_type": "vacation", "state": "active",
            "start_date": "2000-01-02", "end_date": "2000-01-05",
        }
        assert row["vacancy"] is None
    assert len(queries) <= 4, f"{page_size} slots required {len(queries)} SQL queries"


def test_list_keeps_nullable_relations_and_the_vacancy_payload(scene, admin_client):
    person = Employee.objects.bulk_create([
        Employee(personnel_number="list-null-person", first_name="Имя", last_name="Без статуса"),
    ])[0]
    occupied = StaffUnit.objects.create(division=scene["own"], employee=person, index=1)
    vacancy = Vacancy.objects.create(
        status="open", requirements="Требования", responsibilities="Обязанности",
    )
    unfilled = StaffUnit.objects.create(
        division=scene["own"], position=scene["position"], vacancy=vacancy, index=2,
    )
    unclassified = StaffUnit.objects.create(index=3)

    response = admin_client.get(reverse("staffunit-list"), {"page_size": 50})

    assert response.status_code == 200, response.data
    assert response.data["count"] == 3
    rows = {row["id"]: row for row in response.data["results"]}
    assert set(rows) == {occupied.pk, unfilled.pk, unclassified.pk}
    assert rows[occupied.pk]["position"] is None
    assert rows[occupied.pk]["vacancy"] is None
    assert rows[occupied.pk]["employee"] == {
        "id": person.pk, "first_name": "Имя", "last_name": "Без статуса",
        "current_status": None, "rank": None, "photo_url": None,
    }
    assert rows[unfilled.pk]["employee"] is None
    assert rows[unfilled.pk]["vacancy"]["id"] == vacancy.pk
    assert rows[unfilled.pk]["vacancy"]["requirements"] == "Требования"
    assert rows[unfilled.pk]["vacancy"]["responsibilities"] == "Обязанности"
    for field in ("division", "position", "employee", "vacancy", "parent_id"):
        assert rows[unclassified.pk][field] is None


def test_list_uses_the_latest_active_status_even_when_its_period_has_expired(scene, admin_client):
    unit = create_slots(scene["own"], scene["position"], 1, "list-status")[0]
    employee = unit.employee
    statuses = EmployeeStatus.objects.bulk_create([
        EmployeeStatus(
            employee=employee, status_type=code, state=state,
            start_date=start, end_date=start + timedelta(days=3),
        )
        for code, state, start in [
            ("training", "active", date(2000, 2, 1)),
            ("sick_leave", "active", date(2000, 2, 1)),
            ("business_trip", "planned", date(2099, 1, 1)),
            ("conference", "completed", date(2098, 1, 1)),
            ("other_absence", "cancelled", date(2097, 1, 1)),
        ]
    ])
    # Same start_date: created_at must still choose the later ACTIVE record.
    now = timezone.now()
    EmployeeStatus.objects.filter(pk=statuses[0].pk).update(created_at=now - timedelta(days=1))
    EmployeeStatus.objects.filter(pk=statuses[1].pk).update(created_at=now)

    response = admin_client.get(reverse("staffunit-list"))

    assert response.status_code == 200, response.data
    assert response.data["results"][0]["employee"]["current_status"] == {
        "status_type": "sick_leave", "state": "active",
        "start_date": "2000-02-01", "end_date": "2000-02-04",
    }


def test_patch_reports_the_active_status_it_has_just_created(scene, admin_client):
    StatusType.objects.get_or_create(
        code="sick_leave",
        defaults={"name": "На больничном", "priority": 10, "report_column_code": "SICK"},
    )
    person = Employee.objects.bulk_create([
        Employee(
            personnel_number="list-patch-person", first_name="Имя", last_name="Новый статус",
            hire_date=date(2000, 1, 1),
        ),
    ])[0]
    unit = StaffUnit.objects.create(
        division=scene["own"], position=scene["position"], employee=person, index=1,
    )
    assert not person.statuses.exists()
    today = timezone.localdate()
    tomorrow = today + timedelta(days=1)

    response = admin_client.patch(
        reverse("staffunit-detail", args=[unit.pk]),
        {"employee_statuses": [{
            "employee_id": person.pk, "status_type": "sick_leave", "state": "active",
            "start_date": today.isoformat(), "end_date": tomorrow.isoformat(),
        }]},
        format="json",
    )

    assert response.status_code == 200, response.data
    stored = EmployeeStatus.objects.get(employee=person, state="active")
    assert stored.status_type == "sick_leave"
    assert stored.start_date == today
    assert stored.end_date == tomorrow
    assert response.data["employee"]["current_status"] == {
        "status_type": "sick_leave", "state": "active",
        "start_date": today.isoformat(), "end_date": tomorrow.isoformat(),
    }


def test_list_preloading_preserves_the_reading_grant_scope(scene):
    child = Division.objects.create(
        name="Свой отдел", code="list-query-child", division_type="division", parent=scene["own"],
    )
    own = create_slots(scene["own"], scene["position"], 2, "list-own")
    descendants = create_slots(child, scene["position"], 2, "list-child")
    foreign = create_slots(scene["foreign"], scene["position"], 2, "list-foreign")
    user = get_user_model().objects.create_user(username="list-query-reader")
    role = Role.objects.create(code="LIST_QUERY_READER", name="Читатель штатки")
    permission, _ = Permission.objects.get_or_create(
        code="orgstructure.view", defaults={"name": "Просмотр структуры"},
    )
    RolePermission.objects.create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(str(user.pk), role.code, scene["own"].pk, actor="test")
    client = APIClient()
    client.force_authenticate(user)

    response = client.get(reverse("staffunit-list"), {"page_size": 50})

    assert response.status_code == 200, response.data
    assert response.data["count"] == 4
    assert {row["id"] for row in response.data["results"]} == {
        unit.pk for unit in own + descendants
    }
    assert client.get(reverse("staffunit-detail", args=[foreign[0].pk])).status_code == 404
