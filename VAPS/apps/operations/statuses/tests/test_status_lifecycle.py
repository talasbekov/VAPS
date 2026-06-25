"""Story 3.6 — lifecycle operations on a status (cancel / early-complete / extend).

Postgres-backed (ARCH-DATA-020). Covers every AC: cancel only PLANNED (422),
append-once cancel facts (cancelled_at/by/reason), early-complete factual ≤ today
(422 future / 422 non-ACTIVE / INVALID_DATE_RANGE inverted), extend later-only with
re-validation + conflict (override closes the 3.5 edit-override defer), the shared
editability/lock guards, and the closed-world INVALID_LIFECYCLE_TRANSITION code.
"""

import re
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from django.conf import settings

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, Override, StatusType
from apps.operations.statuses.services.status_service import (
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def env(db):
    """Org/div + VACATION (hard), STUDY (soft, no limit), CONFERENCE (soft, 5d)."""
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D"
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
    return div


_IIN = iter(f"9001013{n:05d}" for n in range(1, 9999))


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_IIN), full_name="T", rank_code="MAJOR",
        position_code="OPER", division=div, **kw,
    )


def _status(emp, type_code, start, end, **kw):
    """Create a status directly (bypasses create_status validations) so a test
    can place a row in any lifecycle state / source for the op under test."""
    return EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code=type_code,
        date_start=start, date_end=end, **kw,
    )


# == cancel_status — only PLANNED, append-once facts =========================


def test_cancel_planned_sets_append_once_facts(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):  # before start → PLANNED
        cancel_status(s, actor="op", reason="ошибочно заведён")
    s.refresh_from_db()
    assert s.cancelled_at is not None
    assert s.cancelled_by == "op"
    assert s.cancelled_reason == "ошибочно заведён"
    assert s.state == EmployeeStatus.LifecycleState.CANCELLED


def test_cancelled_row_leaves_conflict_perimeter(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):
        cancel_status(s, actor="op", reason="r")
        # A new overlapping status is now creatable — the cancelled row no
        # longer participates in conflict detection (cancelled_at__isnull).
        again = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 10), date_end=date(2026, 6, 20), actor="op",
        )
    assert again.pk is not None


def test_cancel_active_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 5)):  # inside interval → ACTIVE
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op", reason="r")
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.cancelled_at is None  # nothing mutated


def test_cancel_completed_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 20)):  # past end → COMPLETED
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op", reason="r")
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_cancel_already_cancelled_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):
        cancel_status(s, actor="op", reason="first")
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op2", reason="second")
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.cancelled_by == "op"  # append-once: first writer wins
    assert s.cancelled_reason == "first"


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_cancel_empty_reason_rejected(env, reason):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op", reason=reason)
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    s.refresh_from_db()
    assert s.cancelled_at is None


def test_cancel_projection_row_readonly(env):
    emp = _emp(env)
    s = _status(
        emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20),
        source=EmployeeStatus.Source.OM_AUTO,
    )
    with clock.override(date(2026, 6, 1)):
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op", reason="r")
    assert ei.value.code == "AUTO_STATUS_READONLY"


def test_cancel_missing_employee_404(env):
    s = _status(
        type("E", (), {"id": uuid4()})(), "STUDY",
        date(2026, 6, 10), date(2026, 6, 20),
    )
    with clock.override(date(2026, 6, 1)):
        with pytest.raises(DomainError) as ei:
            cancel_status(s, actor="op", reason="r")
    assert ei.value.http_status == 404
    assert ei.value.code == "ENTITY_NOT_FOUND"


# == complete_status_early — factual end ≤ today, ACTIVE only ================


def test_complete_early_active_updates_end(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20))
    with clock.override(date(2026, 6, 10)):  # ACTIVE
        complete_status_early(s, actor="op", actual_end=date(2026, 6, 8))
        s.refresh_from_db()
        assert s.date_end == date(2026, 6, 8)
        assert s.state == EmployeeStatus.LifecycleState.COMPLETED


def test_complete_early_today_is_valid(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20))
    with clock.override(date(2026, 6, 10)):
        complete_status_early(s, actor="op", actual_end=date(2026, 6, 10))
        s.refresh_from_db()
        assert s.date_end == date(2026, 6, 10)
        assert s.state == EmployeeStatus.LifecycleState.COMPLETED


