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

from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.statuses.models import EmployeeStatus, Secondment
from apps.operations.statuses.services.status_service import (
    _assert_no_conflict,
    _lock_employee,
    _require_actor,
    _resolve_status_type,
    _validate_interval,
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
    return secondment
