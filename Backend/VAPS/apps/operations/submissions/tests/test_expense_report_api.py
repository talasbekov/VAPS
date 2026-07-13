"""Story 6.10a — расход HTTP surface (POST issue + GET by date + GET period).

HTTP contract only; issuance domain is proven at service level (6.5). RBAC via
seed_operations + UserRole (ORGD holds daily_report.generate); auth via the
X-User-Id header. Date-before-data (422) is horizon-based (review D1
2026-07-13): exercised both on an empty system AND on a populated DB with a
far-past date — the latter is the regression pin for the vacuous roster-probe
bug (roster_on's date-insensitive fallback made the old probe always-true).
"""

import itertools
import uuid
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


# --- Review 2026-07-13 additions ---------------------------------------------


def test_issue_no_submission_409(org_type, storage):
    # AC-1 guard passthrough: populated division, right+scope, but no сдача.
    org, dtp = org_type
    div = _division(org, dtp, "EXP-NR")
    _populate(div)
    _grant("orgd", div)
    resp = _issue(_client("orgd"), div)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "REPORT_NOT_READY_FOR_DATE"


def test_issue_repeat_409_already_issued(org_type, storage):
    # AC-1 guard passthrough: second POST for the same date/version → 409.
    org, dtp = org_type
    div = _division(org, dtp, "EXP-RI")
    _populate(div)
    _grant("orgd", div)
    with clock.override(D):
        submit_day(division_id=div.id, business_date=D, actor="op-1")
    assert _issue(_client("orgd"), div).status_code == 201
    resp = _issue(_client("orgd"), div)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "DOCUMENT_ALREADY_ISSUED"


def test_period_empty_division_valid_200(org_type, storage):
    # AC-4 boundary: a legitimately EMPTY division on an in-range date is a
    # valid 0=0+0 report, NOT 422 — the global horizon comes from other data.
    org, dtp = org_type
    populated = _division(org, dtp, "EXP-POP")
    _populate(populated)  # global horizon = 2026-07-01
    empty = _division(org, dtp, "EXP-EMP")  # zero employees, zero slots
    _grant("orgd", empty)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(empty.id),
            "date_from": date(2026, 7, 6).isoformat(),
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert resp.status_code == 200, resp.content
    assert len(resp.data["pages"]) == 3
    assert resp.data["pages"][0]["totals"]["staff_total"] == 0


def test_period_far_past_422_on_populated_db(org_type, storage):
    # THE regression pin for review D1: a populated DB (WORKING employees →
    # the old roster probe was always-true) must still 422 on a far-past date.
    org, dtp = org_type
    div = _division(org, dtp, "EXP-FP")
    _populate(div)  # horizon = earliest status start = 2026-07-01
    _grant("orgd", div)
    resp = _client("orgd").get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(1990, 1, 1).isoformat(),
            "date_to": date(1990, 1, 3).isoformat(),
        },
    )
    assert resp.status_code == 422
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_issue_far_past_422_on_populated_db(org_type, storage):
    # Same pin for the POST branch: far past → 422 (not 409 «нет сдачи»).
    org, dtp = org_type
    div = _division(org, dtp, "EXP-FI")
    _populate(div)
    _grant("orgd", div)
    resp = _issue(_client("orgd"), div, business_date=date(1990, 1, 1))
    assert resp.status_code == 422
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_period_cap_boundary_62_ok_63_400(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "EXP-CB")
    emp = _employee(div)
    # Early status pushes the horizon before the 62-day window under test.
    _status(emp, "VACATION", date(2026, 1, 1), date(2026, 1, 5))
    _slot(div, 3)
    _grant("orgd", div)
    client = _client("orgd")
    ok = client.get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 5, 8).isoformat(),  # 62 days incl.
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert ok.status_code == 200, ok.content
    assert len(ok.data["pages"]) == 62
    too_long = client.get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(div.id),
            "date_from": date(2026, 5, 7).isoformat(),  # 63 days incl.
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert too_long.status_code == 400
    assert too_long.data["error_code"] == "VALIDATION_ERROR"


def test_period_future_400(org_type, storage):
    # Review D2: derived pages must not fabricate the future; date_to > today
    # → 400. (GET by-date is deliberately not blocked — 6.10b override issue.)
    org, dtp = org_type
    div = _division(org, dtp, "EXP-FU")
    _populate(div)
    _grant("orgd", div)
    with clock.override(D):
        resp = _client("orgd").get(
            reverse("ops-expense-report-period"),
            {
                "division_id": str(div.id),
                "date_from": D.isoformat(),
                "date_to": (D + timedelta(days=1)).isoformat(),
            },
        )
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_unknown_division_404(org_type, storage):
    # Review: a valid-but-phantom UUID under a GLOBAL role (scope NULL passes
    # the scope guard) must be 404 — not zero-pages and not 409 «нет сдачи».
    org, dtp = org_type
    div = _division(org, dtp, "EXP-GL")
    _populate(div)  # global data exists → horizon passes
    UserRole.objects.create(user_id="root", role_code_id="ORGD", scope_division_id=None)
    phantom = str(uuid.uuid4())
    client = _client("root")
    get_resp = client.get(
        reverse("ops-expense-report-list"),
        {"division_id": phantom, "business_date": D.isoformat()},
    )
    assert get_resp.status_code == 404
    assert get_resp.data["details"]["division_id"] == phantom
    period_resp = client.get(
        reverse("ops-expense-report-period"),
        {
            "division_id": phantom,
            "date_from": date(2026, 7, 6).isoformat(),
            "date_to": date(2026, 7, 8).isoformat(),
        },
    )
    assert period_resp.status_code == 404
    post_resp = client.post(
        reverse("ops-expense-report-list"),
        {"division_id": phantom, "business_date": D.isoformat()},
        format="json",
    )
    assert post_resp.status_code == 404
