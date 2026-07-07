"""Story 4.4 — audit of status mutations: every E3 operation leaves a trace.

Postgres-backed. Proves AC-1..7: each synchronous operator mutation in the E3
services emits exactly one before/after audit event via ``audit.services.record()``
(bulk → N + one summary), override is a separate countable OVERRIDE_APPLIED event
(реш. №3), confirm_return emits ONE SECONDMENT_RETURNED with no per-leg double-emit
(реш. №4), request_id flows from the contextvar, a rejected mutation leaves no audit
row, and every emitted code lives in the registry (closed world).
"""

from datetime import date, datetime, timezone

import pytest
from django.db import connection
from django.http import HttpResponse
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.middleware import RequestContextMiddleware
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import initiate_secondment
from apps.operations.statuses.services.bulk_status_service import (
    bulk_create_statuses,
)
from apps.operations.statuses.services.secondment_service import (
    confirm_return,
    request_return,
)
from apps.operations.statuses.services.status_service import (
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
    resolve_pending_clarification,
    update_status,
)

pytestmark = pytest.mark.django_db

_FROZEN = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def env(db):
    org = Organization.objects.create(name="HQ", code="HQ-44")
    dtp = DivisionType.objects.create(code="mgmt44", name="Управление")
    home = Division.objects.create(
        organization=org, type_code=dtp, name="Home", code="HOME-44"
    )
    recv = Division.objects.create(
        organization=org, type_code=dtp, name="Recv", code="RECV-44"
    )
    StatusType.objects.create(
        code="VACATION", name="В отпуске", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    StatusType.objects.create(
        code="CONFERENCE", name="Конференция", is_hard_block=False,
        priority=36, report_column_code="TRAINING", max_duration_days=5,
    )
    StatusType.objects.create(
        code="DETACHED", name="Откомандирован", is_hard_block=False,
        priority=40, report_column_code="DETACHED",
    )
    StatusType.objects.create(
        code="ATTACHED", name="Прикомандирован", is_hard_block=False,
        priority=50, report_column_code="ATTACHED",
    )
    StatusType.objects.create(
        code="PENDING_CLARIFICATION", name="Уточняется", is_hard_block=False,
        priority=990, report_column_code="PENDING",
    )
    return home, recv


_IIN = iter(f"9401013{n:05d}" for n in range(1, 9999))


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_IIN), full_name="T", rank_code="",
        position_code="", division=div, **kw,
    )


def _status(emp, code, start, end, **kw):
    """Plant a row directly (bypasses create_status → no audit) to isolate the
    single event of the operation under test."""
    return EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code=code,
        date_start=start, date_end=end, **kw,
    )


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


# -- AC-1: one event per operation, before/after, entity_id = employee_id ------


def test_create_status_emits_one_status_created(env):
    home, _ = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        st = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 4), date_end=date(2026, 6, 10), actor="op-1",
        )
    assert AuditLog.objects.count() == 1
    log = AuditLog.objects.get()
    assert log.action == "STATUS_CREATED"
    assert log.entity_type == "employee_status"
    assert log.entity_id == emp.id
    assert log.actor_user_id == "op-1"
    assert log.old_value is None
    assert log.new_value["status_id"] == st.pk
    assert log.new_value["status_type_code"] == "STUDY"


def test_update_status_emits_only_on_change(env):
    home, _ = env
    emp = _emp(home)
    st = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20))
    with clock.override(date(2026, 6, 5)):
        update_status(st, actor="op", comment="новый коммент")
    assert _count("STATUS_UPDATED") == 1
    log = AuditLog.objects.get(action="STATUS_UPDATED")
    assert log.old_value["comment"] != log.new_value["comment"]
    assert log.new_value["comment"] == "новый коммент"
    assert log.entity_id == emp.id
    # A no-op edit (nothing changed) must NOT emit an event.
    with clock.override(date(2026, 6, 5)):
        update_status(st, actor="op")
    assert _count("STATUS_UPDATED") == 1
    # KNOWN wart (value-diff deferred → E10/4.5): a field SUPPLIED equal to its
    # current value still counts as "changed" and STILL emits. Characterised here
    # so the E10 fix is a deliberate flip of this assertion, not a silent change.
    with clock.override(date(2026, 6, 5)):
        update_status(st, actor="op", comment="новый коммент")  # same value
    assert _count("STATUS_UPDATED") == 2