def test_complete_early_future_date_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20))
    with clock.override(date(2026, 6, 10)):
        with pytest.raises(DomainError) as ei:
            complete_status_early(s, actor="op", actual_end=date(2026, 6, 15))
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.date_end == date(2026, 6, 20)  # unchanged


def test_complete_early_before_start_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 5), date(2026, 6, 20))
    with clock.override(date(2026, 6, 10)):
        with pytest.raises(DomainError) as ei:
            complete_status_early(s, actor="op", actual_end=date(2026, 6, 3))
    assert ei.value.code == "INVALID_DATE_RANGE"


def test_complete_early_planned_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):  # PLANNED
        with pytest.raises(DomainError) as ei:
            complete_status_early(s, actor="op", actual_end=date(2026, 6, 1))
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_complete_early_completed_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 20)):  # COMPLETED
        with pytest.raises(DomainError) as ei:
            complete_status_early(s, actor="op", actual_end=date(2026, 6, 5))
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_complete_early_projection_row_readonly(env):
    emp = _emp(env)
    s = _status(
        emp, "STUDY", date(2026, 6, 1), date(2026, 6, 20),
        source=EmployeeStatus.Source.OM_AUTO,
    )
    with clock.override(date(2026, 6, 10)):
        with pytest.raises(DomainError) as ei:
            complete_status_early(s, actor="op", actual_end=date(2026, 6, 8))
    assert ei.value.code == "AUTO_STATUS_READONLY"


# == extend_status — later-only, re-validation, override ====================


def test_extend_later_end_updates(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    extend_status(s, actor="op", new_date_end=date(2026, 6, 15))
    s.refresh_from_db()
    assert s.date_end == date(2026, 6, 15)


def test_extend_not_later_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with pytest.raises(DomainError) as ei:
        extend_status(s, actor="op", new_date_end=date(2026, 6, 8))
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.date_end == date(2026, 6, 10)


def test_extend_past_dismissal_rejected(env):
    emp = _emp(env, dismissal_date=date(2026, 6, 30))
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with pytest.raises(DomainError) as ei:
        extend_status(s, actor="op", new_date_end=date(2026, 7, 5))
    assert ei.value.code == "DATE_OUTSIDE_EMPLOYMENT"


def test_extend_exceeds_max_duration(env):
    emp = _emp(env)
    s = _status(emp, "CONFERENCE", date(2026, 6, 1), date(2026, 6, 6))  # 5d
    with pytest.raises(DomainError) as ei:
        extend_status(s, actor="op", new_date_end=date(2026, 6, 10))  # 9d
    assert ei.value.code == "MAX_DURATION_EXCEEDED"


def test_extend_into_soft_overlap_without_override_409(env):
    emp = _emp(env)
    with clock.override(date(2026, 6, 5)):
        # B is ACTIVE on the business date; A ends before B starts (no overlap).
        _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
        a = _status(emp, "STUDY", date(2026, 5, 1), date(2026, 5, 20))
        with pytest.raises(DomainError) as ei:
            extend_status(a, actor="op", new_date_end=date(2026, 6, 7))
    assert ei.value.http_status == 409
    assert ei.value.code == "STATUS_OVERLAP_WARNING"
    assert ei.value.overridable is True


def test_extend_with_override_bypasses_and_records(env):
    emp = _emp(env)
    with clock.override(date(2026, 6, 5)):
        _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
        a = _status(emp, "STUDY", date(2026, 5, 1), date(2026, 5, 20))
        extend_status(
            a, actor="boss", new_date_end=date(2026, 6, 7),
            override=True, override_reason="подтверждено руководителем",
        )
    a.refresh_from_db()
    assert a.date_end == date(2026, 6, 7)
    ov = Override.objects.get(status=a)
    assert ov.created_by == "boss"
    assert ov.reason == "подтверждено руководителем"
    assert [c["status_type"] for c in ov.conflicts] == ["STUDY"]


def test_extend_override_empty_reason_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with pytest.raises(DomainError) as ei:
        extend_status(
            s, actor="op", new_date_end=date(2026, 6, 15),
            override=True, override_reason="  ",
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"


def test_extend_override_never_bypasses_hard(env):
    emp = _emp(env)
    with clock.override(date(2026, 6, 5)):
        _status(emp, "VACATION", date(2026, 6, 1), date(2026, 6, 10))
        a = _status(emp, "VACATION", date(2026, 5, 1), date(2026, 5, 20))
        with pytest.raises(DomainError) as ei:
            extend_status(
                a, actor="boss", new_date_end=date(2026, 6, 7),
                override=True, override_reason="всё равно",
            )
    assert ei.value.http_status == 422
    assert ei.value.code == "OVERLAPPING_HARD_STATUS"
    assert Override.objects.count() == 0


def test_extend_cancelled_rejected(env):
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):
        cancel_status(s, actor="op", reason="r")
        with pytest.raises(DomainError) as ei:
            extend_status(s, actor="op", new_date_end=date(2026, 6, 25))
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"


def test_extend_projection_row_readonly(env):
    emp = _emp(env)
    s = _status(
        emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10),
        source=EmployeeStatus.Source.OM_AUTO,
    )
    with pytest.raises(DomainError) as ei:
        extend_status(s, actor="op", new_date_end=date(2026, 6, 15))
    assert ei.value.code == "AUTO_STATUS_READONLY"


