"""Story 19.4b — GET /api/operations/statuses/calendar/ (месячный
календарь сотрудника, HTTP-слой над 19.4a's EmployeeStatusSelector.
month_calendar). Эта стори проверяет ТОЛЬКО слой: query-валидация (400),
scope (403, порядок scope→existence как 6.10a/10.1b), ростер-членство
сотрудника (404), happy-path."""

import itertools
import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

URL = reverse("ops-status-calendar")
_iin = itertools.count(960001)


@pytest.fixture
def env():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-194b")
    dtp = DivisionType.objects.create(code="mgmt194b", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-194b"
    )
    StatusType.objects.create(
        code="VACATION",
        name="Отпуск",
        is_hard_block=True,
        priority=20,
        report_column_code="VACATION",
    )
    return org, dtp, div


def _emp(div):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}",
        full_name="T",
        rank_code="",
        position_code="",
        division=div,
    )


def _status(emp, code="VACATION", start="2026-08-01", end="2026-08-10"):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
        source=EmployeeStatus.Source.USER,
    )


def _grant(user_id, role_code, division=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role_code,
        scope_division_id=division.id if division else None,
    )


def _client(actor):
    c = APIClient()
    c.raise_request_exception = False
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _get(client, division_id=None, employee_id=None, year=2026, month=8):
    params = {}
    if division_id is not None:
        params["division_id"] = str(division_id)
    if employee_id is not None:
        params["employee_id"] = str(employee_id)
    if year is not None:
        params["year"] = year
    if month is not None:
        params["month"] = month
    return client.get(URL, params)


def test_happy_path_returns_dense_month(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)
    _status(emp, start="2026-08-05", end="2026-08-10")

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id)

    assert resp.status_code == 200, resp.content
    assert len(resp.data) == 31
    assert resp.data["2026-08-05"] == "VACATION"
    assert resp.data["2026-08-01"] == "IN_SERVICE"


def test_foreign_scope_403(env):
    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER-194b"
    )
    _grant("op", "DIVISION_OPERATOR", division=other_div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id)

    assert resp.status_code == 403


def test_foreign_scope_wins_over_nonexistent_division(env):
    """Держатель БЕЗ scope на фантомный division_id получает 403, не
    404-oracle существования (порядок scope→existence, 6.10a/10.1b)."""
    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER2-194b"
    )
    _grant("op", "DIVISION_OPERATOR", division=other_div)

    resp = _get(_client("op"), division_id=uuid.uuid4(), employee_id=uuid.uuid4())

    assert resp.status_code == 403


def test_nonexistent_division_404_after_scope_pass(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR")  # unscoped → global scope passes

    resp = _get(_client("op"), division_id=uuid.uuid4(), employee_id=uuid.uuid4())

    assert resp.status_code == 404


def test_employee_in_different_division_404(env):
    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER3-194b"
    )
    _grant("op", "DIVISION_OPERATOR")  # unscoped → both divisions visible
    foreign_emp = _emp(other_div)

    resp = _get(_client("op"), division_id=div.id, employee_id=foreign_emp.id)

    assert resp.status_code == 404


def test_nonexistent_employee_404(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)

    resp = _get(_client("op"), division_id=div.id, employee_id=uuid.uuid4())

    assert resp.status_code == 404


def test_invalid_month_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id, month=13)

    assert resp.status_code == 400


def test_missing_division_id_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=None, employee_id=emp.id)

    assert resp.status_code == 400


def test_missing_employee_id_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)

    resp = _get(_client("op"), division_id=div.id, employee_id=None)

    assert resp.status_code == 400


def test_missing_year_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id, year=None)

    assert resp.status_code == 400


def test_missing_month_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id, month=None)

    assert resp.status_code == 400


@pytest.mark.parametrize("year", [1999, 2101])
def test_year_outside_allowed_range_400(env, year):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)

    resp = _get(_client("op"), division_id=div.id, employee_id=emp.id, year=year)

    assert resp.status_code == 400


def test_employee_id_random_against_empty_division_404(env):
    """review (Edge Case Hunter): division exists, in-scope, has ZERO
    roster entries at all (distinct from 'employee exists in another
    division') — same 404 path, no crash."""
    _org, dtp, _div = env
    empty_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Empty", code="EMPTY-194b"
    )
    _grant("op", "DIVISION_OPERATOR", division=empty_div)

    resp = _get(_client("op"), division_id=empty_div.id, employee_id=uuid.uuid4())

    assert resp.status_code == 404
