"""Story 6.10b — «на завтра» HTTP surface (TOMORROW_BLOCKED + override endpoint).

Wraps requests in clock.override so Clock.today_local() is deterministic and a
future business_date is genuinely «tomorrow». Block/override derive is proven at
service level (5.6a/5.6b); this pins the HTTP contract only.
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
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import (
    SubmissionControlSettings,
    TomorrowBlockOverride,
)
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 8)
TOMORROW = TODAY + timedelta(days=1)
YESTERDAY = TODAY - timedelta(days=1)
_iin = itertools.count(7700)


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-TB")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dtp


def _division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {code}", code=code
    )


def _populate(division):
    n = next(_iin)
    emp = Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )
    Employee.objects.create(
        iin=f"{next(_iin):012d}",
        full_name="Второй",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=date(2026, 7, 1),
        date_end=date(2026, 7, 20),
        source="USER",
    )
    DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=3,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def _require(*division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


def _grant(user_id, division, role="ORGD"):
    UserRole.objects.create(
        user_id=user_id, role_code_id=role, scope_division_id=division.id
    )


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _issue(client, division, business_date):
    return client.post(
        reverse("ops-expense-report-list"),
        {"division_id": str(division.id), "business_date": business_date.isoformat()},
        format="json",
    )


def _override(client, business_date, reason="приказ №5"):
    return client.post(
        reverse("ops-expense-report-override-tomorrow-block"),
        {"business_date": business_date.isoformat(), "reason": reason},
        format="json",
    )


# --- TOMORROW_BLOCKED on issue ---------------------------------------------


def test_issue_tomorrow_blocked_422(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "TB-A")
    _populate(div)
    _require(div.id)  # required, not submitted for tomorrow
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, TOMORROW)
    assert resp.status_code == 422
    assert resp.data["error_code"] == "TOMORROW_BLOCKED"
    assert str(div.id) in resp.data["details"]["laggards"]


def test_issue_tomorrow_not_blocked_when_all_submitted(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "TB-B")
    _populate(div)
    _require(div.id)
    _grant("orgd", div)
    with clock.override(TODAY):
        submit_day(division_id=div.id, business_date=TOMORROW, actor="op-1")
        resp = _issue(_client("orgd"), div, TOMORROW)
    assert resp.status_code == 201, resp.content


def test_issue_past_date_never_blocked(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "TB-C")
    _populate(div)
    _require(div.id)  # not submitted — but past is never blocked (FR-18)
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, YESTERDAY)
    # Not TOMORROW_BLOCKED: past falls through to the service's own not-ready 409.
    assert resp.status_code == 409
    assert resp.data["error_code"] == "REPORT_NOT_READY_FOR_DATE"


def test_stale_only_laggards_lift_the_block(org_type, storage):
    # Review D1 2026-07-13: the filter runs BEFORE the block decision — a
    # ghost-only required list must NOT hold an unliftable block with
    # laggards=[]; the request falls through to the ordinary not-ready 409.
    org, dtp = org_type
    div = _division(org, dtp, "TB-D")
    _populate(div)
    _require(uuid.uuid4())  # a required id whose division does not exist
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, TOMORROW)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "REPORT_NOT_READY_FOR_DATE"


def test_inactive_required_division_is_filtered(org_type, storage):
    # AC-5: «неактивного» — a deactivated division must not block either.
    org, dtp = org_type
    div = _division(org, dtp, "TB-D2")
    _populate(div)
    inactive = _division(org, dtp, "TB-D3")
    inactive.is_active = False
    inactive.save(update_fields=["is_active"])
    _require(inactive.id)
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, TOMORROW)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "REPORT_NOT_READY_FOR_DATE"


def test_mixed_stale_and_live_laggards(org_type, storage):
    # A live laggard still blocks; only the ghost is filtered from the list.
    org, dtp = org_type
    div = _division(org, dtp, "TB-D4")
    live = _division(org, dtp, "TB-D5")
    _populate(div)
    _require(uuid.uuid4(), live.id)
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, TOMORROW)
    assert resp.status_code == 422
    assert resp.data["error_code"] == "TOMORROW_BLOCKED"
    assert resp.data["details"]["laggards"] == [str(live.id)]


def test_issue_today_not_blocked(org_type, storage):
    # The «== today» boundary of the gate's `<=` (review pin): today is never
    # consulted for a tomorrow-block — falls through to the plain 409.
    org, dtp = org_type
    div = _division(org, dtp, "TB-D6")
    _populate(div)
    _require(div.id)  # required and NOT submitted — still no tomorrow-block
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _issue(_client("orgd"), div, TODAY)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "REPORT_NOT_READY_FOR_DATE"


# --- override endpoint ------------------------------------------------------


def test_override_lifts_block_and_issue_succeeds(org_type, storage):
    # Review 2026-07-13: the Task-5 claim «выпуск проходит» must end in a REAL
    # 201 — two-division setup: A issues (and submitted), B is the laggard.
    org, dtp = org_type
    issuing = _division(org, dtp, "TB-E")
    laggard = _division(org, dtp, "TB-E2")
    _populate(issuing)
    _require(laggard.id)
    _grant("orgd", issuing)
    client = _client("orgd")
    with clock.override(TODAY):
        submit_day(division_id=issuing.id, business_date=TOMORROW, actor="op-1")
        assert _issue(client, issuing, TOMORROW).status_code == 422
        assert _override(client, TOMORROW).status_code == 201
        after = _issue(client, issuing, TOMORROW)
    assert after.status_code == 201, after.content
    # The override is a durable accountability record (review pin).
    record = TomorrowBlockOverride.objects.get(business_date=TOMORROW)
    assert record.overridden_by == "orgd"
    assert record.reason == "приказ №5"


def test_override_without_permission_403(org_type, storage):
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    with clock.override(TODAY):
        assert _override(_client("viewer"), TOMORROW).status_code == 403


def test_override_past_date_400(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "TB-G")
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _override(_client("orgd"), YESTERDAY)
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_override_duplicate_409(org_type, storage):
    # Review D2 2026-07-13 (Д2-дефолт): a duplicate is a STATE conflict (409,
    # distinguished via ValueError.__cause__ IntegrityError), not a form error.
    org, dtp = org_type
    div = _division(org, dtp, "TB-H")
    _grant("orgd", div)
    client = _client("orgd")
    with clock.override(TODAY):
        assert _override(client, TOMORROW).status_code == 201
        dup = _override(client, TOMORROW)
    assert dup.status_code == 409
    assert dup.data["error_code"] == "TOMORROW_BLOCK_ALREADY_OVERRIDDEN"


def test_override_today_400(org_type, storage):
    # The «== today» boundary of the override validation (review pin).
    org, dtp = org_type
    div = _division(org, dtp, "TB-H2")
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _override(_client("orgd"), TODAY)
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_override_horizon_boundary_31_ok_32_400(org_type, storage):
    # Review Д3: irrevocable record → cap at +31 days (a year-off typo must
    # not silently pre-lift a future block).
    org, dtp = org_type
    div = _division(org, dtp, "TB-H3")
    _grant("orgd", div)
    client = _client("orgd")
    with clock.override(TODAY):
        at_cap = _override(client, TODAY + timedelta(days=31))
        beyond = _override(client, TODAY + timedelta(days=32))
    assert at_cap.status_code == 201, at_cap.content
    assert beyond.status_code == 400
    assert beyond.data["error_code"] == "VALIDATION_ERROR"
    assert beyond.data["details"]["max_days_ahead"] == 31


def test_override_missing_date_400(org_type, storage):
    # «пусто» из Task 5: absent business_date dies at the serializer as 400.
    org, dtp = org_type
    div = _division(org, dtp, "TB-H4")
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _client("orgd").post(
            reverse("ops-expense-report-override-tomorrow-block"),
            {"reason": "приказ №5"},
            format="json",
        )
    assert resp.status_code == 400


def test_override_blank_reason_400(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp, "TB-I")
    _grant("orgd", div)
    with clock.override(TODAY):
        resp = _override(_client("orgd"), TOMORROW, reason="")
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"
