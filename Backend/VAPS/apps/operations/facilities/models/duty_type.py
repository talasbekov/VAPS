"""DutyType — вид дежурства объекта (14.4, FR-39 / donor DB-OPS-046).

Object-scoped ON PURPOSE (Д1): FR-39 lists «виды дежурств» among admin
dictionaries, but the donor's DDL (``ops_object_duty_types``, Critical Fix 4 —
later and more authoritative) binds them to an object: facility FK CASCADE,
UNIQUE(object, code), import natural key object_code+code. So DutyType takes
the Sector/Post path (services/audit/locks), NOT the PostType catalog path,
and is NOT registered in admin.

The projection parameters are STORED here, consumed later: rest_after_minutes
→ REST_AFTER_DUTY (BR-DUTY-TYPE-002, 14.6), before_duty_minutes → BEFORE_DUTY
(BR-DUTY-TYPE-003, 14.7), requires_reconnaissance → plan-approval gate
(BR-DUTY-TYPE-004, 14.5/15.3). rest_after=0 is a legal configuration (donor
CHECK ≥ 0, Д6).

Donor deviations, declared in the story:
- ``default_post_type`` keeps the donor's SET_NULL (a hint for 14.5, not a
  contract) — unlike Post.post_type, where the donor's RESTRICT was
  strengthened to PROTECT.
- ``description`` is NOT NULL default "" (house text canon tasks/features).
- The unique is PARTIAL (is_active=True) over Lower(code) — the 14.2 canon:
  soft-delete must not squat identifiers; the donor's total UNIQUE assumes
  DELETE, which we do not have.
"""

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.operations.models import TimeStampedModel


class DutyType(TimeStampedModel):
    facility = models.ForeignKey(
        "ops_facilities.Facility",
        on_delete=models.CASCADE,
        related_name="duty_types",
    )
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    default_post_type = models.ForeignKey(
        "ops_facilities.PostType",
        on_delete=models.SET_NULL,
        db_column="default_post_type_code",
        null=True,
        blank=True,
        related_name="duty_types",
    )
    default_duration_minutes = models.IntegerField(null=True, blank=True)
    rest_after_minutes = models.IntegerField(default=1440)
    before_duty_minutes = models.IntegerField(default=0)
    requires_reconnaissance = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_duty_types"
        ordering = ["code", "id"]
        constraints = [
            models.UniqueConstraint(
                "facility",
                Lower("code"),
                condition=Q(is_active=True),
                name="uq_duty_type_facility_code",
            ),
            models.CheckConstraint(
                condition=Q(code__regex=r"\S"),
                name="chk_duty_type_code_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(name__regex=r"\S"),
                name="chk_duty_type_name_not_blank",
            ),
            # isnull=False в позитивной ветке — урок NULL-пробела 14.3a
            # (здесь NULL легален первой веткой, но ветка «>0» держится
            # явной, не полагаясь на трёхзначную логику regex/сравнений).
            models.CheckConstraint(
                condition=Q(default_duration_minutes__isnull=True)
                | Q(
                    default_duration_minutes__isnull=False,
                    default_duration_minutes__gte=1,
                ),
                name="chk_duty_type_duration_min",
            ),
            models.CheckConstraint(
                condition=Q(rest_after_minutes__gte=0),
                name="chk_duty_type_rest_after_min",
            ),
            models.CheckConstraint(
                condition=Q(before_duty_minutes__gte=0),
                name="chk_duty_type_before_duty_min",
            ),
        ]

    def __str__(self):
        return f"{self.code} @ {self.facility_id}"
