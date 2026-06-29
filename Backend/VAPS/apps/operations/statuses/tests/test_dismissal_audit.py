"""Story 4.7 — audit of employee dismissal: one composite EMPLOYEE_DISMISSED event.

Postgres-backed. The dismissal orchestrator (operations ``dismiss_employee``) emits
exactly ONE before/after audit event via ``audit.services.record()`` — mirror of
SECONDMENT_RETURNED (4.4). Status truncation (``close_active_statuses_on``) and
secondment/leg closes go through direct ``.save()`` (NOT the lifecycle helpers
``cancel_status``/``complete_status_early``), so there are NO per-status / per-leg
events; a rejected dismissal leaves no row (caller's ambient txn rolls it back);
request_id flows from the contextvar.
"""

import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.http import HttpResponse
from django.test import RequestFactory

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.middleware import RequestContextMiddleware
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    EmployeeStaffingAssignment,
    Organization,
    Position,
    StaffingSlot,
)
from apps.core.selectors import local_midnight
from apps.core.services import assign_employee_division
from apps.operations.statuses.models import EmployeeStatus, Secondment
from apps.operations.statuses.services.dismissal import dismiss_employee

pytestmark = pytest.mark.django_db

D = dt.date(2026, 6, 15)


def _emp(iin, division):
    return Employee.objects.create(
        iin=iin,
        full_name="T",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
    )


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ-47")
    dtp = DivisionType.objects.create(code="mgmt47", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D-47"
    )
    return org, div


def _count(action):
    return AuditLog.objects.filter(action=action).count()


def _in_request(factory_request, fn):
    """Run fn() inside the middleware so the request-context contextvar is set."""
    holder = {}

    def get_response(req):
        holder["result"] = fn()
        return HttpResponse("ok")

    RequestContextMiddleware(get_response)(factory_request)
    return holder["result"]


def test_dismiss_employee_emits_one_event(setup):
    _, div = setup
    emp = _emp("900101300710", div)
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=dt.date(2026, 6, 10),
        date_end=dt.date(2026, 6, 20),
    )
    with clock.override(D):
        dismiss_employee(emp, date=D, reason="расформирование", actor="op1")
    assert _count("EMPLOYEE_DISMISSED") == 1
    log = AuditLog.objects.get(action="EMPLOYEE_DISMISSED")
    assert log.entity_type == "employee"
    assert log.entity_id == emp.id
    assert log.actor_user_id == "op1"
    # before: WORKING card (entity_id of the row is employee.id, UUID)
    assert log.old_value["employment_status"] == "WORKING"
    assert log.old_value["is_active"] is True
    assert log.old_value["dismissal_date"] is None
    # after: ARCHIVED + the orchestrator's aggregates
    assert log.new_value["employment_status"] == "ARCHIVED"
    assert log.new_value["is_active"] is False
    assert log.new_value["dismissal_date"] == str(D)
    assert log.new_value["separated_at"] is not None  # ARCHIVED datetime captured
    assert log.new_value["statuses_truncated"] == 1
    assert log.new_value["secondments_closed"] == 0
    assert log.reason == "расформирование"  # основание приказа в аудите


def test_dismiss_truncation_emits_no_status_events(setup):
    _, div = setup
    emp = _emp("900101300711", div)
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=dt.date(2026, 6, 10),
        date_end=dt.date(2026, 6, 20),
    )
    with clock.override(D):
        dismiss_employee(emp, date=D, reason="x", actor="op1")
    # truncation is a direct .save() (not cancel/complete) → no STATUS_* leak
    assert _count("EMPLOYEE_DISMISSED") == 1
    assert _count("STATUS_CANCELLED") == 0
    assert _count("STATUS_COMPLETED") == 0
    assert _count("STATUS_UPDATED") == 0


