"""Story 20.3b — HTTP surface over compute_overload_summary() (20.3a).

GET /api/operations/load/summary/. Structural precedent:
apps/operations/statuses/api/views.py's on_date action (roster_on()+scope+
existence). Auth via the X-User-Id header, same fixtures as
test_expense_dashboard_api.py (core roster) + test_overload_summary.py
(overload facts).
"""

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")
D_FROM = date(2026, 8, 1)
D_TO = date(2026, 8, 4)


def local(day, hour, minute=0):
    return datetime(D_FROM.year, D_FROM.month, day, hour, minute, tzinfo=TZ)


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-LOAD")
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


def _facility_object():
    return FacilityObject.objects.create(code="OBJ-LOAD", name="Штаб", address="г. А")


def _overload_series(obj, employee_id, start_day):
    """4 consecutive 12h days → qualifies as overload (>3 days, 8h+ each)."""
    for offset in range(4):
        day = start_day + offset
        event = SecurityEvent.objects.create(
            object=obj, title="ОМ", status_code=SecurityEvent.StatusCode.CLOSED
        )
        post = Post.objects.create(
            object=obj, code=f"POST-{employee_id}-{day}", name="Пост"
        )
        version = AssignmentVersion.objects.create(
            event=event,
            status=AssignmentVersion.Status.APPROVED,
            version=1,
            is_current=True,
        )
        assignment = PlacementAssignment.objects.create(
            version=version, employee_id=employee_id, post=post
        )
        PlacementAssignmentActual.objects.create(
            assignment=assignment,
            actual_start_at=local(day, 8),
            actual_end_at=local(day, 20),
            recorded_by="staff-1",
        )


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _grant(user_id, division):
    UserRole.objects.create(
        user_id=user_id, role_code_id="VIEWER", scope_division_id=division.id
    )


def _summary(client, division_id, date_from=D_FROM, date_to=D_TO, **extra):
    params = {
        "division_id": str(division_id),
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        **extra,
    }
    return client.get(reverse("ops-load-summary"), params)


def test_summary_happy_200_with_overload(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-A")
    emp = _employee(div, 9400)
    obj = _facility_object()
    _overload_series(obj, str(emp.id), D_FROM.day)
    _grant("viewer", div)

    resp = _summary(_client("viewer"), div.id)

    assert resp.status_code == 200, resp.content
    assert resp.data["division_id"] == str(div.id)
    entries = {e["employee_id"]: e["overload_days"] for e in resp.data["employees"]}
    assert str(emp.id) in entries
    assert len(entries[str(emp.id)]) == 4


def test_summary_employee_without_overload_empty_list(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-B")
    emp = _employee(div, 9401)
    _grant("viewer", div)

    resp = _summary(_client("viewer"), div.id)

    assert resp.status_code == 200, resp.content
    entries = {e["employee_id"]: e["overload_days"] for e in resp.data["employees"]}
    assert entries.get(str(emp.id)) == []


def test_summary_without_permission_403(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-C")
    _employee(div, 9402)
    resp = _summary(_client("nobody"), div.id)
    assert resp.status_code == 403


def test_summary_foreign_scope_403(org_type):
    org, dtp = org_type
    target = _division(org, dtp, "LOAD-D")
    other = _division(org, dtp, "LOAD-E")
    _employee(target, 9403)
    _grant("viewer", other)
    resp = _summary(_client("viewer"), target.id)
    assert resp.status_code == 403


def test_summary_missing_params_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-F")
    _grant("viewer", div)
    resp = _client("viewer").get(reverse("ops-load-summary"))
    assert resp.status_code == 400


def test_summary_inverted_range_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-G")
    _grant("viewer", div)
    resp = _summary(_client("viewer"), div.id, date_from=D_TO, date_to=D_FROM)
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_summary_range_too_long_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-H")
    _grant("viewer", div)
    resp = _summary(
        _client("viewer"), div.id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 1)
    )
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_summary_nonexistent_division_404(org_type):
    """404 requires an org-wide (unscoped) grant — a division-scoped holder
    hits the scope guard first (403), never the existence oracle."""
    org, dtp = org_type
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    resp = _summary(_client("viewer"), uuid.uuid4())
    assert resp.status_code == 404


def test_summary_custom_threshold_changes_result(org_type):
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-J")
    emp = _employee(div, 9404)
    obj = _facility_object()
    _overload_series(obj, str(emp.id), D_FROM.day)
    _grant("viewer", div)

    resp = _summary(_client("viewer"), div.id, threshold_hours="20")

    assert resp.status_code == 200, resp.content
    entries = {e["employee_id"]: e["overload_days"] for e in resp.data["employees"]}
    assert entries[str(emp.id)] == []


def test_summary_nonpositive_threshold_400(org_type):
    """Review (Blind Hunter + Edge Case Hunter): threshold<=0 would flag
    every day with any activity as "overloaded" — reject at the door."""
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-L")
    _grant("viewer", div)

    resp = _summary(_client("viewer"), div.id, threshold_hours="0")

    assert resp.status_code == 400, resp.content


def test_summary_future_date_not_blocked_200(org_type):
    """AC-9: a future date_to is honest-empty (fact-based), not blocked."""
    org, dtp = org_type
    div = _division(org, dtp, "LOAD-K")
    emp = _employee(div, 9405)
    _grant("viewer", div)

    resp = _summary(
        _client("viewer"), div.id, date_from=date(2099, 1, 1), date_to=date(2099, 1, 4)
    )

    assert resp.status_code == 200, resp.content
    entries = {e["employee_id"]: e["overload_days"] for e in resp.data["employees"]}
    assert entries.get(str(emp.id)) == []
