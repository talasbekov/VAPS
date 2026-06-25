"""Story 3.11 — secondment return (FR-15) + DETACHED read-only (FR-16).

Postgres-backed. Covers the two-step return (request → confirm → both legs
completed → derived-return, AC-2/3/4), the FR-16 403 guard (a DETACHED employee
is read-only for status edits, AC-5), and dismissal closing the pair (AC-6).
Time is frozen via clock.override so leg lifecycle state is deterministic.
"""

from datetime import date

import pytest

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import (
    confirm_return,
    create_status,
    initiate_secondment,
    request_return,
)
from apps.operations.statuses.services.dismissal import dismiss_employee

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 15)
START = date(2026, 6, 1)
END = date(2026, 6, 30)

_iin = iter(f"9301013{n:05d}" for n in range(1, 9999))


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ-311")
    dtp = DivisionType.objects.create(code="mgmt311", name="Управление")
    home = Division.objects.create(
        organization=org, type_code=dtp, name="Home", code="HOME-311"
    )
    recv = Division.objects.create(
        organization=org, type_code=dtp, name="Recv", code="RECV-311"
    )
    StatusType.objects.create(
        code="DETACHED", name="Откомандирован", is_hard_block=False,
        priority=40, report_column_code="DETACHED", restricts_editing=True,
    )
    StatusType.objects.create(
        code="ATTACHED", name="Прикомандирован", is_hard_block=False,
        priority=50, report_column_code="ATTACHED",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    return org, home, recv


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_iin), full_name="T", rank_code="",
        position_code="", division=div, **kw,
    )


def _secondment(home, recv, *, start=START, end=END):
    e = _emp(home)
    with clock.override(TODAY):
        sec = initiate_secondment(
            e.id, to_division_id=recv.id,
            date_start=start, date_end=end, actor="home_op",
        )
    return e, sec


# --- AC-2/3/4: two-step return completes both legs, derived-return -----------


def test_request_then_confirm_completes_active_legs(env):
    _org, home, recv = env
    e, sec = _secondment(home, recv)
    with clock.override(TODAY):
        request_return(sec, actor="home_op")
        sec.refresh_from_db()
        assert sec.return_requested_at is not None
        assert sec.return_requested_by == "home_op"
        confirm_return(sec, actor="recv_op")
    sec.refresh_from_db()
    assert sec.return_confirmed_at is not None
    assert sec.return_confirmed_by == "recv_op"
    # Both ACTIVE legs completed as of TODAY (half-open → not active on TODAY).
    sec.out_status.refresh_from_db()
    sec.in_status.refresh_from_db()
    assert sec.out_status.date_end == TODAY
    assert sec.in_status.date_end == TODAY
    # Derived-return: no live status overlaps TODAY → employee derives IN_SERVICE.
    live = EmployeeStatus.objects.filter(
        employee_id=e.id, cancelled_at__isnull=True,
        date_start__lte=TODAY, date_end__gt=TODAY,
    )
    assert not live.exists()


def test_confirm_cancels_planned_legs(env):
    _org, home, recv = env
    # Future secondment → PLANNED legs on TODAY.
    e, sec = _secondment(home, recv, start=date(2026, 7, 1), end=date(2026, 7, 30))
    with clock.override(TODAY):
        request_return(sec, actor="home_op")
        confirm_return(sec, actor="recv_op")
    sec.out_status.refresh_from_db()
    sec.in_status.refresh_from_db()
    assert sec.out_status.cancelled_at is not None  # PLANNED → cancelled
    assert sec.in_status.cancelled_at is not None


def test_confirm_without_request_422(env):
    _org, home, recv = env
    _e, sec = _secondment(home, recv)
    with clock.override(TODAY), pytest.raises(DomainError) as ei:
        confirm_return(sec, actor="recv_op")
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_double_request_422(env):
    _org, home, recv = env
    _e, sec = _secondment(home, recv)
    with clock.override(TODAY):
        request_return(sec, actor="home_op")
        with pytest.raises(DomainError) as ei:
            request_return(sec, actor="home_op")
    assert ei.value.http_status == 422


