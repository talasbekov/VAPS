"""Story 3.3 — status creation & edit service with validations (FR-10).

``create_status`` is the single validated write-path for an operator-created
``EmployeeStatus``; ``update_status`` is the thin operator-edit path that wires
the 3.2 ``assert_user_editable()`` guard (Решение №2=A — full lifecycle ops are
story 3.6). Both run under ``CoreEmployeeLockSelector.lock_employee`` (AC-6)
inside ``transaction.atomic`` and wrap the racy write in a savepoint, so the
``excl_hard_status_overlap`` backstop surfaces as 422 via the §36 handler
without poisoning a caller's transaction (deferred-work.md L165-166).

Validation order is cheap→expensive (AC-1..5). Service-side checks deliberately
precede the DB: ``date_start >= date_end`` would otherwise hit the generated
``period`` column as a DataError → 500, bypassing 3.1's mapping
(deferred-work.md L32). The hard-overlap pre-check raises a clean 422; the GiST
constraint is only the race backstop.

ARCH-004: operations → core only through selectors/services, never the model;
``CoreEmployeeLockSelector`` is the sanctioned channel and returns the locked
row, so hire/dismissal bounds are read off it without a second query.
"""

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreEmployeeLockSelector
from apps.operations.statuses.conflict_matrix import detect_conflicts
from apps.operations.statuses.models import (
    EmployeeStatus,
    Override,
    StatusType,
)


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError(
            "VALIDATION_ERROR", 400, message="actor обязателен."
        )


def _lock_employee(employee_id):
    """AC-6: pessimistic lock; missing employee → 404 (not a 500)."""
    try:
        return CoreEmployeeLockSelector.lock_employee(employee_id)
    except ObjectDoesNotExist:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"employee_id": str(employee_id)},
            message="Сотрудник не найден.",
        ) from None


def _resolve_status_type(status_type_code):
    """AC-4: the type must exist in the catalog and be active."""
    status_type = StatusType.objects.filter(
        code=status_type_code, is_active=True
    ).first()
    if status_type is None:
        raise DomainError(
            "INVALID_STATUS_TYPE",
            422,
            detail={"status_type_code": status_type_code},
            message="Тип статуса не найден в справочнике или неактивен.",
        )
    return status_type


def _validate_interval(*, date_start, date_end, employee, status_type):
    # AC-3: empty/inverted interval — caught BEFORE the generated `period`
    # column raises DataError → 500 (deferred-work.md L32). Half-open [s, e):
    # the single-day interval [D, D+1) is valid (1 day).
    if date_start >= date_end:
        raise DomainError(
            "INVALID_DATE_RANGE",
            422,
            detail={"date_start": str(date_start), "date_end": str(date_end)},
            message="Интервал пуст или инвертирован (date_start >= date_end).",
        )
    # AC-1: employment boundaries (NULL bound = open on that side).
    if employee.hire_date is not None and date_start < employee.hire_date:
        raise DomainError(
            "DATE_OUTSIDE_EMPLOYMENT",
            422,
            detail={
                "date_start": str(date_start),
                "hire_date": str(employee.hire_date),
            },
            message="Начало статуса раньше даты приёма сотрудника.",
        )
    if (
        employee.dismissal_date is not None
        and date_end > employee.dismissal_date
    ):
        raise DomainError(
            "DATE_OUTSIDE_EMPLOYMENT",
            422,
            detail={
                "date_end": str(date_end),
                "dismissal_date": str(employee.dismissal_date),
            },
            message="Конец статуса позже даты увольнения сотрудника.",
        )
    # AC-2: max duration by type (NULL = no limit).
    if status_type.max_duration_days is not None:
        duration = (date_end - date_start).days
        if duration > status_type.max_duration_days:
            raise DomainError(
                "MAX_DURATION_EXCEEDED",
                422,
                detail={
                    "days": duration,
                    "max_duration_days": status_type.max_duration_days,
                },
                message="Длительность статуса превышает лимит типа.",
            )


def _conflict_details(conflicts):
    return [
        {
            "status_type": c.other_status_type,
            "date_start": str(c.other_date_start),
            "date_end": str(c.other_date_end),
        }
        for c in conflicts
    ]


