"""Real PostgreSQL sessions must serialize month planning before shift writes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event
from time import monotonic

import pytest
from django.db import close_old_connections, connection

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy, OpsDutyMonthlyPlan, OpsDutyShift, OpsDutyType,
)
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops import duties, duty_log

pytestmark = pytest.mark.django_db(transaction=True)
MONTH = "2026-10"
DAY = date(2026, 10, 15)


@pytest.fixture
def checked_month():
    OpsDutyType.objects.update_or_create(duty_type_code="LOCK_DUTY", defaults={
        "safe_label": "Lock duty", "target_type": "OWN_OBJECT",
        "default_duration_minutes": 60, "requires_senior": False,
        "rest_after_minutes": 0, "requires_current_passport": False,
    })
    OpsDutyConflictPolicy.objects.update_or_create(singleton_key=1, defaults={
        "version": "lock-policy", "rest_after_duty_mode": "HARD_BLOCK",
    })
    row = OpsDutyShift.objects.create(business_date=DAY, duty_type_code="LOCK_DUTY",
        target={}, employee_id=None, employee_name="Lock person", state_code="PLANNED")
    duties.create_draft(MONTH)
    assert duties.check_plan(MONTH).last_validation["passed"]
    _, user = client_for("month-lock-manager", "MONTH_LOCK_MANAGER", ("duty.view", "duty.manage"))
    return row, str(user.pk)


def run_session(operation, started, state):
    close_old_connections()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET statement_timeout = '12000ms'")
            cursor.execute("SELECT pg_backend_pid()")
            state["pid"] = cursor.fetchone()[0]
        started.set()
        try:
            operation()
            return "ok"
        except DomainError as error:
            return error.code
    finally:
        close_old_connections()


def waits_on(future, waiting, holder):
    """Observe PostgreSQL's lock graph; completion is a failed serialization."""
    deadline = monotonic() + 10
    while monotonic() < deadline:
        if future.done():
            return False
        with connection.cursor() as cursor:
            cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))", [holder, waiting])
            if cursor.fetchone()[0]:
                return True
        Event().wait(0.01)
    raise AssertionError("The second session neither blocked nor completed")


def cancel_operation(row, actor, route):
    if route == "register":
        return lambda: duty_log.cancel_record(actor, f"PLAN:{row.pk}", "Concurrent cancellation")
    return lambda: duties.cancel_shift(row.pk, reason="Concurrent cancellation", actor=actor)


@pytest.mark.parametrize("route", ["legacy", "register"])
def test_cancel_first_makes_approval_wait_and_reject_stale_validation(checked_month, monkeypatch, route):
    row, actor = checked_month
    observed, release = Event(), Event()
    original = duties._plan_locked

    def pause_after_draft_read(day):
        result = original(day)
        assert not result
        observed.set()
        assert release.wait(10), "Cancellation release timed out"
        return result

    monkeypatch.setattr(duties, "_plan_locked", pause_after_draft_read)
    cancel_started, approve_started = Event(), Event()
    cancel_state, approve_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        cancellation = executor.submit(run_session, cancel_operation(row, actor, route), cancel_started, cancel_state)
        try:
            assert observed.wait(10), "Cancellation never checked the month"
            approval = executor.submit(run_session, lambda: duties.approve_plan(MONTH, actor="approver"), approve_started, approve_state)
            assert approve_started.wait(10)
            serialized = waits_on(approval, approve_state["pid"], cancel_state["pid"])
        finally:
            release.set()
        assert cancellation.result(timeout=15) == "ok"
        approval_result = approval.result(timeout=15)
    assert serialized, "Approval bypassed the cancellation's month lock"
    assert approval_result == "PLAN_NOT_APPROVABLE"
    row.refresh_from_db()
    assert row.state_code == "CANCELLED"
    assert OpsDutyMonthlyPlan.objects.get(month=MONTH).state_code == "DRAFT"


@pytest.mark.parametrize("route", ["legacy", "register"])
def test_approval_first_makes_cancel_wait_then_refuse_approved_month(checked_month, monkeypatch, route):
    row, actor = checked_month
    observed, release = Event(), Event()
    original = duties._lock_plan

    def pause_with_plan_locked(month):
        record = original(month)
        observed.set()
        assert release.wait(10), "Approval release timed out"
        return record

    monkeypatch.setattr(duties, "_lock_plan", pause_with_plan_locked)
    cancel_started, approve_started = Event(), Event()
    cancel_state, approve_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        approval = executor.submit(run_session, lambda: duties.approve_plan(MONTH, actor="approver"), approve_started, approve_state)
        try:
            assert observed.wait(10), "Approval never locked the month"
            cancellation = executor.submit(run_session, cancel_operation(row, actor, route), cancel_started, cancel_state)
            assert cancel_started.wait(10)
            serialized = waits_on(cancellation, cancel_state["pid"], approve_state["pid"])
        finally:
            release.set()
        assert approval.result(timeout=15) == "ok"
        cancellation_result = cancellation.result(timeout=15)
    assert serialized, "Cancellation bypassed the approval's month lock"
    assert cancellation_result == "PLAN_APPROVED_LOCKED"
    row.refresh_from_db()
    assert row.state_code == "PLANNED"
    assert OpsDutyMonthlyPlan.objects.get(month=MONTH).state_code == "APPROVED"


