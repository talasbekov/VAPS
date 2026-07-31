"""Story 14.5: `DutyPlan` (месячный план по объекту) + `DutyShift` (смена).

First app in `operations` that FK's into a SIBLING subdomain
(`facilities`'s `Object`/`Post`/`DutyType`) — sanctioned by ARCH-003, which
only forbids `operations` importing `apps.core.models` directly
(`apps/operations/tests/test_isolation.py`'s
`test_operations_does_not_import_core_models`), not FKs between sibling
operations subdomains. `architecture.md#L611` maps
`FR-19…20 объекты/дежурства | operations/facilities + duties` as two
siblings of one bounded context.

Scope (14.5): models + migration ONLY. The DRAFT→APPROVED approve
transition, BR-017's DUTY/REST_AFTER_DUTY auto-projection, BEFORE_DUTY
projection and BR-DUTY-CONFLICT-001/002/BR-DUTY-REST-001-003 availability
checks are all out of scope — see the story's Scope Decision. `status_code`
is a `TextChoices`+`CheckConstraint` (small closed set: DRAFT/APPROVED per
donor's `ops_duty_plan_statuses` seed), not a deferred-FK reference table —
unlike `post_type_code`/`importance_level_code`, that reference table would
never grow past these 2 rows.
"""

from django.core.exceptions import ValidationError
from django.db import models

from apps.operations.models import TimeStampedModel


class DutyPlan(TimeStampedModel):
    """Месячный план дежурств по объекту (donor `ops_duty_plans`, DB-OPS-012)."""

    class StatusCode(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        APPROVED = "APPROVED", "Утверждён"

    object = models.ForeignKey(
        "ops_facilities.Object", on_delete=models.CASCADE, related_name="duty_plans"
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    status_code = models.CharField(
        max_length=10, choices=StatusCode.choices, default=StatusCode.DRAFT
    )

    class Meta:
        db_table = "ops_duty_plans"
        verbose_name = "План дежурств"
        verbose_name_plural = "Планы дежурств"
        constraints = [
            models.UniqueConstraint(
                fields=["object", "year", "month"], name="uq_duty_plan_object_month"
            ),
            # Donor: CHECK (year BETWEEN 2026 AND 2100) — a specific bound,
            # not covered by PositiveIntegerField's own implicit >=0 guard
            # (lesson from 14.4's review applied correctly the other way:
            # here the bound IS stricter/different, so the named constraint
            # is NOT vacuous).
            models.CheckConstraint(
                condition=models.Q(year__gte=2026) & models.Q(year__lte=2100),
                name="ck_duty_plan_year_range",
            ),
            models.CheckConstraint(
                condition=models.Q(month__gte=1) & models.Q(month__lte=12),
                name="ck_duty_plan_month_range",
            ),
            models.CheckConstraint(
                condition=models.Q(status_code__in=["DRAFT", "APPROVED"]),
                name="ck_duty_plan_status_code_choices",
            ),
        ]

    def __str__(self):
        return f"{self.object.code} / {self.year}-{self.month:02d} ({self.status_code})"


class DutyShift(TimeStampedModel):
    """Смена дежурства (donor `ops_duty_shifts`, DB-OPS-012 + DB-OPS-047).

    `duty_type`/`duty_role_code`/`notes` are the donor's DB-OPS-047
    extension, included from the start — `DutyType` already exists (14.4)
    and both parts of the donor schema are already known, so there is no
    reason to build this table incomplete and migrate again later.
    """

    plan = models.ForeignKey(DutyPlan, on_delete=models.CASCADE, related_name="shifts")
    # Donor: UUID NOT NULL, no REFERENCES — flat field, mirrors
    # ObjectPassport.responsible_employee_id's "no FK into core" pattern.
    employee_id = models.UUIDField()
    # PROTECT (not donor's literal RESTRICT — same substitution as 14.1-14.4):
    # a live future shift must not let its Post/DutyType vanish silently.
    post = models.ForeignKey(
        "ops_facilities.Post",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="duty_shifts",
    )
    duty_type = models.ForeignKey(
        "ops_facilities.DutyType",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="duty_shifts",
    )
    duty_role_code = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()

    class Meta:
        db_table = "ops_duty_shifts"
        verbose_name = "Смена"
        verbose_name_plural = "Смены"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(starts_at__lt=models.F("ends_at")),
                name="ck_duty_shift_starts_before_ends",
            ),
        ]
        indexes = [
            models.Index(
                fields=["employee_id", "starts_at", "ends_at"],
                name="idx_ops_duty_employee_time",
            ),
        ]

    def __str__(self):
        return f"{self.plan} / {self.employee_id} ({self.starts_at:%Y-%m-%d %H:%M})"

    def clean(self):
        # Same cross-FK class of gap as Post.clean() (14.2)/
        # ChecklistOverride.clean() (14.3): post/duty_type and plan are
        # separate FKs — nothing else stops a shift's post OR duty_type
        # belonging to a DIFFERENT object than its plan (DutyType is
        # per-object, facilities/models.py, same shape as Post). Guard on
        # `_id`s before dereferencing (14.3's review lesson). Same caveat:
        # only enforced via full_clean(), not .objects.create()/
        # bulk_create() — a future API/service story must call
        # full_clean() on the write path.
        super().clean()
        errors = {}
        if self.post_id and self.plan_id and self.post.object_id != self.plan.object_id:
            errors["post"] = "Пост должен принадлежать тому же объекту, что и план."
        if (
            self.duty_type_id
            and self.plan_id
            and self.duty_type.object_id != self.plan.object_id
        ):
            errors["duty_type"] = (
                "Вид дежурства должен принадлежать тому же объекту, что и план."
            )
        if errors:
            raise ValidationError(errors)
