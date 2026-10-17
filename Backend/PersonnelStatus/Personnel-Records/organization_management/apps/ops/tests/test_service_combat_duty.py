"""Service combat duty reads canonical statuses within the actor's duty scope."""
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
DAY = date(2026, 10, 7)
URL = "/api/ops/service-combat-duty/"


@pytest.fixture(autouse=True)
def catalog():
    call_command("seed_status_types", verbosity=0)
    for code, label, priority, column in [
        ("IN_SERVICE", "В строю", 999, "IN_SERVICE"),
        ("DUTY", "На дежурстве", 70, "ON_DUTY"),
        ("GEV", "Группа экстренного выезда", 75, "ON_DUTY"),
        ("SICK_LEAVE", "Больничный", 10, "SICK"),
        ("ATTACHED", "Прикомандирован", 90, "ATTACHED"),
        ("DETACHED", "Откомандирован", 100, "DETACHED"),
    ]:
        StatusType.objects.update_or_create(code=code, defaults={
            "name": label, "priority": priority, "report_column_code": column,
        })


@pytest.fixture
def departments():
    result = []
    for branch in ["A", "B"]:
        root = Division.objects.create(name=f"Organization {branch}", division_type="organization")
        department = Division.objects.create(name="Одинаковое имя", parent=root, division_type="department")
        directorate = Division.objects.create(name="Управление", parent=department, division_type="directorate")
        section = Division.objects.create(name="Отдел", parent=directorate, division_type="division")
        result.append((department, section))
    return result


def duty(employee, code="DUTY", **extra):
    fields = {
        "employee_id": employee.pk, "status_type_code": code,
        "date_start": DAY, "date_end": DAY + timedelta(days=2), "created_by": "test",
    }
    fields.update(extra)
    return OpsEmployeeStatus.objects.create(**fields)


def viewer(scope=None, permission="duty.view", name="combat-reader"):
    api, _ = client_for(name, f"ROLE_{name}", [permission], scope)
    return api


def read(api):
    return api.get(URL, {"business_date": DAY.isoformat()})


def test_all_departments_with_identical_names_keep_distinct_ids(departments):
    (left, left_section), (right, right_section) = departments
    left_employee = make_employee(left_section)
    right_employee = make_employee(right_section)
    duty(left_employee)
    duty(right_employee, "GEV")
    response = read(viewer())
    assert response.status_code == 200
    result = response.json()
    assert result["business_date"] == "2026-10-07"
    assert {group["id"]: [person["employee_id"] for person in group["employees"]]
            for group in result["departments"]} == {
        left.pk: [left_employee.pk], right.pk: [right_employee.pk],
    }
    assert [group["name"] for group in result["departments"]] == ["Одинаковое имя", "Одинаковое имя"]


def test_scope_hides_external_and_unassigned_people(departments):
    (own, section), (_, foreign_section) = departments
    own_person, foreign, unassigned = make_employee(section), make_employee(foreign_section), make_employee()
    for person in [own_person, foreign, unassigned]:
        duty(person)
    response = read(viewer(own.pk))
    assert response.status_code == 200
    assert response.json()["departments"] == [{
        "id": own.pk, "name": own.name, "employees": [{
            "employee_id": own_person.pk, "full_name": "Иванов Иван", "position_name": "",
            "status_label": "На дежурстве", "date_start": "2026-10-07",
            "date_end": "2026-10-09", "destination": "",
        }],
    }]


def test_cancelled_inactive_and_higher_priority_sickness_suppress_duty(departments):
    _, section = departments[0]
    cancelled, past, future, sick, disabled = [make_employee(section) for _ in range(5)]
    duty(cancelled, cancelled_at=clock.Clock.now(), cancelled_by="test")
    duty(past, date_start=DAY - timedelta(days=2), date_end=DAY)
    duty(future, date_start=DAY + timedelta(days=1), date_end=DAY + timedelta(days=3))
    duty(sick)
    duty(sick, "SICK_LEAVE")
    duty(disabled)
    disabled.is_active = False
    disabled.save(update_fields=["is_active"])
    response = read(viewer())
    assert response.status_code == 200
    assert response.json()["departments"] == []