def test_cancel_status_emits_status_cancelled(env):
    home, _ = env
    emp = _emp(home)
    st = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):  # before start → PLANNED
        cancel_status(st, actor="op", reason="ошибка")
    assert _count("STATUS_CANCELLED") == 1
    log = AuditLog.objects.get(action="STATUS_CANCELLED")
    assert log.old_value["cancelled_at"] is None
    assert log.new_value["cancelled_at"] is not None
    assert log.new_value["cancelled_by"] == "op"
    assert log.entity_id == emp.id


def test_complete_status_early_emits_status_completed(env):
    home, _ = env
    emp = _emp(home)
    st = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20))
    with clock.override(date(2026, 6, 10)):  # ACTIVE
        complete_status_early(st, actor="op", actual_end=date(2026, 6, 10))
    assert _count("STATUS_COMPLETED") == 1
    log = AuditLog.objects.get(action="STATUS_COMPLETED")
    assert log.old_value["date_end"] == "2026-06-20"
    assert log.new_value["date_end"] == "2026-06-10"


def test_extend_status_emits_status_extended(env):
    home, _ = env
    emp = _emp(home)
    st = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 5)):
        extend_status(st, actor="op", new_date_end=date(2026, 6, 20))
    assert _count("STATUS_EXTENDED") == 1
    log = AuditLog.objects.get(action="STATUS_EXTENDED")
    assert log.old_value["date_end"] == "2026-06-10"
    assert log.new_value["date_end"] == "2026-06-20"


def test_resolve_pending_emits_clarification_resolved(env):
    home, _ = env
    emp = _emp(home)
    pending = _status(emp, "PENDING_CLARIFICATION", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 5)):
        resolve_pending_clarification(
            pending, resolved_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
            actor="op", reason="госпиталь со вторника",
        )
    assert _count("STATUS_CLARIFICATION_RESOLVED") == 1
    log = AuditLog.objects.get(action="STATUS_CLARIFICATION_RESOLVED")
    assert log.old_value["status_type_code"] == "PENDING_CLARIFICATION"
    assert log.new_value["status_type_code"] == "STUDY"
    assert log.entity_id == emp.id
    # «уточняется» is closed via inline cancel-fact assignment, NOT cancel_status,
    # so the retro-replacement stays ONE composite event (no stray STATUS_CANCELLED).
    assert _count("STATUS_CANCELLED") == 0


# -- AC-4: OVERRIDE_APPLIED is a separate countable event (реш. №3) -----------


def test_create_with_override_emits_status_and_override(env):
    home, _ = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        create_status(  # seed soft → 1 STATUS_CREATED
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        create_status(  # bypass soft → STATUS_CREATED + OVERRIDE_APPLIED
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
            override=True, override_reason="приказ №7",
        )
    assert _count("STATUS_CREATED") == 2
    assert _count("OVERRIDE_APPLIED") == 1
    ov = AuditLog.objects.get(action="OVERRIDE_APPLIED")
    assert ov.entity_type == "override"
    assert ov.entity_id == emp.id
    assert ov.new_value["reason"] == "приказ №7"
    assert ov.new_value["conflicts"][0]["status_type"] == "STUDY"


def test_create_override_without_conflict_emits_no_override_event(env):
    home, _ = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
            override=True, override_reason="на всякий случай",
        )
    assert _count("STATUS_CREATED") == 1
    assert _count("OVERRIDE_APPLIED") == 0  # nothing bypassed → no override event