# == review-pass-1 hardening: concurrency, revival, hard-perimeter ==========


def test_cancel_stale_instance_does_not_overwrite_append_once(env):
    # Two handles to the same PLANNED row; the second is fetched BEFORE the
    # first cancel, so its in-memory cancelled_at is stale (None). _lock_for_edit
    # must refresh under the employee lock and see the committed cancellation,
    # rejecting the stale second cancel — append-once holds (no overwrite).
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 10), date(2026, 6, 20))
    stale = EmployeeStatus.objects.get(pk=s.pk)
    with clock.override(date(2026, 6, 1)):
        cancel_status(s, actor="first", reason="первая отмена")
        with pytest.raises(DomainError) as ei:
            cancel_status(stale, actor="second", reason="вторая")
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.cancelled_by == "first"
    assert s.cancelled_reason == "первая отмена"


def test_extend_completed_status_revives_to_active(env):
    # AC-7 allows extending any non-CANCELLED status. Extending a COMPLETED
    # (in-the-past) status forward past today re-opens it → ACTIVE.
    emp = _emp(env)
    s = _status(emp, "STUDY", date(2026, 6, 1), date(2026, 6, 10))
    with clock.override(date(2026, 6, 20)):  # past end → COMPLETED
        assert s.state == EmployeeStatus.LifecycleState.COMPLETED
        extend_status(s, actor="op", new_date_end=date(2026, 6, 25))
        s.refresh_from_db()
        assert s.date_end == date(2026, 6, 25)
        assert s.state == EmployeeStatus.LifecycleState.ACTIVE


def test_cancelled_hard_row_leaves_exclusion(env):
    # A cancelled HARD row must leave excl_hard_status_overlap (partial index
    # condition cancelled_at__isnull=True), so an overlapping hard status of the
    # same employee becomes insertable — covers the GiST path (existing
    # perimeter test only exercised the soft conflict detector).
    emp = _emp(env)
    s = _status(emp, "VACATION", date(2026, 6, 10), date(2026, 6, 20))
    with clock.override(date(2026, 6, 1)):
        cancel_status(s, actor="op", reason="r")
        again = create_status(
            employee_id=emp.id, status_type_code="VACATION",
            date_start=date(2026, 6, 10), date_end=date(2026, 6, 20), actor="op",
        )
    assert again.pk is not None


# == closed world (AC-10) ====================================================


def _registry_block(code):
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    return re.search(rf"^  {code}:\n((?:    .*\n)+)", text, re.M)


def test_lifecycle_transition_code_in_registry():
    block = _registry_block("INVALID_LIFECYCLE_TRANSITION")
    assert block, "INVALID_LIFECYCLE_TRANSITION missing from error-codes.yaml"
    assert "http_status: 422" in block.group(1)
