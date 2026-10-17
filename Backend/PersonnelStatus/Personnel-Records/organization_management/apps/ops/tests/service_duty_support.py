from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from django.core.management import call_command

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.clock import override
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

REGISTER = "/api/ops/duty-register/"
NOW = datetime(2026, 10, 13, 9, tzinfo=timezone.utc)


@pytest.fixture
def duty_log_scene():
    call_command("seed_operations", verbosity=0)
    first = Division.objects.create(name="Подразделение А", division_type="department")
    other = Division.objects.create(name="Подразделение Б", division_type="department")
    people = []
    for index, division in enumerate((first, other), 1):
        person = Employee.objects.create(first_name="Учётный", last_name=f"Сотрудник{index}",
            personnel_number=f"duty-log-{index}", iin=f"{1300+index:012d}", hire_date=date(2020, 1, 1))
        StaffUnit.objects.create(employee=person, division=division, index=index)
        people.append(person)
    manager, user = client_for("log-manager", "LOG_MANAGER", ("duty.view", "duty.manage"), first.pk)
    wrong, _ = client_for("log-other", "LOG_OTHER", ("duty.view", "duty.manage"), other.pk)
    reader, _ = client_for("log-reader", "LOG_READER", ("duty.view",), first.pk)
    analyst, _ = client_for("log-analyst", "LOG_ANALYST", ("analytics.view",), first.pk)
    with override(NOW):
        yield dict(manager=manager, user=user, wrong=wrong, reader=reader, analyst=analyst,
            first=first, other=other, people=people)


def log_payload(scene, **extra):
    return dict(employee_id=scene["people"][0].pk, service_duty_code="GBR",
        planned_start="2026-10-12T20:00:00+05:00", planned_end="2026-10-13T08:00:00+05:00",
        location_label="Служебная запись", document_basis="Приказ №13", note="Учебная отметка",
        client_request_id=str(uuid4()), **extra)


def create_log(scene, **extra):
    response = scene["manager"].post(REGISTER, log_payload(scene, **extra), format="json")
    assert response.status_code == 201, response.data
    return response.data


def detail_path(row):
    return REGISTER + row["id"] + "/"
