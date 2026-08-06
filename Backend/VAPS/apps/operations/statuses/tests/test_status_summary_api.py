"""Story 20.6b — HTTP surface over compute_status_summary() (20.6a).

GET /api/operations/statuses/summary/. Structural precedent: StatusViewSet's
own on_date action (module-local _ensure_division_scope/_ensure_division_exists,
already in this file). Auth via X-User-Id, same fixtures as
test_bulk_status_api.py / test_status_summary.py.
"""

import itertools
import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

D = date(2026, 6, 4)
URL = reverse("ops-status-summary")
_iin = itertools.count(950001)


@pytest.fixture
def org():
    call_command("seed_operations")
    return Organization.objects.create(name="Орг", code="ORG-SSAPI")


def _division(org, code, parent=None):
    dtp = DivisionType.objects.get_or_create(
        code="department-ssapi", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"D-{code}", code=code, parent=parent
    )


def _employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def _slot(division, slots=1):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 6, 1)),
    )


def _status(employee, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
    )


def _grant(user_id, role_code, division=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role_code,
        scope_division_id=division.id if division else None,
    )


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def test_org_wide_summary_200(org):
    div = _division(org, "SSAPI-A")
    emp = _employee(div)
    _slot(div, 1)
    _status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
    _grant("viewer", "VIEWER")

    resp = _client("viewer").get(URL, {"business_date": D.isoformat()})

    assert resp.status_code == 200, resp.content
    assert resp.data["division_id"] is None
    assert resp.data["columns"]["VACATION"] == 1
    assert set(resp.data["columns"].keys()) == {
        "SICK",
        "VACATION",
        "COMMAND",
        "TRAINING",
        "OTHER",
        "DETACHED",
        "AFTER_DUTY",
        "BEFORE_DUTY",
        "ON_DUTY",
        "PENDING",
        "IN_SERVICE",
    }


def test_division_scoped_summary_200(org):
    div_a = _division(org, "SSAPI-B")
    div_b = _division(org, "SSAPI-C")
    emp_a = _employee(div_a)
    _employee(div_b)
    _slot(div_a, 1)
    _slot(div_b, 1)
    _status(emp_a, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
    _grant("viewer", "VIEWER", division=div_a)

    resp = _client("viewer").get(
        URL, {"business_date": D.isoformat(), "division_id": str(div_a.id)}
    )

    assert resp.status_code == 200, resp.content
    assert resp.data["division_id"] == str(div_a.id)
    assert resp.data["list_total"] == 1


def test_without_permission_403(org):
    div = _division(org, "SSAPI-D")
    _employee(div)
    resp = _client("nobody").get(URL, {"business_date": D.isoformat()})
    assert resp.status_code == 403


def test_foreign_scope_403(org):
    div_a = _division(org, "SSAPI-E")
    div_b = _division(org, "SSAPI-F")
    _employee(div_a)
    _grant("viewer", "VIEWER", division=div_b)

    resp = _client("viewer").get(
        URL, {"business_date": D.isoformat(), "division_id": str(div_a.id)}
    )
    assert resp.status_code == 403


def test_nonexistent_division_404(org):
    _grant("viewer", "VIEWER")

    resp = _client("viewer").get(
        URL, {"business_date": D.isoformat(), "division_id": str(uuid.uuid4())}
    )
    assert resp.status_code == 404


def test_missing_business_date_400(org):
    _grant("viewer", "VIEWER")
    resp = _client("viewer").get(URL)
    assert resp.status_code == 400


def test_future_business_date_400(org):
    _grant("viewer", "VIEWER")
    future = date.today() + timedelta(days=365)
    resp = _client("viewer").get(URL, {"business_date": future.isoformat()})
    assert resp.status_code == 400


def test_invalid_business_date_format_400(org):
    _grant("viewer", "VIEWER")
    resp = _client("viewer").get(URL, {"business_date": "not-a-date"})
    assert resp.status_code == 400


def test_before_data_horizon_422(org):
    """Review (Edge Case Hunter): an org with zero status/history data must
    not silently return a fabricated all-IN_SERVICE summary."""
    div = _division(org, "SSAPI-G")
    _employee(div)  # no _status()/_slot() history — empty system
    _grant("viewer", "VIEWER")

    resp = _client("viewer").get(URL, {"business_date": D.isoformat()})

    assert resp.status_code == 422, resp.content
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"
