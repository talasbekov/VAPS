"""Story 20.5b — HTTP surface over CoreStaffingSelector.compute_staffing_table()
(20.5a). Structural precedent: VacancyViewSet (bare ViewSet + imperative
require_permission), same "grant" fixture as test_staffing_api.py."""

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeStaffingAssignment,
    Organization,
    Position,
    StaffingSlot,
)

pytestmark = pytest.mark.django_db

D = dt.date(2026, 7, 8)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ-ST")
    dtp = DivisionType.objects.create(code="management-st", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D-ST"
    )
    pos = Position.objects.create(code="INSPECTOR-ST", name="Инспектор")
    return div, pos


def _employee(division, iin_suffix):
    return Employee.objects.create(
        iin=f"{iin_suffix:012d}",
        full_name=f"Сотрудник {iin_suffix}",
        rank_code="",
        position_code="",
        division=division,
    )


def _slot(division, position, valid_from=None, valid_to=None, is_active=True):
    return StaffingSlot.objects.create(
        division=division,
        position_code=position,
        valid_from=valid_from
        or timezone.make_aware(dt.datetime.combine(D, dt.time.min)),
        valid_to=valid_to,
        is_active=is_active,
    )


def _assignment(employee, slot, starts_at=None, ends_at=None):
    return EmployeeStaffingAssignment.objects.create(
        employee=employee,
        staffing_slot=slot,
        starts_at=starts_at or timezone.make_aware(dt.datetime.combine(D, dt.time.min)),
        ends_at=ends_at,
    )


def test_happy_200_all_org(client, env, grant):
    grant(client)
    div, pos = env
    emp = _employee(div, 9500)
    slot1 = _slot(div, pos)
    _slot(div, pos)
    _assignment(emp, slot1)

    resp = client.get("/api/core/staffing-table/", {"business_date": D.isoformat()})

    assert resp.status_code == 200, resp.content
    rows = {r["position_code"]: r for r in resp.json()["results"]}
    assert rows[pos.code]["allocated"] == 2
    assert rows[pos.code]["filled"] == 1
    assert rows[pos.code]["vacant"] == 1


def test_without_permission_403(client, env, grant):
    grant(client, role="INTEGRATION_USER")
    resp = client.get("/api/core/staffing-table/")
    assert resp.status_code == 403


def test_division_id_filter(client, env, grant):
    grant(client)
    org = env[0].organization
    dtp = env[0].type_code
    other_div = Division.objects.create(
        organization=org, type_code=dtp, name="Other", code="D-ST-OTHER"
    )
    div, pos = env
    _slot(div, pos)
    _slot(other_div, pos)

    resp = client.get(
        "/api/core/staffing-table/",
        {"division_id": str(div.id), "business_date": D.isoformat()},
    )

    assert resp.status_code == 200, resp.content
    division_ids = {r["division_id"] for r in resp.json()["results"]}
    assert division_ids == {str(div.id)}


def test_past_business_date_uses_correct_snapshot(client, env, grant):
    grant(client)
    div, pos = env
    past = dt.date(2026, 6, 1)
    future_only_slot = _slot(
        div,
        pos,
        valid_from=timezone.make_aware(dt.datetime.combine(D, dt.time.min)),
    )
    del future_only_slot

    resp = client.get(
        "/api/core/staffing-table/",
        {"division_id": str(div.id), "business_date": past.isoformat()},
    )

    assert resp.status_code == 200, resp.content
    assert resp.json()["results"] == []


def test_invalid_business_date_400(client, env, grant):
    grant(client)
    resp = client.get("/api/core/staffing-table/", {"business_date": "not-a-date"})
    assert resp.status_code == 400


def test_invalid_division_id_400(client, env, grant):
    """Review (Blind Hunter + Edge Case Hunter): a malformed UUID must not
    reach the ORM filter unguarded (500 risk)."""
    grant(client)
    resp = client.get("/api/core/staffing-table/", {"division_id": "not-a-uuid"})
    assert resp.status_code == 400, resp.content


def test_empty_division_id_treated_as_no_filter_not_error(client, env, grant):
    """Review: an explicit but blank division_id=&query param is falsy —
    documented as "no filter" (not silently misinterpreted as a real
    empty-string division), distinct from the malformed-UUID 400 above."""
    grant(client)
    div, pos = env
    _slot(div, pos)

    resp = client.get(
        "/api/core/staffing-table/",
        {"division_id": "", "business_date": D.isoformat()},
    )

    assert resp.status_code == 200, resp.content


def test_desync_negative_vacant_not_filtered(client, env, grant):
    """20.5a's AC-2 rediscovered at the HTTP layer: a filled slot that is no
    longer active/valid still shows up honestly, vacant negative."""
    grant(client)
    div, pos = env
    inactive_slot = _slot(div, pos, is_active=False)
    emp = _employee(div, 9501)
    _assignment(emp, inactive_slot)

    resp = client.get(
        "/api/core/staffing-table/",
        {"division_id": str(div.id), "business_date": D.isoformat()},
    )

    assert resp.status_code == 200, resp.content
    rows = {r["position_code"]: r for r in resp.json()["results"]}
    assert rows[pos.code]["allocated"] == 0
    assert rows[pos.code]["filled"] == 1
    assert rows[pos.code]["vacant"] == -1