def test_full_name_position_source_destination_and_half_open_dates(departments):
    department, section = departments[0]
    person = make_employee(section)
    person.middle_name = "Сергеевич"
    person.save(update_fields=["middle_name"])
    position = Position.objects.create(code="COMBAT_CHIEF", name="Начальник", level=1)
    person.staff_unit.position = position
    person.staff_unit.save(update_fields=["position"])
    EmployeeStatus.objects.create(
        employee=person, status_type="on_duty", start_date=DAY,
        end_date=DAY + timedelta(days=1), location="Астана, пост 2",
    )
    response = read(viewer())
    assert response.status_code == 200
    assert response.json()["departments"] == [{
        "id": department.pk, "name": department.name, "employees": [{
            "employee_id": person.pk, "full_name": "Иванов Иван Сергеевич",
            "position_name": "Начальник", "status_label": "На дежурстве",
            "date_start": "2026-10-07", "date_end": "2026-10-09",
            "destination": "Астана, пост 2",
        }],
    }]


def test_active_attached_employee_is_visible_to_host_scope(departments):
    (host, _), (_, source_section) = departments
    person = make_employee(source_section)
    out_status = duty(person, "DETACHED")
    in_status = duty(person, "ATTACHED")
    Secondment.objects.create(
        employee_id=person.pk, from_division_id=source_section.pk, to_division_id=host.pk,
        out_status=out_status, in_status=in_status, created_by="test",
    )
    # This configured catalogue allows duty to win over attachment metadata.
    duty(person)
    response = read(viewer(host.pk))
    assert response.status_code == 200
    assert response.json()["departments"][0]["id"] == host.pk
    assert response.json()["departments"][0]["employees"][0]["employee_id"] == person.pk


def test_globally_visible_unassigned_employee_has_a_fallback_group():
    person = make_employee()
    duty(person, comment="Дежурный пост")
    response = read(viewer())
    assert response.status_code == 200
    group = response.json()["departments"][0]
    assert (group["id"], group["name"]) == (0, "Без департамента")
    assert group["employees"][0]["destination"] == "Дежурный пост"


def test_mismatched_attachment_legs_do_not_expand_host_visibility(departments):
    (host, host_section), (_, outside_section) = departments
    outside = make_employee(outside_section)
    leg_owner = make_employee(host_section)
    out_status = duty(leg_owner, "DETACHED")
    in_status = duty(leg_owner, "ATTACHED")
    Secondment.objects.create(
        employee_id=outside.pk, from_division_id=outside_section.pk, to_division_id=host.pk,
        out_status=out_status, in_status=in_status, created_by="test",
    )
    duty(outside)
    response = read(viewer(host.pk))
    assert response.status_code == 200
    assert response.json()["departments"] == []


def test_default_business_date_comes_from_section_clock(departments):
    _, section = departments[0]
    person = make_employee(section)
    duty(person)
    api = viewer()
    with clock.override(DAY):
        response = api.get(URL)
    assert response.status_code == 200
    assert response.json()["business_date"] == "2026-10-07"
    assert response.json()["departments"][0]["employees"][0]["employee_id"] == person.pk


@pytest.mark.parametrize("value", ["2026-02-30", "not-a-date", ""])
def test_invalid_business_date_returns_400(value):
    response = viewer().get(URL, {"business_date": value})
    assert response.status_code == 400


def test_status_reader_without_duty_permission_is_forbidden():
    assert read(viewer(permission="status.view")).status_code == 403


def test_list_queries_do_not_grow_per_employee(departments):
    _, section = departments[0]
    duty(make_employee(section))
    api = viewer()
    with CaptureQueriesContext(connection) as small:
        first = read(api)
    for _ in range(20):
        duty(make_employee(section))
    with CaptureQueriesContext(connection) as large:
        many = read(api)
    assert first.status_code == many.status_code == 200
    assert len(many.json()["departments"][0]["employees"]) == 21
    assert len(large) == len(small)
