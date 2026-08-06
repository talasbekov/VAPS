"""Story 20.2b — HTTP surface over compute_expense_dashboard (20.2a).

GET /api/operations/expense-reports/dashboard/?business_date=<date>. Org-wide
(no division_id) — structural precedent: override_block's "day-level, без
division-scope" (Story 6.10b). Gated on daily_report.generate, the same
permission the rest of ExpenseReportViewSet uses (Story 6.10a Д2: "management
reads what it issues"). Auth via the X-User-Id header, same fixtures as
test_expense_report_api.py.
"""

from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import SubmissionControlSettings

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-EXPD")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dtp


def _division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {code}", code=code
    )


def _employee(division, iin_suffix):
    return Employee.objects.create(
        iin=f"{iin_suffix:012d}",
        full_name=f"Сотрудник {iin_suffix}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def _populate(division, iin_suffix):
    emp = _employee(division, iin_suffix)
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=date(2026, 7, 1),
        date_end=date(2026, 7, 15),
        source="USER",
    )


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _grant_org_wide(user_id):
    UserRole.objects.create(
        user_id=user_id, role_code_id="ORGD", scope_division_id=None
    )


def _dashboard(client, business_date=D):
    return client.get(
        reverse("ops-expense-report-dashboard"),
        {"business_date": business_date.isoformat()},
    )


def test_dashboard_happy_200(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "EXPD-A")
    _populate(div, 9300)
    _grant_org_wide("root")
    resp = _dashboard(_client("root"))
    assert resp.status_code == 200, resp.content
    assert resp.data["business_date"] == D.isoformat()
    assert "expense" in resp.data
    assert "rows" in resp.data["expense"]
    assert "totals" in resp.data["expense"]
    assert isinstance(resp.data["laggards"], list)
    assert isinstance(resp.data["blocked"], bool)
    assert isinstance(resp.data["overridden"], bool)


def test_dashboard_without_permission_403(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "EXPD-B")
    _populate(div, 9301)
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    assert _dashboard(_client("viewer")).status_code == 403


def test_dashboard_missing_business_date_400(org_type):
    org, dtp = org_type
    _grant_org_wide("root")
    resp = _client("root").get(reverse("ops-expense-report-dashboard"))
    assert resp.status_code == 400


def test_dashboard_invalid_business_date_400(org_type):
    org, dtp = org_type
    _grant_org_wide("root")
    resp = _client("root").get(
        reverse("ops-expense-report-dashboard"), {"business_date": "not-a-date"}
    )
    assert resp.status_code == 400


def test_dashboard_future_date_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "EXPD-FUT")
    _populate(div, 9305)
    _grant_org_wide("root")
    resp = _dashboard(_client("root"), business_date=date(2099, 1, 1))
    assert resp.status_code == 400, resp.content
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_dashboard_before_data_422(org_type):
    """No data exists anywhere yet → the same REPORT_NO_DATA_FOR_DATE guard
    every sibling read action (period/document/tree) enforces before touching
    StrengthReportService — a pre-data date must not silently fabricate an
    all-IN_SERVICE dashboard."""
    org, dtp = org_type
    _division(org, dtp, "EXPD-NODATA")  # no roster/statuses anywhere
    _grant_org_wide("root")
    resp = _dashboard(_client("root"))
    assert resp.status_code == 422, resp.content
    assert resp.data["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_dashboard_laggard_matches_selector_shape(org_type):
    org, dtp = org_type
    required_div = _division(org, dtp, "EXPD-REQ")
    _populate(required_div, 9302)
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = [required_div.id]
    s.save(update_fields=["required_division_ids"])
    _grant_org_wide("root")

    resp = _dashboard(_client("root"))

    assert resp.status_code == 200, resp.content
    assert resp.data["laggards"] == [
        {"division_id": str(required_div.id), "name": required_div.name}
    ]
    assert resp.data["blocked"] is True


def test_dashboard_org_wide_no_scope_needed(org_type):
    """AC-6: org-wide — a holder without a specific division scope still gets
    the full dashboard (unlike period/journal, which 403 without scope)."""
    org, dtp = org_type
    div = _division(org, dtp, "EXPD-SCOPE")
    _populate(div, 9303)
    UserRole.objects.create(
        user_id="orgd-noscope", role_code_id="ORGD", scope_division_id=None
    )
    resp = _dashboard(_client("orgd-noscope"))
    assert resp.status_code == 200, resp.content


def test_dashboard_matches_direct_selector_call(org_type):
    from apps.operations.selectors import compute_expense_dashboard

    org, dtp = org_type
    div = _division(org, dtp, "EXPD-MATCH")
    _populate(div, 9304)
    _grant_org_wide("root")

    resp = _dashboard(_client("root"))
    direct = compute_expense_dashboard(D)

    assert resp.status_code == 200, resp.content
    assert (
        resp.data["expense"]["totals"]["staff_total"]
        == direct["expense"].totals.staff_total
    )
    assert (
        resp.data["expense"]["totals"]["list_total"]
        == direct["expense"].totals.list_total
    )
    assert len(resp.data["expense"]["rows"]) == len(direct["expense"].rows)