def test_dismiss_with_secondment_emits_no_secondment_returned(setup):
    _, div = setup
    emp = _emp("900101300712", div)
    # a live secondment whose legs are PLANNED (date_start >= D): the orchestrator
    # cancels them via direct .save(), stamps the pair closed — no SECONDMENT_* event.
    out_leg = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="DETACHED",
        date_start=dt.date(2026, 6, 20),
        date_end=dt.date(2026, 6, 30),
    )
    in_leg = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="ATTACHED",
        date_start=dt.date(2026, 6, 20),
        date_end=dt.date(2026, 6, 30),
    )
    Secondment.objects.create(
        employee_id=emp.id,
        out_status=out_leg,
        in_status=in_leg,
        from_division_id=div.id,
        to_division_id=div.id,
    )
    with clock.override(D):
        result = dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert result["secondments_closed"] == 1
    assert _count("EMPLOYEE_DISMISSED") == 1
    assert _count("SECONDMENT_RETURNED") == 0
    assert _count("STATUS_CANCELLED") == 0
    log = AuditLog.objects.get(action="EMPLOYEE_DISMISSED")
    assert log.new_value["secondments_closed"] == 1


def test_rejected_dismissal_leaves_no_audit(setup):
    _, div = setup
    emp = _emp("900101300713", div)
    # first dismissal succeeds → ARCHIVED; a second is rejected (not WORKING) in
    # _dismiss_core BEFORE record() is reached (record() is the orchestrator's last
    # step) → NO audit row is written at all. We audit SUCCESS only.
    with clock.override(D):
        dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert _count("EMPLOYEE_DISMISSED") == 1
    with clock.override(D):
        with pytest.raises(ValidationError):
            dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert _count("EMPLOYEE_DISMISSED") == 1  # the rejected dismissal wrote NO row


def test_dismissal_audit_carries_request_id(setup):
    _, div = setup
    emp = _emp("900101300714", div)
    request = RequestFactory().post(
        "/x",
        HTTP_X_REQUEST_ID="trace-47",
        REMOTE_ADDR="10.0.0.7",
        HTTP_USER_AGENT="ua/4.7",
    )
    with clock.override(D):
        _in_request(
            request,
            lambda: dismiss_employee(emp, date=D, reason="x", actor="op1"),
        )
    log = AuditLog.objects.get(action="EMPLOYEE_DISMISSED")
    assert log.request_id == "trace-47"
    assert log.ip_address == "10.0.0.7"
    assert log.user_agent == "ua/4.7"


def test_dismiss_clean_employee_emits_zero_counts(setup):
    # an employee with no statuses and no secondments still emits exactly ONE event,
    # with both aggregates at 0 (the count branch for the empty case).
    _, div = setup
    emp = _emp("900101300716", div)
    with clock.override(D):
        dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert _count("EMPLOYEE_DISMISSED") == 1
    log = AuditLog.objects.get(action="EMPLOYEE_DISMISSED")
    assert log.new_value["statuses_truncated"] == 0
    assert log.new_value["secondments_closed"] == 0


def test_rejected_after_partial_mutation_leaves_no_audit(setup):
    # _dismiss_core closes the open division interval (a PARTIAL mutation) BEFORE the
    # staffing-assignment check raises "precedes an assignment start". The orchestrator
    # @transaction.atomic must roll the partial close back AND leave no audit row.
    _, div = setup
    pos = Position.objects.create(code="OPER47", name="Опер")
    slot = StaffingSlot.objects.create(
        division=div,
        position_code=pos,
        valid_from=local_midnight(dt.date(2026, 6, 1)),
    )
    emp = _emp("900101300717", div)
    assign_employee_division(
        emp, div, starts_at=local_midnight(dt.date(2026, 6, 1)), actor="op1"
    )
    # assignment starts AFTER D → dismissal date precedes it → ValidationError, but
    # only after the interval above was already closed inside the same atomic block.
    EmployeeStaffingAssignment.objects.create(
        employee=emp,
        staffing_slot=slot,
        starts_at=local_midnight(dt.date(2026, 6, 20)),
    )
    with clock.override(D):
        with pytest.raises(ValidationError):
            dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert _count("EMPLOYEE_DISMISSED") == 0  # no audit on a rejected dismissal
    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.WORKING
    interval = EmployeeDivisionHistory.objects.get(employee=emp)
    assert interval.ends_at is None  # the partial interval-close was rolled back
