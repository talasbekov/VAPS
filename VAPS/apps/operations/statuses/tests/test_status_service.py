"""Story 3.3 — status creation/edit service with validations (FR-10).

Postgres-backed (ARCH-DATA-020). Covers every AC: date-range/employment/
duration/type/hard-overlap validations (422), employee lock (AC-6), source=USER
(AC-7), the 3.2 edit guard (AC-8), closed-world codes (AC-9), derived state on a
fresh row (AC-10), and the IntegrityError→422 backstop through REAL DRF dispatch
(deferred-work.md L165-166).
"""

import re
from datetime import date, timedelta
from pathlib import Path

import pytest
from django.conf import settings
from django.db import transaction
from hypothesis import HealthCheck, given, settings as hyp_settings
from hypothesis import strategies as st
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.core.selectors import CoreEmployeeLockSelector
from apps.operations.statuses.conflict_matrix import ConflictReport
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import status_service
from apps.operations.statuses.services.status_service import (
    cancel_status,
    create_status,
    update_status,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def env(db):
    """Org/div + the two status types the suite leans on: VACATION (hard,
    in HARD_STATUS_TYPE_CODES) and STUDY (soft, no duration limit)."""
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
    return div


_IIN = iter(f"9001013{n:05d}" for n in range(1, 9999))


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_IIN), full_name="T", rank_code="MAJOR",
        position_code="OPER", division=div, **kw,
    )


# -- AC-3: empty / inverted interval, single-day valid -----------------------


def test_empty_interval_rejected(env):
    emp = _emp(env)
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 1), actor="op",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_DATE_RANGE"
    assert EmployeeStatus.objects.count() == 0


def test_inverted_interval_rejected(env):
    emp = _emp(env)
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 1), actor="op",
        )
    assert ei.value.code == "INVALID_DATE_RANGE"


def test_single_day_interval_valid(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 2), actor="op",
    )
    assert s.pk is not None
    assert s.source == EmployeeStatus.Source.USER  # AC-7


# -- AC-4: status type existence / active ------------------------------------


def test_unknown_status_type_rejected(env):
    emp = _emp(env)
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="NOPE",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 5), actor="op",
        )
    assert ei.value.code == "INVALID_STATUS_TYPE"


def test_inactive_status_type_rejected(env):
    emp = _emp(env)
    StatusType.objects.create(
        code="GONE", name="x", is_hard_block=False, priority=900,
        report_column_code="OTHER", is_active=False,
    )
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="GONE",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 5), actor="op",
        )
    assert ei.value.code == "INVALID_STATUS_TYPE"


# -- AC-1: employment boundaries ---------------------------------------------


def test_date_before_hire_rejected(env):
    emp = _emp(env, hire_date=date(2026, 6, 1))
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 5, 20), date_end=date(2026, 6, 10), actor="op",
        )
    assert ei.value.code == "DATE_OUTSIDE_EMPLOYMENT"


def test_date_after_dismissal_rejected(env):
    emp = _emp(env, dismissal_date=date(2026, 6, 30))
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 25), date_end=date(2026, 7, 5), actor="op",
        )
    assert ei.value.code == "DATE_OUTSIDE_EMPLOYMENT"


def test_within_employment_valid(env):
    emp = _emp(env, hire_date=date(2026, 1, 1), dismissal_date=date(2026, 12, 31))
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    assert s.pk is not None


# -- AC-2: max duration by type ----------------------------------------------


def test_max_duration_exceeded(env):
    emp = _emp(env)
    StatusType.objects.create(
        code="CONFERENCE", name="Конференция", is_hard_block=False,
        priority=36, report_column_code="TRAINING", max_duration_days=5,
    )
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="CONFERENCE",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 7), actor="op",
        )  # 6 days > 5
    assert ei.value.code == "MAX_DURATION_EXCEEDED"


def test_max_duration_at_limit_valid(env):
    emp = _emp(env)
    StatusType.objects.create(
        code="CONFERENCE", name="Конференция", is_hard_block=False,
        priority=36, report_column_code="TRAINING", max_duration_days=5,
    )
    s = create_status(
        employee_id=emp.id, status_type_code="CONFERENCE",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 6), actor="op",
    )  # exactly 5 days
    assert s.pk is not None


def test_no_limit_allows_long_interval(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",  # max_duration_days NULL
        date_start=date(2026, 1, 1), date_end=date(2026, 12, 31), actor="op",
    )
    assert s.pk is not None


# -- AC-5: hard overlap (pre-check + backstop) -------------------------------


