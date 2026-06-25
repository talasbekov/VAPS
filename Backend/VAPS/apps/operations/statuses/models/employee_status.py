from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.contrib.postgres.indexes import GistIndex
from django.db import models
from django.db.models import Case, F, Func, Q, Value, When

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.models import TimeStampedModel

# Single source of truth lives in the pure conflict_matrix module (story 3.4,
# Решение №3): both this GiST constraint and the conflict detector read it, so
# they can't drift. Re-exported here for backward-compat (models.__init__).
from apps.operations.statuses.conflict_matrix import (  # noqa: E402
    HARD_STATUS_TYPE_CODES,
)


class LifecycleState(models.TextChoices):
    """Derived lifecycle of ONE status row (NOT the расход winner — that is
    strength_report.resolve_status). Values mirror spec ops_status_states."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


def derive_state(date_start, date_end, cancelled_at, business_date):
    """Canonical derived state — single source of truth for both the @property
    and the queryset annotation (ARCH-DATA-022: derived-first, no stored state).

    Half-open [date_start, date_end), business_date via Clock (never now()).
    CANCELLED is a lifecycle fact (orthogonal to dates) → checked first.
    """
    if cancelled_at is not None:
        return LifecycleState.CANCELLED
    if business_date < date_start:
        return LifecycleState.PLANNED
    if business_date < date_end:
        return LifecycleState.ACTIVE
    return LifecycleState.COMPLETED


class EmployeeStatusQuerySet(models.QuerySet):
    def with_state(self, business_date=None):
        """Annotate ``state_annotation`` (SQL Case/When) mirroring derive_state.

        Named distinctly from the @property ``state`` because a property is a
        data descriptor and would shadow an annotation of the same name.
        """
        if business_date is None:
            business_date = Clock.today_local()
        return self.annotate(
            state_annotation=Case(
                When(
                    cancelled_at__isnull=False,
                    then=Value(LifecycleState.CANCELLED.value),
                ),
                When(
                    date_start__gt=business_date,
                    then=Value(LifecycleState.PLANNED.value),
                ),
                When(
                    date_end__gt=business_date,
                    then=Value(LifecycleState.ACTIVE.value),
                ),
                default=Value(LifecycleState.COMPLETED.value),
                output_field=models.CharField(),
            )
        )


class EmployeeStatus(TimeStampedModel):
    class Source(models.TextChoices):
        USER = "USER"  # created by an operator
        KU_SYNC = "KU_SYNC"  # synced from КУ (placeholder; КУ deferred, AR-10)
        OM_AUTO = "OM_AUTO"  # owned by the duty/event projection (E14)

    # ARCH-002/003: flat cross-context reference to core_employees, never an FK.
    employee_id = models.UUIDField()
    # FK to StatusType (to_field="code") arrives with the dictionary in 2.2.
    status_type_code = models.CharField(max_length=50)
    # ARCH-DATA-023: calendar days, half-open [date_start, date_end).
    date_start = models.DateField()
    date_end = models.DateField()
    # ARCH-DATA-022: append-once cancellation facts (story 3.6). Set together by
    # cancel_status; never updated/cleared at the service level (DB-level
    # append-only REVOKE/trigger is Epic 4). cancelled_at also drives the
    # CANCELLED state (derive_state) and drops the row from the conflict/
    # exclusion perimeter (cancelled_at__isnull filters).
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=255, null=True, blank=True)
    cancelled_reason = models.TextField(blank=True, default="")
    # Story 3.2 — provenance. source carries origin so the E14 projection plugs
    # in via OM_AUTO/source_ref without opening the engine (AR-8).
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.USER
    )
    # Owner/idempotency key for projection-written rows (e.g. "DUTY:42").
    source_ref = models.CharField(max_length=255, null=True, blank=True)
    comment = models.TextField(blank=True, default="")
    # Text basis-reference ("Приказ №…"); file attachments are E6 (BR-DOC-001).
    document_basis = models.CharField(max_length=255, blank=True, default="")
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

    objects = EmployeeStatusQuerySet.as_manager()

    LifecycleState = LifecycleState

    def state_on(self, business_date):
        """Derived lifecycle state on a business date (mirrors with_state)."""
        return derive_state(
            self.date_start, self.date_end, self.cancelled_at, business_date
        )

    @property
    def state(self):
        """Derived state as of the current business date (Clock)."""
        return self.state_on(Clock.today_local())

    def assert_user_editable(self):
        """Guard: only USER-sourced rows are operator-editable (AC-2).

        Projection-owned rows (OM_AUTO / KU_SYNC) raise 422 — the projection is
        the single writer (ARCH-DATA-022 §L105). Called by the operator-edit
        path (story 3.3+); kept OUT of clean() so the system dismissal service
        may still close projection rows.
        """
        if self.source != self.Source.USER:
            raise DomainError(
                "AUTO_STATUS_READONLY",
                422,
                detail={"source": self.source},
                message="Запись принадлежит проекции (source != USER); "
                "ручная правка запрещена.",
            )

    class Meta:
        db_table = "ops_employee_statuses"
        constraints = [
            models.CheckConstraint(
                condition=Q(date_start__lt=F("date_end")),
                name="chk_status_dates",
            ),
            # ARCH-DATA-020: non-cancelled hard statuses of one employee must
            # not overlap; 3.1 maps IntegrityError to 422 OVERLAPPING_HARD_STATUS
            # by this exact name (hard overlap is a business rule).
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
