"""Post — точка несения службы на объекте (14.2, FR-5.2/5.3).

Donor: ``ops_object_posts`` (DB-OPS-005) + ALTER DB-OPS-016. ``requirements``
follows the DB-OPS-006 JSON schema, validated in the service (no jsonschema
dependency); the default is ``{"schema_version": 1}`` — the donor's
``DEFAULT '{}'`` violates its own schema (required schema_version), a donor
hole closed here. ``min_rating`` is stored but NOT enforced
(RATING-DECISION-002); scale unknown → only the ≥0 floor is pinned.
``max_service_minutes`` is the смена basis (FR-5.3); ``max_continuous_minutes``
feeds the overload warning (BR-POST-001) — both DB-guarded.
"""

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.operations.models import TimeStampedModel


def _default_requirements():
    return {"schema_version": 1}


class Post(TimeStampedModel):
    facility = models.ForeignKey(
        "ops_facilities.Facility",
        on_delete=models.CASCADE,
        related_name="posts",
    )
    # Same-subdomain FK — SET_NULL mirrors the donor; the same-facility
    # invariant is a service concern (cross-row, not expressible as CHECK).
    sector = models.ForeignKey(
        "ops_facilities.Sector",
        on_delete=models.SET_NULL,
        related_name="posts",
        null=True,
        blank=True,
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    # Real FK (donor RESTRICT → PROTECT): ARCH-003 bans only cross-context
    # FKs; the statuses plain-CharField shape was a deliberate 2.2 deferral,
    # not a canon for new models.
    post_type = models.ForeignKey(
        "ops_facilities.PostType",
        on_delete=models.PROTECT,
        db_column="post_type_code",
        default="FIXED",
        related_name="posts",
    )
    max_service_minutes = models.IntegerField(default=480)
    requirements = models.JSONField(default=_default_requirements, blank=True)
    tasks = models.TextField(blank=True, default="")
    features = models.TextField(blank=True, default="")
    location_description = models.TextField(blank=True, default="")
    is_outdoor = models.BooleanField(null=True, blank=True)
    max_continuous_minutes = models.IntegerField(null=True, blank=True)
    min_rating = models.DecimalField(
        max_digits=3, decimal_places=1, null=True, blank=True
    )
    requires_weapon = models.BooleanField(default=False)
    requires_special_equipment = models.BooleanField(default=False)
    requires_uniform = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_posts"
        ordering = ["code", "id"]
        constraints = [
            # Partial (is_active=True): a deactivated post releases its code
            # for re-creation — mirror of the sector-name rule.
            models.UniqueConstraint(
                "facility",
                Lower("code"),
                condition=Q(is_active=True),
                name="uq_post_facility_code",
            ),
            models.CheckConstraint(
                condition=Q(code__regex=r"\S"),
                name="chk_post_code_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(name__regex=r"\S"),
                name="chk_post_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(max_service_minutes__gte=30)
                & Q(max_service_minutes__lte=1440),
                name="chk_post_service_minutes_range",
            ),
            models.CheckConstraint(
                condition=Q(max_continuous_minutes__isnull=True)
                | Q(max_continuous_minutes__gt=0),
                name="chk_post_continuous_minutes_min",
            ),
            models.CheckConstraint(
                condition=Q(min_rating__isnull=True) | Q(min_rating__gte=0),
                name="chk_post_min_rating_min",
            ),
        ]

    def __str__(self):
        return f"{self.code} {self.name} @ {self.facility_id}"