def _assert_no_conflict(
    *,
    employee_id,
    status_type_code,
    date_start,
    date_end,
    exclude_pk=None,
    override=False,
):
    # AC-5/3.4: classify every live, interval-overlapping status via the
    # declarative matrix. The half-open overlap predicate stays HERE (the
    # selector), exactly as in 3.3; the matrix module is pure. hard → 422 (the
    # GiST constraint backstops the hard×HARD race specifically; hard×soft is
    # caught only here); soft (ACTIVE) → 409 overridable; a soft overlap with a
    # not-yet-started (PLANNED) status is a non-blocking
    # warning (FR-10) — it has no return channel in this service-only story, so
    # it is computed by the detector (and property-tested) but not surfaced.
    overlaps = EmployeeStatus.objects.filter(
        employee_id=employee_id,
        cancelled_at__isnull=True,
        date_start__lt=date_end,
        date_end__gt=date_start,
    )
    if exclude_pk is not None:
        overlaps = overlaps.exclude(pk=exclude_pk)
    rows = list(
        overlaps.values("status_type_code", "date_start", "date_end")
    )
    report = detect_conflicts(
        new_type=status_type_code,
        existing_rows=rows,
        business_date=Clock.today_local(),
    )
    if report.hard:
        raise DomainError(
            "OVERLAPPING_HARD_STATUS",
            422,
            detail={
                "employee_id": str(employee_id),
                "conflicts": _conflict_details(report.hard),
            },
            message="Статус конфликтует с hard-статусом сотрудника.",
        )
    # soft → 409 overridable, UNLESS the caller passes override=True (story 3.5):
    # then the soft conflicts are bypassed and RETURNED so the caller records an
    # Override entity. hard above is NEVER bypassable — override only reaches here.
    if report.soft and not override:
        raise DomainError(
            "STATUS_OVERLAP_WARNING",
            409,
            overridable=True,
            detail={"conflicts": _conflict_details(report.soft)},
            message="Статус пересекает soft-статус (возможен override).",
        )
    return report.soft  # () when none; the bypassed soft conflicts when override


@transaction.atomic
def create_status(
    *,
    employee_id,
    status_type_code,
    date_start,
    date_end,
    actor,
    comment="",
    document_basis="",
    source_ref=None,
    override=False,
    override_reason="",
):
    """Create an operator-owned EmployeeStatus with all 3.3 validations.

    ``source`` is forced to USER (AC-7) — projection-owned rows are written by
    operations, never here. When ``override=True`` (story 3.5) a soft (409)
    conflict is bypassed and an Override entity is recorded; ``override`` never
    bypasses a hard (422) conflict, and an empty reason is a 400.
    """
    _require_actor(actor)
    employee = _lock_employee(employee_id)
    # AC-2 (3.5): override requires a non-empty reason — checked before the
    # (more expensive) conflict detection. `(... or "")` guards a None reason
    # from a future caller (e.g. a serializer's .get) so it is a 400, not a 500.
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="При override обязательна непустая причина.",
        )
    status_type = _resolve_status_type(status_type_code)
    _validate_interval(
        date_start=date_start,
        date_end=date_end,
        employee=employee,
        status_type=status_type,
    )
    bypassed_conflicts = _assert_no_conflict(
        employee_id=employee_id,
        status_type_code=status_type_code,
        date_start=date_start,
        date_end=date_end,
        override=override,
    )

    status = EmployeeStatus(
        employee_id=employee_id,
        status_type_code=status_type_code,
        date_start=date_start,
        date_end=date_end,
        source=EmployeeStatus.Source.USER,
        comment=comment,
        document_basis=document_basis,
        source_ref=source_ref,
    )
    # Savepoint around the racy INSERT: a concurrent insert slipping past the
    # pre-check trips excl_hard_status_overlap; the savepoint rolls back cleanly
    # and the IntegrityError propagates to the §36 handler → 422 (AC-5). The
    # Override record (3.5) is written in the SAME savepoint so status + override
    # commit or roll back together (AC-1 atomicity); it is created ONLY when a
    # soft conflict was actually bypassed (AC-4 — no conflict, no record).
    with transaction.atomic():
        status.save()
        if override and bypassed_conflicts:
            Override.objects.create(
                status=status,
                employee_id=employee_id,
                status_type_code=status_type_code,
                reason=override_reason,
                conflicts=_conflict_details(bypassed_conflicts),
                created_by=actor,
            )
    return status