def test_extend_with_override_emits_status_and_override(env):
    home, _ = env
    emp = _emp(home)
    a = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    # ACTIVE neighbour on the clock date (Jun5) — a PLANNED neighbour would be a
    # non-blocking FR-10 warning, not a bypassable soft conflict.
    _status(emp, "STUDY", date(2026, 6, 2), date(2026, 6, 25))
    with clock.override(date(2026, 6, 5)):
        extend_status(  # extend with an ACTIVE soft overlap present → bypassed
            a, actor="op", new_date_end=date(2026, 6, 15),
            override=True, override_reason="приказ №9",
        )
    assert _count("STATUS_EXTENDED") == 1
    assert _count("OVERRIDE_APPLIED") == 1
    ov = AuditLog.objects.get(action="OVERRIDE_APPLIED")
    assert ov.entity_type == "override"
    assert ov.entity_id == emp.id


def test_resolve_with_override_emits_clarification_and_override(env):
    home, _ = env
    emp = _emp(home)
    pending = _status(emp, "PENDING_CLARIFICATION", date(2026, 6, 1), date(2026, 6, 10))
    _status(emp, "STUDY", date(2026, 6, 5), date(2026, 6, 20))  # soft neighbour
    with clock.override(date(2026, 6, 5)):
        resolve_pending_clarification(
            pending, resolved_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
            actor="op", reason="приказ", override=True, override_reason="обход",
        )
    assert _count("STATUS_CLARIFICATION_RESOLVED") == 1
    assert _count("OVERRIDE_APPLIED") == 1  # extend/resolve override paths also fire
    assert _count("STATUS_CANCELLED") == 0
    ov = AuditLog.objects.get(action="OVERRIDE_APPLIED")
    assert ov.entity_type == "override"
    assert ov.entity_id == emp.id


# -- AC-1: secondments ---------------------------------------------------------


def test_initiate_secondment_emits_one_event(env):
    home, recv = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        sec = initiate_secondment(
            emp.id, to_division_id=recv.id,
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 30), actor="op",
        )
    assert _count("SECONDMENT_INITIATED") == 1
    log = AuditLog.objects.get(action="SECONDMENT_INITIATED")
    assert log.entity_type == "secondment"
    assert log.entity_id == emp.id
    assert log.new_value["secondment_id"] == sec.pk
    assert log.new_value["out_status_id"] == sec.out_status_id
    assert log.new_value["in_status_id"] == sec.in_status_id
    # legs are created via direct .save() (not create_status) → no per-leg event
    assert _count("STATUS_CREATED") == 0


def test_request_return_emits_event(env):
    home, recv = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        sec = initiate_secondment(
            emp.id, to_division_id=recv.id,
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 30), actor="op",
        )
        request_return(sec, actor="home-op")
    assert _count("SECONDMENT_RETURN_REQUESTED") == 1
    log = AuditLog.objects.get(action="SECONDMENT_RETURN_REQUESTED")
    assert log.new_value["return_requested_by"] == "home-op"
    assert log.entity_id == emp.id


# -- AC-5: confirm_return = ONE event, no per-leg double-emit ------------------


def test_confirm_return_emits_single_event_no_leg_double(env):
    home, recv = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 10)):  # legs ACTIVE within [Jun1, Jun30)
        sec = initiate_secondment(
            emp.id, to_division_id=recv.id,
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 30), actor="op",
        )
        request_return(sec, actor="op")
        confirm_return(sec, actor="recv-op")
    assert _count("SECONDMENT_RETURNED") == 1
    # legs were ACTIVE → closed via complete_status_early(_audit=False): NO leg events
    assert _count("STATUS_COMPLETED") == 0
    assert _count("STATUS_CANCELLED") == 0
    log = AuditLog.objects.get(action="SECONDMENT_RETURNED")
    assert log.entity_id == emp.id
    assert len(log.new_value["legs_closed"]) == 2


