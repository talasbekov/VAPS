"""Story 3.10 — secondment initiation (FR-14), atomic linked pair.

``initiate_secondment`` creates the DETACHED (home) + ATTACHED (receiving) status
pair AND the ``Secondment`` record that bonds them, in ONE transaction (both legs
or neither). The receiving division lives on the ``Secondment`` (an
``EmployeeStatus`` is division-less); the «+N»-at-the-receiving-unit roster/расход
projection is deferred to E6/E9 (Решение B — bounded initiation). Both legs are
``source=USER``. DETACHED/ATTACHED are declared COMPATIBLE (conflict_matrix), so
the pair doesn't self-conflict, while each leg is still conflict-checked against
the employee's OTHER live statuses (hard → 422 before write).

Reuses the 3.3 validation spine (``_lock_employee``/``_validate_interval``/
``_assert_no_conflict``) — logic, not a loop of ``create_status`` calls (the
``bulk_status_service`` / ``resolve_pending_clarification`` composition pattern).
"""

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.statuses.models import EmployeeStatus, Secondment
from apps.operations.statuses.services.status_service import (
    _assert_no_conflict,
    _lock_employee,
    _require_actor,
    _resolve_status_type,
    _validate_interval,
    assert_employee_status_editable,
    cancel_status,
    complete_status_early,
)

DETACHED_CODE = "DETACHED"
ATTACHED_CODE = "ATTACHED"


@transaction.atomic
def initiate_secondment(
    employee_id,
    *,
    to_division_id,
    date_start,
    date_end,
    actor,
    document_basis="",
):
    """Initiate a secondment (FR-14): create the linked DETACHED+ATTACHED pair.

    Returns the ``Secondment``. Raises a single ``DomainError`` and writes
    NOTHING on any failure: empty actor → 400; receiving == home → 400; receiving
    division missing → 404; employee missing → 404; the legs' interval invalid or
    overlapping a hard status → 422 / a soft status → 409 (all before any write).
    """
    _require_actor(actor)
    employee = _lock_employee(employee_id)  # 404 if missing
    assert_employee_status_editable(employee_id)  # FR-16: already-DETACHED → 403
    from_division_id = employee.division_id
    if to_division_id == from_division_id:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"to_division_id": str(to_division_id)},
            message="Нельзя откомандировать в то же подразделение.",
        )
    if to_division_id not in CoreDivisionTreeSelector.divisions_map(
        {to_division_id}
    ):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"to_division_id": str(to_division_id)},
            message="Принимающее подразделение не найдено.",
        )

    detached_type = _resolve_status_type(DETACHED_CODE)
    attached_type = _resolve_status_type(ATTACHED_CODE)
    _validate_interval(
        date_start=date_start,
        date_end=date_end,
        employee=employee,
        status_type=detached_type,
    )
    _validate_interval(
        date_start=date_start,
        date_end=date_end,
        employee=employee,
        status_type=attached_type,
    )
    # Conflict-check the DETACHED leg against the employee's OTHER live statuses
    # (hard → 422 / soft → 409) BEFORE any write. DETACHED-vs-T and ATTACHED-vs-T
    # have identical severity for every other type T (both soft), so this single
    # check is representative for the pair's conflict with pre-existing statuses.
    _assert_no_conflict(
        employee_id=employee_id,
        status_type_code=DETACHED_CODE,
        date_start=date_start,
        date_end=date_end,
    )

    with transaction.atomic():
        out_status = EmployeeStatus(
            employee_id=employee_id,
            status_type_code=DETACHED_CODE,
            date_start=date_start,
            date_end=date_end,
            source=EmployeeStatus.Source.USER,
            document_basis=document_basis,
        )
        out_status.save()
        # The ATTACHED leg is checked AFTER DETACHED exists: the detector now
        # sees the DETACHED leg and MUST classify the pair COMPATIBLE (3.10),
        # else this raises a spurious 409 — the load-bearing COMPATIBLE_PAIRS
        # guarantee.
        _assert_no_conflict(
            employee_id=employee_id,
            status_type_code=ATTACHED_CODE,
            date_start=date_start,
            date_end=date_end,
        )
        in_status = EmployeeStatus(
            employee_id=employee_id,
            status_type_code=ATTACHED_CODE,
            date_start=date_start,
            date_end=date_end,
            source=EmployeeStatus.Source.USER,
            document_basis=document_basis,
        )
        in_status.save()
        secondment = Secondment.objects.create(
            employee_id=employee_id,
            out_status=out_status,
            in_status=in_status,
            from_division_id=from_division_id,
            to_division_id=to_division_id,
            document_basis=document_basis,
            created_by=actor,
        )
    # One event for the whole pair (story 4.4); legs are created via direct
    # .save() above (not create_status), so there is no per-leg double-emit.
    record(
        actor=actor,
        action="SECONDMENT_INITIATED",
        entity_type="secondment",
        entity_id=employee_id,
        old_value=None,
        new_value={
            "secondment_id": secondment.pk,
            "out_status_id": out_status.pk,
            "in_status_id": in_status.pk,
            "from_division_id": str(from_division_id),
            "to_division_id": str(to_division_id),
            "date_start": str(date_start),
            "date_end": str(date_end),
        },
    )
    return secondment


