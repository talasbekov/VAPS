from django.db import models

from apps.operations.models import TimeStampedModel
from apps.operations.statuses.models.employee_status import EmployeeStatus


class Secondment(TimeStampedModel):
    """Story 3.10 — first-class link for a secondment pair (FR-14).

    Откомандирование initiated by the home unit's operator: the employee gets a
    DETACHED status (stays «по списку» of the home/from unit) AND an ATTACHED
    status («+N» at the receiving/to unit). This entity bonds the two legs so
    story 3.11 can «завершить пару», and carries the receiving division the
    ATTACHED «+N» belongs to — ``EmployeeStatus`` itself is division-less, so the
    «+N»-at-the-receiving-unit roster/расход projection (deferred to E6/E9,
    Решение B) reads ``to_division_id`` from here.

    Cross-context refs are flat ``UUIDField`` (ARCH-003, no FK into core); the two
    legs are FK ``PROTECT`` (a leg is never hard-deleted out from under its link,
    mirroring Override). ``created_by`` (TimeStampedModel) carries the actor
    string (ARCH-007). Append-once at the service level; DB-level append-only is
    Epic 4.
    """

    employee_id = models.UUIDField()
    out_status = models.ForeignKey(
        EmployeeStatus, on_delete=models.PROTECT, related_name="secondment_out"
    )
    in_status = models.ForeignKey(
        EmployeeStatus, on_delete=models.PROTECT, related_name="secondment_in"
    )
    from_division_id = models.UUIDField()
    to_division_id = models.UUIDField()
    document_basis = models.TextField(blank=True, default="")
    # Story 3.11 — return handshake as append-once FACTS (NOT a mutated enum,
    # ARCH-DATA-022): home requests, the receiving side confirms; confirmation
    # completes both legs. The employee's post-return status is derived (3.7), so
    # there is no stored «returned» flag — only who/when of each beat.
    return_requested_at = models.DateTimeField(null=True, blank=True)
    return_requested_by = models.CharField(max_length=100, null=True, blank=True)
    return_confirmed_at = models.DateTimeField(null=True, blank=True)
    return_confirmed_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "ops_status_secondments"
        indexes = [
            models.Index(
                fields=["employee_id", "-created_at"],
                name="idx_secondment_emp_created",
            ),
        ]