def test_confirm_return_planned_legs_cancel_no_leg_events(env):
    home, recv = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):  # legs PLANNED — secondment not started
        sec = initiate_secondment(
            emp.id, to_division_id=recv.id,
            date_start=date(2026, 6, 10), date_end=date(2026, 6, 30), actor="op",
        )
        request_return(sec, actor="op")
        confirm_return(sec, actor="recv-op")
    assert _count("SECONDMENT_RETURNED") == 1
    # PLANNED legs → closed via cancel_status(_audit=False): NO leg events leak
    assert _count("STATUS_CANCELLED") == 0
    assert _count("STATUS_COMPLETED") == 0
    log = AuditLog.objects.get(action="SECONDMENT_RETURNED")
    assert len(log.new_value["legs_closed"]) == 2
    assert all(leg["action"] == "cancelled" for leg in log.new_value["legs_closed"])


# -- AC-2: bulk → N per-row STATUS_CREATED + ONE summary, bounded queries ------


def test_bulk_emits_n_plus_one_summary_bounded_queries(env):
    home, _ = env
    emps = [_emp(home) for _ in range(40)]
    rows = [
        {
            "employee_id": e.id, "status_type_code": "STUDY",
            "date_start": date(2026, 6, 4), "date_end": date(2026, 6, 10),
        }
        for e in emps
    ]
    with clock.override(date(2026, 6, 5)):
        with CaptureQueriesContext(connection) as ctx:
            created = bulk_create_statuses(
                rows, actor="op", business_date=date(2026, 6, 5),
                allowed_division_ids={home.id},
            )
    assert len(created) == 40
    assert _count("STATUS_CREATED") == 40
    assert _count("STATUS_BULK_CREATED") == 1
    summary = AuditLog.objects.get(action="STATUS_BULK_CREATED")
    assert summary.new_value["count"] == 40
    assert len(summary.new_value["employee_ids"]) == 40
    # NFR-4: audit writes are bounded (record_many = 1 bulk INSERT + 1 summary),
    # NOT N+1 — the whole point of the bulk path.
    audit_inserts = [
        q for q in ctx.captured_queries
        if "audit_logs" in q["sql"] and "INSERT" in q["sql"].upper()
    ]
    assert len(audit_inserts) <= 2, audit_inserts


# -- AC-6: request_id from contextvar + Clock.now(); rejected → no audit -------


def test_request_id_propagates_to_status_audit(env):
    home, _ = env
    emp = _emp(home)
    request = RequestFactory().post(
        "/x", HTTP_X_REQUEST_ID="trace-44",
        REMOTE_ADDR="10.0.0.5", HTTP_USER_AGENT="ua/1",
    )
    with clock.override(_FROZEN):
        _in_request(
            request,
            lambda: create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=date(2026, 6, 4), date_end=date(2026, 6, 10), actor="op",
            ),
        )
    log = AuditLog.objects.get(action="STATUS_CREATED")
    assert log.request_id == "trace-44"
    assert log.ip_address == "10.0.0.5"
    assert log.created_at == _FROZEN


def test_rejected_mutation_leaves_no_audit(env):
    home, _ = env
    emp = _emp(home)
    with clock.override(date(2026, 6, 5)):
        create_status(
            employee_id=emp.id, status_type_code="VACATION",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        with pytest.raises(DomainError) as ei:
            create_status(  # hard overlap → 422, written nothing
                employee_id=emp.id, status_type_code="VACATION",
                date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
            )
    assert ei.value.http_status == 422
    assert _count("STATUS_CREATED") == 1  # the rejected create left NO audit row


# NB: closed-world enforcement (emitted action codes ⊆ audit-events.yaml) moved to
# the source-derived gate in apps/audit/tests/test_audit_coverage.py (story 4.6) —
# it AST-scans the real record()/record_many() call sites, superseding the static
# _STORY_4_4_ACTIONS literal that used to live here (deferred-work.md:401).