@transaction.atomic
def update_status(
    status,
    *,
    actor,
    date_start=None,
    date_end=None,
    comment=None,
    document_basis=None,
):
    """Thin operator-edit path (Решение №2=A): wires the 3.2 guard.

    Only the editable metadata/interval is touched; lifecycle transitions
    (extend/complete/cancel semantics) are story 3.6. ``assert_user_editable()``
    runs BEFORE any mutation so projection-owned rows (source != USER) stay
    read-only (AC-8).
    """
    _require_actor(actor)
    employee = _lock_employee(status.employee_id)
    status.assert_user_editable()  # AC-8 — guard before mutation

    # Re-validate the interval ONLY when a date actually changes. A metadata
    # edit (comment/document_basis) must not be blocked by a pre-existing
    # interval that turned "invalid" after creation — e.g. the type was retired
    # (is_active=False) or the employee's bounds/max-duration tightened (review
    # проход 1). The lock + guard above still run on every edit.
    if date_start is not None or date_end is not None:
        new_start = status.date_start if date_start is None else date_start
        new_end = status.date_end if date_end is None else date_end
        status_type = _resolve_status_type(status.status_type_code)
        _validate_interval(
            date_start=new_start,
            date_end=new_end,
            employee=employee,
            status_type=status_type,
        )
        _assert_no_conflict(
            employee_id=status.employee_id,
            status_type_code=status.status_type_code,
            date_start=new_start,
            date_end=new_end,
            exclude_pk=status.pk,
        )

    changed = []
    if date_start is not None:
        status.date_start = date_start
        changed.append("date_start")
    if date_end is not None:
        status.date_end = date_end
        changed.append("date_end")
    if comment is not None:
        status.comment = comment
        changed.append("comment")
    if document_basis is not None:
        status.document_basis = document_basis
        changed.append("document_basis")
    if changed:
        changed.append("updated_at")
        with transaction.atomic():
            status.save(update_fields=changed)
    return status


# -- Story 3.6 — lifecycle operations (cancel / early-complete / extend) ------
#
# Three operator transitions on a USER-owned status, each assembled from the
# 3.3/3.4/3.5 helpers above. Shared spine: require actor → lock employee (404)
# → assert_user_editable (422 for projection rows) → state-guard → mutate under
# a savepoint with update_fields (never a bare save() — that would rewrite the
# generated `period`/source). A new code INVALID_LIFECYCLE_TRANSITION (422)
# covers every disallowed transition. Append-once cancel facts are enforced HERE
# at the service level; the DB-level append-only REVOKE/trigger is Epic 4.


def _lock_for_edit(status):
    """Lifecycle/edit preamble after the actor check: lock the employee (404 if
    missing), re-read the status under that lock, then assert it is
    operator-editable (422 if projection-owned).

    ``refresh_from_db`` is load-bearing for append-once: ``_lock_employee`` takes
    ``select_for_update`` on the EMPLOYEE row, which serializes all lifecycle
    writers for that employee but does NOT lock the status row. Without the
    re-read, a second concurrent ``cancel_status`` proceeds on its stale
    in-memory ``cancelled_at=None``, passes the PLANNED guard, and overwrites the
    first writer's cancel facts (lost update for extend/complete likewise). After
    the lock the prior writer has committed, so refreshing observes the canonical
    state (READ COMMITTED) and the guard rejects the stale operation."""
    employee = _lock_employee(status.employee_id)
    status.refresh_from_db()
    status.assert_user_editable()
    return employee