def test_double_confirm_422(env):
    _org, home, recv = env
    _e, sec = _secondment(home, recv)
    with clock.override(TODAY):
        request_return(sec, actor="home_op")
        confirm_return(sec, actor="recv_op")
        with pytest.raises(DomainError) as ei:
            confirm_return(sec, actor="recv_op")
    assert ei.value.http_status == 422


def test_request_empty_actor_400(env):
    _org, home, recv = env
    _e, sec = _secondment(home, recv)
    with clock.override(TODAY), pytest.raises(DomainError) as ei:
        request_return(sec, actor="")
    assert ei.value.http_status == 400


# --- AC-5: FR-16 — DETACHED employee is read-only (403) ----------------------


def test_fr16_create_status_for_detached_403(env):
    _org, home, recv = env
    e, _sec = _secondment(home, recv)  # e now holds a live DETACHED leg
    with clock.override(TODAY), pytest.raises(DomainError) as ei:
        create_status(
            employee_id=e.id, status_type_code="STUDY",
            date_start=date(2026, 6, 10), date_end=date(2026, 6, 20),
            actor="op",
        )
    assert ei.value.http_status == 403
    assert ei.value.code == "PERMISSION_DENIED"


def test_fr16_reseondment_for_detached_403(env):
    _org, home, recv = env
    e, _sec = _secondment(home, recv)
    other = Division.objects.create(
        organization=_org, type_code=DivisionType.objects.get(code="mgmt311"),
        name="Other", code="OTHER-311",
    )
    with clock.override(TODAY), pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=other.id,
            date_start=START, date_end=END, actor="op",
        )
    assert ei.value.http_status == 403  # already DETACHED → cannot re-second


def test_fr16_non_detached_employee_not_blocked(env):
    _org, home, _recv = env
    e = _emp(home)  # no secondment
    with clock.override(TODAY):
        s = create_status(
            employee_id=e.id, status_type_code="STUDY",
            date_start=date(2026, 6, 10), date_end=date(2026, 6, 20),
            actor="op",
        )
    assert s.status_type_code == "STUDY"


def test_fr16_lifts_after_return(env):
    # After the secondment returns (DETACHED leg completed), editing is allowed.
    _org, home, recv = env
    e, sec = _secondment(home, recv)
    with clock.override(TODAY):
        request_return(sec, actor="home_op")
        confirm_return(sec, actor="recv_op")
        # DETACHED leg now ends TODAY → not live → guard lifts.
        s = create_status(
            employee_id=e.id, status_type_code="STUDY",
            date_start=date(2026, 6, 16), date_end=date(2026, 6, 20),
            actor="op",
        )
    assert s.status_type_code == "STUDY"


# --- AC-6: dismissal closes the pair ----------------------------------------


def test_dismissal_closes_secondment_pair(env):
    _org, home, recv = env
    e, sec = _secondment(home, recv)
    with clock.override(TODAY):
        dismiss_employee(e, date=TODAY, reason="dismissed", actor="op")
    sec.refresh_from_db()
    assert sec.return_confirmed_at is not None  # pair closed by system
    sec.out_status.refresh_from_db()
    assert sec.out_status.date_end == TODAY  # leg truncated by dismissal


def test_dismissal_cancels_planned_secondment_legs(env):
    # Review patch: a FUTURE (PLANNED) secondment's legs aren't truncated by
    # close_active_statuses_on (date_start >= D) — the dismissal must cancel them
    # so the closed pair never references a live leg.
    _org, home, recv = env
    e, sec = _secondment(home, recv, start=date(2026, 7, 1), end=date(2026, 7, 30))
    with clock.override(TODAY):
        dismiss_employee(e, date=TODAY, reason="dismissed", actor="op")
    sec.refresh_from_db()
    assert sec.return_confirmed_at is not None
    sec.out_status.refresh_from_db()
    sec.in_status.refresh_from_db()
    assert sec.out_status.cancelled_at is not None  # PLANNED leg cancelled
    assert sec.in_status.cancelled_at is not None
    # No live leg overlapping the (future) secondment window remains.
    live = EmployeeStatus.objects.filter(
        employee_id=e.id, cancelled_at__isnull=True,
        date_start__lte=date(2026, 7, 15), date_end__gt=date(2026, 7, 15),
    )
    assert not live.exists()
