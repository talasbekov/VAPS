"""Story 10.1b — GET /api/operations/statuses/on-date/ (преднабор «вчера»).

HTTP-поверхность поверх готового селектора EmployeeStatusSelector.
overlapping_on (доменно доказан 3.7/6.9-циклом) — эта стори проверяет ТОЛЬКО
слой: query-валидация (400), scope (403, порядок scope→existence как 6.10a),
грубый гейт права (RequirePermissionMixin), happy-path список.
"""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

D = date(2026, 6, 5)
URL = reverse("ops-status-on-date")
_iin = itertools.count(950001)


@pytest.fixture
def env():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-101b")
    dtp = DivisionType.objects.create(code="mgmt101b", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-101b"
    )
    StatusType.objects.create(
        code="VACATION", name="Отпуск", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    return org, dtp, div


def _emp(div):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}", full_name="T", rank_code="",
        position_code="", division=div,
    )


def _status(emp, code="VACATION", start="2026-06-01", end="2026-06-10"):
    return EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code=code, date_start=start,
        date_end=end, source=EmployeeStatus.Source.USER,
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


def _get(client, division_id=None, business_date="2026-06-05"):
    params = {}
    if division_id is not None:
        params["division_id"] = str(division_id)
    if business_date is not None:
        params["business_date"] = business_date
    return client.get(URL, params)


def test_happy_path_returns_live_statuses(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)
    _status(emp)
    other_emp = _emp(div)  # no status — must NOT appear in response

    resp = _get(_client("op"), division_id=div.id)

    assert resp.status_code == 200, resp.content
    assert len(resp.data) == 1
    assert resp.data[0]["employee_id"] == str(emp.id)
    assert resp.data[0]["status_type_code"] == "VACATION"
    assert not any(row["employee_id"] == str(other_emp.id) for row in resp.data)


def test_status_outside_date_window_not_returned(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)
    emp = _emp(div)
    _status(emp, start="2025-01-01", end="2025-01-31")  # long past D

    resp = _get(_client("op"), division_id=div.id)

    assert resp.status_code == 200
    assert resp.data == []


def test_foreign_scope_403(env):
    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER-101b"
    )
    _grant("op", "DIVISION_OPERATOR", division=other_div)  # scope elsewhere

    resp = _get(_client("op"), division_id=div.id)

    assert resp.status_code == 403


def test_nonexistent_division_404_after_scope_pass(env):
    import uuid

    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR")  # unscoped → global scope passes

    resp = _get(_client("op"), division_id=uuid.uuid4())

    assert resp.status_code == 404


def test_foreign_scope_wins_over_nonexistent_division(env):
    """Держатель БЕЗ scope на фантомный division_id получает 403, не
    404-oracle существования (порядок scope→existence, 6.10a)."""
    import uuid

    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER2-101b"
    )
    _grant("op", "DIVISION_OPERATOR", division=other_div)

    resp = _get(_client("op"), division_id=uuid.uuid4())

    assert resp.status_code == 403


def test_missing_division_id_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)

    resp = _get(_client("op"), division_id=None)

    assert resp.status_code == 400


def test_missing_business_date_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)

    resp = _get(_client("op"), division_id=div.id, business_date=None)

    assert resp.status_code == 400


def test_bad_uuid_400(env):
    _org, _dtp, div = env
    _grant("op", "DIVISION_OPERATOR", division=div)

    resp = _client("op").get(
        URL, {"division_id": "not-a-uuid", "business_date": "2026-06-05"}
    )

    assert resp.status_code == 400


def test_anonymous_403(env):
    _org, _dtp, div = env

    resp = _get(_client(None), division_id=div.id)

    assert resp.status_code == 403


def test_without_view_permission_403(env):
    _org, _dtp, div = env
    _grant("noview", "INTEGRATION_USER")  # holds status.manage, not .view

    resp = _get(_client("noview"), division_id=div.id)

    assert resp.status_code == 403


def test_global_scope_spans_divisions(env):
    _org, dtp, div = env
    other_div = Division.objects.create(
        organization=_org, type_code=dtp, name="Other", code="OTHER3-101b"
    )
    _grant("viewer", "VIEWER")  # unscoped
    emp = _emp(other_div)
    _status(emp)

    resp = _get(_client("viewer"), division_id=other_div.id)

    assert resp.status_code == 200
    assert len(resp.data) == 1
