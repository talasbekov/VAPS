from django.db import models

from apps.operations.models import TimeStampedModel
from apps.operations.statuses.models.employee_status import EmployeeStatus


class Override(TimeStampedModel):
    """Story 3.5 — first-class auditable record of a soft-conflict bypass.

    Written when an operator retries status creation with ``override=True`` + a
    reason and a soft (409 ``STATUS_OVERLAP_WARNING``) conflict is bypassed. The
    record references the status it unblocked and snapshots the bypassed
    conflicts, so each bypass is visible and countable instead of happening
    invisibly outside the system (ARCH-DATA-022). SM-C1 accounting: per-operator
    counts come straight from ``created_by``; per-division counts join
    ``employee_id`` → core Employee.division (the employee's CURRENT division — a
    point-in-time ``division_id`` snapshot is deferred to the SM-C1 metrics
    story, see deferred-work). Append-once: the service never updates it;
    DB-level REVOKE/append-only enforcement is Epic 4 (audit). ``created_by``
    (TimeStampedModel) carries the actor string (ARCH-007).

    Hard conflicts (422) are NEVER overridable, so an Override never references
    a hard bypass — only soft ones (FR-11).
    """

    status = models.ForeignKey(
        EmployeeStatus, on_delete=models.PROTECT, related_name="overrides"
    )
    # Denormalized flat cross-context ref (ARCH-002/003) for SM-C1 queries.
    employee_id = models.UUIDField()
    status_type_code = models.CharField(max_length=50)
    reason = models.TextField()
    # Snapshot of the bypassed soft conflicts (mirror of _conflict_details).
    conflicts = models.JSONField(default=list)

    class Meta:
        db_table = "ops_status_overrides"
        indexes = [
            models.Index(
                fields=["employee_id", "-created_at"],
                name="idx_override_emp_created",
            ),
        ]
