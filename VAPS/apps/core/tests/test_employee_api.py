import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dtp, name="D", code="D")


@pytest.fixture
def employee(division):
    call_command("seed_core")
    return Employee.objects.create(
        iin="900101300700", last_name="Иванов", first_name="Иван",
        rank_code="MAJOR", position_code="OPER", division=division,
    )


def test_list_masks_iin_by_default(client, employee, grant):
    grant(client)  # gate: personnel.view (story 2.14); masking is X-User-Permissions
    resp = client.get("/api/core/employees/")
    assert resp.status_code == 200
    row = resp.json()["results"][0]
    assert row["iin"] != "900101300700"


def test_list_filter_by_division(client, employee, division, grant):
    grant(client)
    resp = client.get(f"/api/core/employees/?division_id={division.id}")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 1


def test_search_by_last_name(client, employee, grant):
    grant(client)
    resp = client.get("/api/core/employees/?search=Иванов")
    assert len(resp.json()["results"]) == 1


def test_detail_with_permission_reveals_iin(client, employee, grant):
    grant(client)
    resp = client.get(
        f"/api/core/employees/{employee.id}/",
        HTTP_X_USER_PERMISSIONS="employee.sensitive.view",
    )
    assert resp.json()["iin"] == "900101300700"


def test_patch_updates_phone(client, employee, grant):
    grant(client)
    resp = client.patch(
        f"/api/core/employees/{employee.id}/", {"work_phone": "+7700"}, format="json"
    )
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.work_phone == "+7700"


def test_archive_sets_status_and_inactive(client, employee, grant):
    grant(client)
    resp = client.post(f"/api/core/employees/{employee.id}/archive/")
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.employment_status == "ARCHIVED"
    assert employee.is_active is False


def test_restore_reactivates(client, employee, grant):
    grant(client)
    client.post(f"/api/core/employees/{employee.id}/archive/")
    resp = client.post(f"/api/core/employees/{employee.id}/restore/")
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.employment_status == "WORKING"
    assert employee.is_active is True
