import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.clock import Clock
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


def test_list_positions(client, env, grant):
    grant(client)  # gate: orgstructure.view (story 2.14)
    resp = client.get("/api/core/positions/")
    assert resp.status_code == 200
    assert any(p["code"] == "OPER" for p in resp.json()["results"])


def test_options_is_not_gated(client, env):
    # Story 2.14 review patch: OPTIONS (metadata / CORS preflight) must NOT be
    # fail-closed into 403 by the gate mixin — even unauthenticated.
    resp = client.options("/api/core/positions/")
    assert resp.status_code != 403


def test_unsupported_method_returns_405_not_403(client, env, grant):
    # Story 2.14 review patch: a method the ViewSet does not serve (DELETE on
    # positions, http_method_names=get/post/patch) must surface 405, not a
    # misleading 403 from the gate.
    grant(client)
    resp = client.delete("/api/core/positions/OPER/")
    assert resp.status_code == 405


def test_assign_and_release_slot(client, env, grant):
    grant(client)  # gate: personnel.edit (story 2.14)
    div, pos = env
    slot = StaffingSlot.objects.create(
        division=div,
        position_code=pos,
        valid_from=timezone.now() - dt.timedelta(days=1),
    )
    emp = Employee.objects.create(
        iin="900101300800",
        full_name="X",
        rank_code="MAJOR",
        position_code="OPER",
        division=div,
    )
    resp = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)}, format="json",
    )
    assert resp.status_code == 201
    resp2 = client.post(f"/api/core/staffing-slots/{slot.id}/release/")
    assert resp2.status_code == 200


def test_vacancies_endpoint(client, env, grant):
    grant(client)  # gate: personnel.view (story 2.13)
    div, pos = env
    StaffingSlot.objects.create(
        division=div,
        position_code=pos,
        valid_from=timezone.now() - dt.timedelta(days=1),
    )
    # Business date, NOT the UTC calendar date: the endpoint resolves `date` at
    # midnight Asia/Qyzylorda, so between 00:00 and 05:00 local the UTC date is
    # still «yesterday» and midnight-of-that-day lands BEFORE valid_from → 0 rows.
    # Clock.today_local() is the single legitimate wall-clock read (ARCH-DATA-022).
    today = Clock.today_local().isoformat()
    resp = client.get(f"/api/core/vacancies/?division_id={div.id}&date={today}")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