# -- Story 3.11 — secondment return (FR-15): request → confirm → complete pair


@transaction.atomic
def request_return(secondment, *, actor):
    """Step 1 (FR-15): the home unit requests the return — an append-once fact.

    Idempotency: a secondment already requested or confirmed → 422. (Who may
    request — the home/штатное operator — is role/scope-gated at the API layer,
    Решение E; here ``actor`` is a plain string.)
    """
    _require_actor(actor)
    secondment.refresh_from_db()
    if (
        secondment.return_requested_at is not None
        or secondment.return_confirmed_at is not None
    ):
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": secondment.id},
            message="Возврат уже запрошен или подтверждён.",
        )
    secondment.return_requested_at = Clock.now()
    secondment.return_requested_by = actor
    secondment.save(
        update_fields=["return_requested_at", "return_requested_by", "updated_at"]
    )
    record(
        actor=actor,
        action="SECONDMENT_RETURN_REQUESTED",
        entity_type="secondment",
        entity_id=secondment.employee_id,
        old_value={"return_requested_at": None},
        new_value={
            "return_requested_at": secondment.return_requested_at.isoformat(),
            "return_requested_by": actor,
        },
    )
    return secondment


@transaction.atomic
def confirm_return(secondment, *, actor, reason=""):
    """Step 2 (FR-15): the receiving side confirms — completes BOTH legs.

    Requires a prior request (else 422); double-confirm → 422. Atomically closes
    each leg by its lifecycle state (ACTIVE → ``complete_status_early`` as of
    today; PLANNED → ``cancel_status``; already-closed → skip) and stamps the
    append-once confirmed fact. The employee derived-returns to «В строю» with no
    «returned» write (story 3.7). NOTE: the leg-completion path intentionally does
    NOT run the FR-16 guard — closing the restricting status must not self-block.
    """
    _require_actor(actor)
    _lock_employee(secondment.employee_id)  # serialize writers on this employee
    secondment.refresh_from_db()
    if secondment.return_requested_at is None:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": secondment.id},
            message="Нельзя подтвердить возврат без запроса.",
        )
    if secondment.return_confirmed_at is not None:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": secondment.id},
            message="Возврат уже подтверждён.",
        )
    today = Clock.today_local()
    legs_closed = []
    with transaction.atomic():
        for leg in (secondment.out_status, secondment.in_status):
            leg.refresh_from_db()
            state = leg.state_on(today)
            # _audit=False: this is ONE operation (SECONDMENT_RETURNED) — the leg
            # closures must not emit their own STATUS_* events (реш. №4, no double).
            if state == EmployeeStatus.LifecycleState.ACTIVE:
                complete_status_early(leg, actor=actor, actual_end=today, _audit=False)
                legs_closed.append({"status_id": leg.pk, "action": "completed"})
            elif state == EmployeeStatus.LifecycleState.PLANNED:
                cancel_status(
                    leg,
                    actor=actor,
                    reason=reason or "возврат секондмента",
                    _audit=False,
                )
                legs_closed.append({"status_id": leg.pk, "action": "cancelled"})
            # COMPLETED / CANCELLED legs are already closed — nothing to do.
        secondment.return_confirmed_at = Clock.now()
        secondment.return_confirmed_by = actor
        secondment.save(
            update_fields=[
                "return_confirmed_at",
                "return_confirmed_by",
                "updated_at",
            ]
        )
    record(
        actor=actor,
        action="SECONDMENT_RETURNED",
        entity_type="secondment",
        entity_id=secondment.employee_id,
        old_value={"return_confirmed_at": None},
        new_value={
            "return_confirmed_at": secondment.return_confirmed_at.isoformat(),
            "return_confirmed_by": actor,
            "legs_closed": legs_closed,
        },
    )
    return secondment