@pytest.mark.parametrize("route", ["legacy", "register"])
@pytest.mark.parametrize("operation,initial", [("acknowledge", "PLANNED"), ("start", "ACKNOWLEDGED"), ("complete", "ACTIVE")])
def test_execution_uses_month_before_shift_without_blocking_approved_execution(checked_month, monkeypatch, route, operation, initial):
    row, actor = checked_month
    row.state_code = initial
    if operation == "complete":
        from organization_management.apps.operations.clock import Clock
        row.actual_start = Clock.now()
    row.save()
    duties.check_plan(MONTH)
    observed, release = Event(), Event()
    original = duties._lock_plan

    def pause_with_plan_locked(month):
        record = original(month)
        observed.set()
        assert release.wait(10), "Approval release timed out"
        return record

    monkeypatch.setattr(duties, "_lock_plan", pause_with_plan_locked)
    if route == "register":
        execute = lambda: duty_log.mark_execution(actor, f"PLAN:{row.pk}", operation)
    else:
        transition = {"acknowledge": duties.acknowledge_shift, "start": duties.clock_in_shift, "complete": duties.clock_out_shift}[operation]
        execute = lambda: transition(row.pk)
    execute_started, approve_started = Event(), Event()
    execute_state, approve_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        approval = executor.submit(run_session, lambda: duties.approve_plan(MONTH, actor="approver"), approve_started, approve_state)
        try:
            assert observed.wait(10)
            execution = executor.submit(run_session, execute, execute_started, execute_state)
            assert execute_started.wait(10)
            serialized = waits_on(execution, execute_state["pid"], approve_state["pid"])
        finally:
            release.set()
        approval_result = approval.result(timeout=15)
        execution_result = execution.result(timeout=15)
    assert serialized, "Execution took a shift lock before the month lock"
    assert approval_result == execution_result == "ok"
    row.refresh_from_db()
    assert row.state_code == {"acknowledge": "ACKNOWLEDGED", "start": "ACTIVE", "complete": "COMPLETED"}[operation]
    assert OpsDutyMonthlyPlan.objects.get(month=MONTH).state_code == "APPROVED"


def test_absent_plan_month_still_serializes_cancel_and_new_plan(checked_month, monkeypatch):
    row, actor = checked_month
    OpsDutyMonthlyPlan.objects.filter(month=MONTH).delete()
    observed, release = Event(), Event()
    original = duties._plan_locked

    def pause_after_absent_plan(day):
        result = original(day)
        assert not result
        observed.set()
        assert release.wait(10)
        return result

    def build_and_approve():
        from django.db import transaction
        with transaction.atomic():
            duties.create_draft(MONTH)
            duties.check_plan(MONTH)
            duties.approve_plan(MONTH, actor="approver")

    monkeypatch.setattr(duties, "_plan_locked", pause_after_absent_plan)
    cancel_started, plan_started = Event(), Event()
    cancel_state, plan_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        cancellation = executor.submit(run_session, cancel_operation(row, actor, "legacy"), cancel_started, cancel_state)
        try:
            assert observed.wait(10)
            plan = executor.submit(run_session, build_and_approve, plan_started, plan_state)
            assert plan_started.wait(10)
            serialized = waits_on(plan, plan_state["pid"], cancel_state["pid"])
        finally:
            release.set()
        assert cancellation.result(timeout=15) == plan.result(timeout=15) == "ok"
    assert serialized, "A newly created monthly row bypassed an in-flight shift mutation"
    row.refresh_from_db()
    assert row.state_code == "CANCELLED"
    record = OpsDutyMonthlyPlan.objects.get(month=MONTH)
    assert record.state_code == "APPROVED"
    assert record.last_validation["planFingerprint"] == ""


@pytest.mark.parametrize("first", ["creation", "approval"])
def test_shift_creation_and_approval_share_the_month_lock(checked_month, monkeypatch, first):
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.ops.tests.test_ops_security_events_api import make_object

    _, actor = checked_month
    person = Employee.objects.create(personnel_number="month-new-person", first_name="New", last_name="Person",
                                     birth_date=None, hire_date=None)
    obj = make_object(code="MONTH-LOCK-OBJ")
    create = lambda: duties.create_shift(business_date="2026-10-20", duty_type_code="LOCK_DUTY",
        object_id=str(obj.pk), sector_id=None, post_id=None, employee_id=str(person.pk),
        note=None, override=False, override_reason="", actor=actor)
    approve = lambda: duties.approve_plan(MONTH, actor="approver")
    observed, release = Event(), Event()
    if first == "creation":
        original = duties._plan_locked

        def pause(day):
            value = original(day)
            observed.set()
            assert release.wait(10)
            return value

        monkeypatch.setattr(duties, "_plan_locked", pause)
        leader, follower = create, approve
    else:
        original = duties._lock_plan

        def pause(month):
            value = original(month)
            observed.set()
            assert release.wait(10)
            return value

        monkeypatch.setattr(duties, "_lock_plan", pause)
        leader, follower = approve, create
    leader_started, follower_started = Event(), Event()
    leader_state, follower_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        leading = executor.submit(run_session, leader, leader_started, leader_state)
        try:
            assert observed.wait(10)
            following = executor.submit(run_session, follower, follower_started, follower_state)
            assert follower_started.wait(10)
            serialized = waits_on(following, follower_state["pid"], leader_state["pid"])
        finally:
            release.set()
        leader_result = leading.result(timeout=15)
        follower_result = following.result(timeout=15)
    assert serialized, "Creation and approval did not serialize on the month"
    assert leader_result == "ok"
    assert follower_result == ("PLAN_NOT_APPROVABLE" if first == "creation" else "PLAN_APPROVED_LOCKED")
    assert OpsDutyShift.objects.filter(employee_id=str(person.pk)).exists() is (first == "creation")
