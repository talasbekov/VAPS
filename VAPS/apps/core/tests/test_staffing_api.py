import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Division, DivisionType, Employee, Organization, Position, Rank, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер")
    Rank.objects.create(code="MAJOR", name="Майор", rank_index=30)
    return div, pos


def test_list_positions(client, env):
    resp = client.get("/api/core/positions/")
    assert resp.status_code == 200
    assert any(p["code"] == "OPER" for p in resp.json()["results"])


def test_assign_and_release_slot(client, env):
    div, pos = env
    slot = StaffingSlot.objects.create(
        division=div, position_code=pos, valid_from=timezone.now() - dt.timedelta(days=1)
    )
    emp = Employee.objects.create(
        iin="900101300800", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    resp = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)}, format="json",
    )
    assert resp.status_code == 201
    resp2 = client.post(f"/api/core/staffing-slots/{slot.id}/release/")
    assert resp2.status_code == 200


def test_vacancies_endpoint(client, env):
    div, pos = env
    StaffingSlot.objects.create(
        division=div, position_code=pos, valid_from=timezone.now() - dt.timedelta(days=1)
    )
    today = timezone.now().date().isoformat()
    resp = client.get(f"/api/core/vacancies/?division_id={div.id}&date={today}")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