@transaction.atomic
def cancel_status(status, *, actor, reason):
    """Cancel a not-yet-started (PLANNED) status — append-once cancel facts.

    Only PLANNED is cancellable: an ACTIVE/COMPLETED status is a fact that
    happened (close it early, do not cancel) and a CANCELLED row is terminal.
    ``cancelled_at/by/reason`` are written once and never overwritten or cleared
    at the service level (DB-level append-only is Epic 4). A non-PLANNED state —
    including an already-CANCELLED row — is 422 INVALID_LIFECYCLE_TRANSITION.
    """
    _require_actor(actor)
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="При отмене статуса обязательна непустая причина.",
        )
    _lock_for_edit(status)
    state = status.state_on(Clock.today_local())
    if state != EmployeeStatus.LifecycleState.PLANNED:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": str(state)},
            message="Отменить можно только не начавшийся (PLANNED) статус.",
        )
    status.cancelled_at = Clock.now()
    status.cancelled_by = actor
    status.cancelled_reason = reason
    with transaction.atomic():
        status.save(
            update_fields=[
                "cancelled_at",
                "cancelled_by",
                "cancelled_reason",
                "updated_at",
            ]
        )
    return status


@transaction.atomic
def complete_status_early(status, *, actor, actual_end):
    """Close an ACTIVE status with a factual end date ``≤ today``.

    Only ACTIVE rows complete early (a PLANNED status never started → cancel it;
    a COMPLETED one is already closed). ``actual_end`` must not be in the future
    ("факт" не в будущем) and must keep the interval non-empty
    (``actual_end > date_start``). The row becomes COMPLETED as of today
    (half-open ``[start, actual_end)``). The before/after trail of the date
    change is captured by the audit log (Epic 4 / 4.4), not here.
    """
    _require_actor(actor)
    _lock_for_edit(status)
    today = Clock.today_local()
    if status.state_on(today) != EmployeeStatus.LifecycleState.ACTIVE:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": str(status.state_on(today))},
            message="Досрочно завершить можно только текущий (ACTIVE) статус.",
        )
    if actual_end > today:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"actual_end": str(actual_end), "today": str(today)},
            message="Дата фактического завершения не может быть в будущем.",
        )
    if actual_end <= status.date_start:
        raise DomainError(
            "INVALID_DATE_RANGE",
            422,
            detail={
                "actual_end": str(actual_end),
                "date_start": str(status.date_start),
            },
            message="Дата завершения должна быть позже даты начала статуса.",
        )
    status.date_end = actual_end
    with transaction.atomic():
        status.save(update_fields=["date_end", "updated_at"])
    return status


@transaction.atomic
def extend_status(
    status, *, actor, new_date_end, override=False, override_reason=""
):
    """Extend a non-CANCELLED status to a strictly later ``date_end``.

    Shortening is a different operation (досрочное завершение,
    ``complete_status_early``); ``new_date_end <= date_end`` is 422. The new
    interval is re-validated (employment bounds + ``max_duration_days``) and
    conflict-checked against the employee's other statuses (excluding self). A
    soft (409) overlap is bypassable with ``override=True`` + a non-empty reason,
    recording an Override entity in the same savepoint (story 3.5 machinery,
    closing its edit-override defer); a hard (422) overlap is never bypassed.
    """
    _require_actor(actor)
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="При override обязательна непустая причина.",
        )
    employee = _lock_for_edit(status)
    if status.state_on(Clock.today_local()) == EmployeeStatus.LifecycleState.CANCELLED:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": EmployeeStatus.LifecycleState.CANCELLED.value},
            message="Отменённый статус нельзя продлить.",
        )
    if new_date_end <= status.date_end:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={
                "new_date_end": str(new_date_end),
                "date_end": str(status.date_end),
            },
            message="Продление требует более поздней даты конца.",
        )
    status_type = _resolve_status_type(status.status_type_code)
    _validate_interval(
        date_start=status.date_start,
        date_end=new_date_end,
        employee=employee,
        status_type=status_type,
    )
    bypassed_conflicts = _assert_no_conflict(
        employee_id=status.employee_id,
        status_type_code=status.status_type_code,
        date_start=status.date_start,
        date_end=new_date_end,
        exclude_pk=status.pk,
        override=override,
    )
    status.date_end = new_date_end
    with transaction.atomic():
        status.save(update_fields=["date_end", "updated_at"])
        if override and bypassed_conflicts:
            Override.objects.create(
                status=status,
                employee_id=status.employee_id,
                status_type_code=status.status_type_code,
                reason=override_reason,
                conflicts=_conflict_details(bypassed_conflicts),
                created_by=actor,
            )
    return status
