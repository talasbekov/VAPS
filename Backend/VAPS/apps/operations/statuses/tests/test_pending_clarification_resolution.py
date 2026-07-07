"""Story 3.9 — PENDING_CLARIFICATION («уточняется») first-class.

Postgres-backed (resolution service) + pure (own report column). Covers:
own расход column (AC-1), retro-resolution close+create with sanction (AC-2),
conflict detector on the resolving interval → 422 before write (AC-3), the
amendment no-op seam for E5 (AC-4), and the non-PENDING guard (AC-5).
"""

from datetime import date

import pytest

from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import (
    resolve_pending_clarification,
)
from apps.operations.statuses.services import status_service
from apps.operations.statuses.services.strength_report import (
    REPORT_COLUMN_BY_CODE,
    derive_report,
    resolve_status,
)

D = date(2026, 6, 5)


# --- AC-1: «уточняется» gets its OWN report column (pure, no DB) -------------


def test_pending_clarification_has_own_report_column():
    assert REPORT_COLUMN_BY_CODE["PENDING_CLARIFICATION"] == "PENDING"
    assert REPORT_COLUMN_BY_CODE["PENDING_CLARIFICATION"] != "IN_SERVICE"


def test_pending_resolves_to_its_own_winner_not_in_service():
    rows = [
        {
            "status_type_code": "PENDING_CLARIFICATION",
            "date_start": date(2026, 6, 1),
            "date_end": date(2026, 6, 10),
        }
    ]
    # «уточняется» wins over derived «В строю» — honest, not a false in-service.
    assert resolve_status(rows, D) == "PENDING_CLARIFICATION"


def test_real_fact_beats_pending_clarification():
    # If a real fact-status overlaps, it wins the расход row; «уточняется»
    # only beats the derived default (Решение №1).
    rows = [
        {
            "status_type_code": "PENDING_CLARIFICATION",
            "date_start": date(2026, 6, 1),
            "date_end": date(2026, 6, 10),
        },
        {
            "status_type_code": "VACATION",
            "date_start": date(2026, 6, 1),
            "date_end": date(2026, 6, 10),
        },
    ]
    assert resolve_status(rows, D) == "VACATION"


def test_pending_lands_in_own_column_convergence_holds():
    employees = {"d1": ["e1", "e2"]}
    rows = [
        {
            "employee_id": "e1",
            "status_type_code": "PENDING_CLARIFICATION",
            "date_start": date(2026, 6, 1),
            "date_end": date(2026, 6, 10),
        }
    ]
    result = derive_report(employees, rows, {"d1": 5}, D)
    (row,) = result.rows
    assert row.columns["PENDING"] == 1  # «уточняется» in its own column
    assert row.columns["IN_SERVICE"] == 1  # the other employee (no status)
    assert sum(row.columns.values()) == row.list_total == 2  # convergence


# --- DB fixtures for the resolution service ---------------------------------
# NB: django_db is marked per-test below (not module-level) so the four pure
# tests above keep their "no DB" guarantee.

_iin = iter(f"9101013{n:05d}" for n in range(1, 9999))


@pytest.fixture
def div():
    org = Organization.objects.create(name="HQ", code="HQ-39")
    dtp = DivisionType.objects.create(code="mgmt39", name="Управление")
    return Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-39"
    )


@pytest.fixture
def types(db):
    StatusType.objects.create(
        code="PENDING_CLARIFICATION",
        name="Уточняется",
        is_hard_block=False,
        priority=990,
        report_column_code="PENDING",
    )
    StatusType.objects.create(
        code="SICK_LEAVE",
        name="На больничном",
        is_hard_block=True,
        priority=10,
        report_column_code="SICK",
    )
    StatusType.objects.create(
        code="VACATION",
        name="В отпуске",
        is_hard_block=True,
        priority=20,
        report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY",
        name="Учёба",
        is_hard_block=False,
        priority=32,
        report_column_code="TRAINING",
    )


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_iin),
        full_name="T",
        rank_code="",
        position_code="",
        division=div,
        **kw,
    )


def _pending(emp, start=date(2026, 6, 1), end=date(2026, 6, 10)):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="PENDING_CLARIFICATION",
        date_start=start,
        date_end=end,
        source=EmployeeStatus.Source.USER,
    )


# --- AC-2: retro-resolution close + create, atomic, with sanction -----------


@pytest.mark.django_db
def test_resolve_closes_pending_and_creates_real_status(div, types):
    e = _emp(div)
    pending = _pending(e)
    resolved = resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=date(2026, 6, 3),
        date_end=date(2026, 6, 8),
        actor="op",
        reason="выяснилось: учёба",
    )
    assert resolved.status_type_code == "STUDY"
    assert resolved.source == EmployeeStatus.Source.USER
    pending.refresh_from_db()
    assert pending.cancelled_at is not None  # «уточняется» closed
    assert pending.cancelled_by == "op"
    # Exactly one live status remains (the resolved one); PENDING is cancelled.
    live = EmployeeStatus.objects.filter(employee_id=e.id, cancelled_at__isnull=True)
    assert list(live.values_list("status_type_code", flat=True)) == ["STUDY"]