def test_hard_overlap_precheck_rejected(env):
    emp = _emp(env)
    create_status(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="VACATION",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "OVERLAPPING_HARD_STATUS"
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1


def test_adjacent_hard_interval_allowed(env):
    # Half-open [) gives adjacency for free: [1,10) then [10,20) do NOT overlap.
    emp = _emp(env)
    create_status(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    s = create_status(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=date(2026, 6, 10), date_end=date(2026, 6, 20), actor="op",
    )
    assert s.pk is not None


def test_soft_overlap_active_returns_409(env):
    # 3.4: overlapping soft statuses now conflict (409, overridable) — the
    # silent-allow of 3.3 is replaced by the matrix detector. The existing
    # status is ACTIVE on the business date (not in the future), so it blocks.
    emp = _emp(env)
    with clock.override(date(2026, 6, 5)):
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        with pytest.raises(DomainError) as ei:
            create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
            )
    assert ei.value.http_status == 409
    assert ei.value.code == "STATUS_OVERLAP_WARNING"
    assert ei.value.overridable is True
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1


def test_soft_overlap_with_planned_is_allowed(env):
    # FR-10: a soft overlap with a not-yet-started (PLANNED) status is a
    # non-blocking warning — creation proceeds. Business date precedes both
    # intervals, so the existing status is PLANNED.
    emp = _emp(env)
    with clock.override(date(2026, 5, 1)):
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        s = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
        )
    assert s.pk is not None
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 2


# -- AC-6: employee lock + missing employee ----------------------------------


def test_missing_employee_returns_404(env):
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id="00000000-0000-0000-0000-000000000000",
            status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 5), actor="op",
        )
    assert ei.value.http_status == 404
    assert ei.value.code == "ENTITY_NOT_FOUND"


def test_create_acquires_employee_lock(env, monkeypatch):
    emp = _emp(env)
    real = CoreEmployeeLockSelector.lock_employee
    calls = []

    def spy(employee_id):
        calls.append(employee_id)
        return real(employee_id)

    monkeypatch.setattr(
        CoreEmployeeLockSelector, "lock_employee", staticmethod(spy)
    )
    create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 5), actor="op",
    )
    assert calls == [emp.id]  # FOR UPDATE acquired during the mutation (AC-6)


def test_blank_actor_rejected(env):
    emp = _emp(env)
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 5), actor="  ",
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"


# -- AC-10: derived state on a freshly created row ---------------------------


def test_created_future_status_is_planned(env):
    emp = _emp(env)
    with clock.override(date(2026, 1, 1)):
        s = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        assert s.state == EmployeeStatus.LifecycleState.PLANNED


def test_created_current_status_is_active(env):
    emp = _emp(env)
    with clock.override(date(2026, 6, 5)):
        s = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        assert s.state == EmployeeStatus.LifecycleState.ACTIVE


# -- AC-8: update guard (unblocks 3.2 assert_user_editable dead code) ---------


