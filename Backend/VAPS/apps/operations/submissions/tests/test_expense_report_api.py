"""Story 6.10a — расход HTTP surface (POST issue + GET by date + GET period).

HTTP contract only; issuance domain is proven at service level (6.5). RBAC via
seed_operations + UserRole (ORGD holds daily_report.generate); auth via the
X-User-Id header. Date-before-data (422) is exercised on a division with no
roster/statuses (the global data probe is empty under test isolation).
"""

import itertools
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.documents.models import EXPENSE_DOC_TYPE, IssuedDocument
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
_iin = itertools.count(9200)


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-EXP")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dtp


def _division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {code}", code=code
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


def _status(emp, code, start, end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
        source="USER",
    )


def _slot(division, slots):
    DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def _populate(division):
    """Roster + status + slot so derive/issue produce a converging расход."""
    emp = _employee(division)
    _employee(division)  # без факта → «В строю»
    _status(emp, "VACATION", date(2026, 7, 1), date(2026, 7, 15))
    _slot(division, 3)


def _grant(user_id, division):
    UserRole.objects.create(
        user_id=user_id, role_code_id="ORGD", scope_division_id=division.id
    )


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _issue(client, division, business_date=D):
    return client.post(
        reverse("ops-expense-report-list"),
        {"division_id": str(division.id), "business_date": business_date.isoformat()},
        format="json",
    )


# --- POST issue -------------------------------------------------------------


def test_issue_happy_201(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-A")
    _populate(div)
    _grant("orgd", div)
    with clock.override(D):
        submit_day(division_id=div.id, business_date=D, actor="op-1")
    resp = _issue(_client("orgd"), div)
    assert resp.status_code == 201, resp.content
    assert resp.data["doc_type"] == EXPENSE_DOC_TYPE
    assert resp.data["number"] == 1
    assert (
        IssuedDocument.objects.filter(division_id=div.id, business_date=D).count() == 1
    )


def test_issue_without_permission_403(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-B")
    _populate(div)
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    assert _issue(_client("viewer"), div).status_code == 403


def test_issue_foreign_scope_403(org_type, storage):
    org, dtp = org_type
    target = _division(org, dtp, "EXP-T")
    other = _division(org, dtp, "EXP-O")
    _populate(target)
    _grant("orgd", other)  # scoped to a different division
    assert _issue(_client("orgd"), target).status_code == 403


def test_issue_date_before_data_422(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-ND")  # NO roster, NO statuses
    _grant("orgd", div)
    resp = _issue(_client("orgd"), div)
    assert resp.status_code == 422
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"


# --- GET by date ------------------------------------------------------------


def test_get_by_date_after_issue_200(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-G")
    _populate(div)
    _grant("orgd", div)
    with clock.override(D):
        submit_day(division_id=div.id, business_date=D, actor="op-1")
    assert _issue(_client("orgd"), div).status_code == 201
    resp = _client("orgd").get(
        reverse("ops-expense-report-list"),
        {"division_id": str(div.id), "business_date": D.isoformat()},
    )
    assert resp.status_code == 200
    assert resp.data["number"] == 1


def test_get_by_date_not_issued_404(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-H")
    _populate(div)
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-list"),
        {"division_id": str(div.id), "business_date": D.isoformat()},
    )
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


# --- GET period -------------------------------------------------------------


def test_period_three_pages_200(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-P")
    _populate(div)
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 7, 6).isoformat(),
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert resp.status_code == 200, resp.content
    assert len(resp.data["pages"]) == 3
    assert resp.data["pages"][0]["business_date"] == "2026-07-06"


def test_period_before_data_422(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-PB")  # NO roster/statuses → before-data
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 7, 6).isoformat(),
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert resp.status_code == 422
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_period_inverted_range_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-PI")
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 7, 8).isoformat(),
            "date_to": date(2026, 7, 6).isoformat(),
        },
    )
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_period_too_long_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-PL")
    _populate(div)
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 7, 8).isoformat(),
            "date_to": (date(2026, 7, 8) + timedelta(days=99)).isoformat(),
        },
    )
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"