@pytest.mark.django_db
def test_resolve_empty_reason_400(div, types):
    e = _emp(div)
    pending = _pending(e)
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=date(2026, 6, 3),
            date_end=date(2026, 6, 8),
            actor="op",
            reason="   ",
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    pending.refresh_from_db()
    assert pending.cancelled_at is None  # nothing happened


@pytest.mark.django_db
def test_resolve_empty_actor_400(div, types):
    e = _emp(div)
    pending = _pending(e)
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=date(2026, 6, 3),
            date_end=date(2026, 6, 8),
            actor="",
            reason="r",
        )
    assert ei.value.http_status == 400


# --- AC-3: conflict detector on the resolving interval → 422 before write ----


@pytest.mark.django_db
def test_resolve_hard_conflict_422_nothing_written(div, types):
    e = _emp(div)
    pending = _pending(e)
    # Pre-existing hard status (VACATION) overlapping the resolving interval.
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="VACATION",
        date_start=date(2026, 6, 4),
        date_end=date(2026, 6, 15),
    )
    before = EmployeeStatus.objects.count()
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            pending,
            resolved_type_code="SICK_LEAVE",  # hard, overlaps VACATION
            date_start=date(2026, 6, 6),
            date_end=date(2026, 6, 12),
            actor="op",
            reason="госпиталь",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "OVERLAPPING_HARD_STATUS"
    pending.refresh_from_db()
    assert pending.cancelled_at is None  # PENDING untouched
    assert EmployeeStatus.objects.count() == before  # nothing created


# --- AC-4: amendment no-op seam called with the affected interval -----------


@pytest.mark.django_db
def test_resolve_marks_days_for_amendment(div, types, monkeypatch):
    e = _emp(div)
    pending = _pending(e, start=date(2026, 6, 1), end=date(2026, 6, 10))
    calls = []
    monkeypatch.setattr(
        status_service,
        "mark_days_for_amendment",
        lambda employee_id, intervals, *, actor, reason, triggered_by_status_id=None: (
            calls.append(
                (employee_id, intervals, actor, reason, triggered_by_status_id)
            )
        ),
    )
    resolved = resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=date(2026, 6, 3),
        date_end=date(2026, 6, 12),
        actor="op",
        reason="учёба",
    )
    # 5.4b: the OLD «уточняется» and NEW resolving intervals are passed SEPARATELY
    # (half-open [start, end)), NOT a min/max bounding box — disjoint intervals must
    # not amend the gap. actor/reason flow through; resolved.id is the trigger ref.
    assert len(calls) == 1
    employee_id, intervals, actor, reason, triggered = calls[0]
    assert employee_id == e.id
    assert intervals == [
        (date(2026, 6, 1), date(2026, 6, 10)),  # old «уточняется»
        (date(2026, 6, 3), date(2026, 6, 12)),  # new resolving
    ]
    assert actor == "op"
    assert reason == "учёба"
    assert triggered == resolved.id


# --- AC-5: resolving a non-PENDING status → 422 -----------------------------


@pytest.mark.django_db
def test_resolve_non_pending_status_422(div, types):
    e = _emp(div)
    not_pending = EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
        source=EmployeeStatus.Source.USER,
    )
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            not_pending,
            resolved_type_code="VACATION",
            date_start=date(2026, 6, 3),
            date_end=date(2026, 6, 8),
            actor="op",
            reason="r",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


# --- Review patches: double-resolution + resolve-to-PENDING guards -----------


@pytest.mark.django_db
def test_resolve_already_resolved_pending_422_no_double(div, types):
    # Review patch: re-resolving an already-closed «уточняется» must not
    # overwrite its append-once cancel facts nor create a second status.
    e = _emp(div)
    pending = _pending(e)
    resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=date(2026, 6, 3),
        date_end=date(2026, 6, 8),
        actor="op",
        reason="первое разрешение",
    )
    pending.refresh_from_db()
    first_cancelled_by = pending.cancelled_by
    before = EmployeeStatus.objects.count()
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            pending,
            resolved_type_code="VACATION",
            date_start=date(2026, 6, 4),
            date_end=date(2026, 6, 9),
            actor="op2",
            reason="повторное",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    pending.refresh_from_db()
    assert pending.cancelled_by == first_cancelled_by  # cancel facts intact
    assert EmployeeStatus.objects.count() == before  # no second resolved status


@pytest.mark.django_db
def test_resolve_to_pending_clarification_422(div, types):
    # Review patch: resolution must yield a REAL status, not another placeholder.
    e = _emp(div)
    pending = _pending(e)
    with pytest.raises(DomainError) as ei:
        resolve_pending_clarification(
            pending,
            resolved_type_code="PENDING_CLARIFICATION",
            date_start=date(2026, 6, 3),
            date_end=date(2026, 6, 8),
            actor="op",
            reason="r",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    pending.refresh_from_db()
    assert pending.cancelled_at is None  # nothing happened
