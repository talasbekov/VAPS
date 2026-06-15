from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.contrib.postgres.indexes import GistIndex
from django.db import models
from django.db.models import F, Func, Q, Value

from apps.operations.models import TimeStampedModel

# Must stay in sync with StatusType rows where is_hard_block=true
# (seed DB-OPS-003); the seed test in story 2.2 cross-checks this tuple.
HARD_STATUS_TYPE_CODES = ("SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND")


class EmployeeStatus(TimeStampedModel):
    # ARCH-002/003: flat cross-context reference to core_employees, never an FK.
    employee_id = models.UUIDField()
    # FK to StatusType (to_field="code") arrives with the dictionary in 2.2.
    status_type_code = models.CharField(max_length=50)
    # ARCH-DATA-023: calendar days, half-open [date_start, date_end).
    date_start = models.DateField()
    date_end = models.DateField()
    # ARCH-DATA-022: append-once cancellation fact; cancelled_by/reason in 3.6.
    cancelled_at = models.DateTimeField(null=True, blank=True)
    period = models.GeneratedField(
        expression=Func(
            F("date_start"),
            F("date_end"),
            Value("[)"),
            function="daterange",
            output_field=DateRangeField(),
        ),
        output_field=DateRangeField(),
        db_persist=True,
    )

    class Meta:
        db_table = "ops_employee_statuses"
        constraints = [
            models.CheckConstraint(
                condition=Q(date_start__lt=F("date_end")),
                name="chk_status_dates",
            ),
            # ARCH-DATA-020: non-cancelled hard statuses of one employee must
            # not overlap; 3.1 maps IntegrityError to 409 by this exact name.
            ExclusionConstraint(
                name="excl_hard_status_overlap",
                expressions=[
                    (F("employee_id"), RangeOperators.EQUAL),
                    (F("period"), RangeOperators.OVERLAPS),
                ],
                condition=Q(status_type_code__in=HARD_STATUS_TYPE_CODES)
                & Q(cancelled_at__isnull=True),
            ),
        ]
        indexes = [
            # Full (non-partial) GiST for derived lookups across ALL status
            # types (1.7); the constraint's implicit index is partial.
            GistIndex(
                fields=["employee_id", "period"],
                name="gist_status_employee_period",
            ),
        ]