def test_update_om_auto_blocked(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    EmployeeStatus.objects.filter(pk=s.pk).update(source=EmployeeStatus.Source.OM_AUTO)
    s.refresh_from_db()
    with pytest.raises(DomainError) as ei:
        update_status(s, actor="op", comment="hacked")
    assert ei.value.http_status == 422
    assert ei.value.code == "AUTO_STATUS_READONLY"
    s.refresh_from_db()
    assert s.comment == ""  # mutation never happened


def test_update_user_applies_change(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    update_status(s, actor="op", comment="уточнение", document_basis="Приказ №9")
    s.refresh_from_db()
    assert s.comment == "уточнение"
    assert s.document_basis == "Приказ №9"


def test_update_invalid_range_rejected(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    with pytest.raises(DomainError) as ei:
        update_status(s, actor="op", date_end=date(2026, 6, 1))  # end == start
    assert ei.value.code == "INVALID_DATE_RANGE"


def test_update_metadata_only_skips_interval_revalidation(env):
    # Review проход 1 (P1): a metadata-only edit must NOT re-validate the
    # interval/type. Editing a comment on a USER status whose type was later
    # deactivated must succeed — re-validation is gated on a real date change.
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    StatusType.objects.filter(code="STUDY").update(is_active=False)
    update_status(s, actor="op", comment="заметка")  # must not raise
    s.refresh_from_db()
    assert s.comment == "заметка"


def test_update_cancelled_status_rejected(env):
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    with clock.override(date(2026, 5, 1)):  # PLANNED → cancellable
        cancel_status(s, actor="op", reason="ошибка")
    with pytest.raises(DomainError) as ei:
        update_status(s, actor="op", date_end=date(2026, 6, 20))
    assert ei.value.http_status == 422
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.date_end == date(2026, 6, 10)  # cancelled interval untouched


def test_update_stale_object_after_concurrent_cancel_rejected(env):
    # Race repro (ретро E3): оператор A отменяет; правка оператора B входит со
    # STALE in-memory строкой (cancelled_at=None). Лок на employee их
    # сериализует, но только refresh_from_db ПОД локом даёт гварду B увидеть
    # закоммиченную отмену — без него B молча переписывает даты отменённого
    # интервала.
    emp = _emp(env)
    s = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    stale = EmployeeStatus.objects.get(pk=s.pk)  # снимок B до отмены
    with clock.override(date(2026, 5, 1)):
        cancel_status(s, actor="op-a", reason="ошибка")
    assert stale.cancelled_at is None  # действительно устаревший объект
    with pytest.raises(DomainError) as ei:
        update_status(stale, actor="op-b", date_end=date(2026, 6, 20))
    assert ei.value.code == "INVALID_LIFECYCLE_TRANSITION"
    s.refresh_from_db()
    assert s.date_end == date(2026, 6, 10)
    assert s.cancelled_at is not None  # cancel-факты не затёрты


# -- AC-5 backstop via REAL DRF dispatch (deferred-work.md L165-166) ----------


class _RawOverlapView(APIView):
    """Raw create that bypasses the service pre-check, so the DB constraint +
    §36 handler are exercised end-to-end through real dispatch. The savepoint
    keeps the surrounding transaction usable (the forward-hook's concern)."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        with transaction.atomic():
            EmployeeStatus.objects.create(
                employee_id=request.data["employee_id"],
                status_type_code="VACATION",
                date_start=date(2026, 1, 5),
                date_end=date(2026, 1, 15),
            )
        return Response(status=201)


def test_hard_overlap_via_real_dispatch_returns_422(env):
    eid = "33333333-3333-3333-3333-333333333333"
    EmployeeStatus.objects.create(
        employee_id=eid, status_type_code="VACATION",
        date_start=date(2026, 1, 1), date_end=date(2026, 1, 10),
    )
    request = APIRequestFactory().post("/x", {"employee_id": eid}, format="json")
    response = _RawOverlapView.as_view()(request)
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"


class _ServiceCreateView(APIView):
    """Drives create_status itself, so its OWN nested savepoint INSERT is the
    one that trips the constraint — closes the coverage gap review проход 1
    flagged (the _RawOverlapView test bypasses the service)."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        create_status(
            employee_id=request.data["employee_id"],
            status_type_code="VACATION",
            date_start=date(2026, 3, 5),
            date_end=date(2026, 3, 15),
            actor="op",
        )
        return Response(status=201)


def test_service_savepoint_integrityerror_maps_to_422(env, monkeypatch):
    # Neutralize the matrix pre-check so create_status's OWN savepoint-wrapped
    # INSERT trips the GiST excl_hard_status_overlap → IntegrityError → §36
    # handler → 422 through REAL DRF dispatch (AC-5, deferred-work L165-166).
    # The constraint (baked in migration 0001) blocks hard×hard regardless of
    # the Python-level matrix — proving the service savepoint path, not just raw.
    monkeypatch.setattr(
        status_service, "detect_conflicts", lambda **kw: ConflictReport()
    )
    emp = _emp(env)
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=date(2026, 3, 1), date_end=date(2026, 3, 10),
    )
    request = APIRequestFactory().post(
        "/x", {"employee_id": str(emp.id)}, format="json"
    )
    response = _ServiceCreateView.as_view()(request)
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"


# -- AC-9: closed world — the new codes exist in the registry (422) ----------


def _registry_block(code):
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    return re.search(rf"^  {code}:\n((?:    .*\n)+)", text, re.M)


@pytest.mark.parametrize(
    "code",
    [
        "INVALID_DATE_RANGE",
        "MAX_DURATION_EXCEEDED",
        "DATE_OUTSIDE_EMPLOYMENT",
        "INVALID_STATUS_TYPE",
    ],
)
def test_new_code_in_registry(code):
    block = _registry_block(code)
    assert block, f"{code} missing from error-codes.yaml"
    assert "http_status: 422" in block.group(1)


# -- property: range-validation totality (AC-3) ------------------------------


@pytest.mark.property
@hyp_settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    start=st.dates(min_value=date(2024, 1, 1), max_value=date(2028, 12, 31)),
    span=st.integers(min_value=-5, max_value=400),
)
def test_range_validation_totality(env, start, span):
    # STUDY is soft + no limit + employee has no employment bounds → only the
    # interval check decides: span<=0 (empty/inverted) ALWAYS 422; span>=1 OK.
    # env (and thus this employee) is shared across hypothesis examples.
    emp, _ = Employee.objects.get_or_create(
        iin="911111100001",
        defaults=dict(
            full_name="P", rank_code="MAJOR", position_code="OPER", division=env
        ),
    )
    end = start + timedelta(days=span)
    if span <= 0:
        with pytest.raises(DomainError) as ei:
            create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=start, date_end=end, actor="op",
            )
        assert ei.value.code == "INVALID_DATE_RANGE"
    else:
        s = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=start, date_end=end, actor="op",
        )
        assert s.pk is not None
        assert s.source == EmployeeStatus.Source.USER
        # 3.4: overlapping soft statuses now 409 — drop the row so accumulation
        # across hypothesis examples on the shared employee can't self-collide.
        s.delete()
