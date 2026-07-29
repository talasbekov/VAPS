"""Story 14.1: `Object` (охраняемая инфраструктура) + `ObjectPassport` (паспорт).

Naming: donor spec (docs/PersonnelStatus/VAPS_7.8.2.md §17, DB-OPS-004/014)
and PRD's glossary (prd.md:55) both use «Объект»/`ops_objects` — the epic's
own one-line title ("Facility") was a draft English label at planning time,
not a binding name. Models/db_table follow the donor+PRD terminology.

Scope (14.1): models + migration ONLY — no API, no services, no RBAC (see
the story's Scope Decision). `importance_level_code` is a plain CharField,
NOT a FK: the donor's `ops_event_levels` reference table doesn't exist yet
(Epic 15's territory) — building a FK to a nonexistent table isn't possible,
and this field becomes a real FK in a later migration once that table lands.
`ops_object_passport_history` (donor DB-OPS-015, field-change audit trail)
is out of scope — likely 14.12 or a future story.
"""

from django.db import models

from apps.operations.models import TimeStampedModel


class Object(TimeStampedModel):
    """Охраняемая инфраструктура (donor `ops_objects`, DB-OPS-004)."""

    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    address = models.TextField()
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    # Donor FK -> ops_event_levels (Epic 15, not built yet) — plain field
    # until that reference table exists; becomes a real FK in a later
    # migration, not reinterpreted or dropped.
    importance_level_code = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_objects"
        verbose_name = "Объект"
        verbose_name_plural = "Объекты"

    def __str__(self):
        return f"{self.code} — {self.name}"


class ObjectPassport(TimeStampedModel):
    """Паспорт объекта (donor `ops_object_passports`, DB-OPS-014).

    1:1 with `Object` — one passport per object (donor's
    `object_id UUID UNIQUE REFERENCES` maps directly to `OneToOneField`).
    """

    class CompletenessStatus(models.TextChoices):
        RED = "RED", "Не заполнен"
        YELLOW = "YELLOW", "Частично заполнен"
        GREEN = "GREEN", "Заполнен"

    object = models.OneToOneField(
        Object, on_delete=models.CASCADE, related_name="passport"
    )
    object_type = models.CharField(max_length=100, blank=True)
    # ARCH-007: flat external actor ids, never FKs into core.models.
    responsible_user_id = models.CharField(max_length=100, blank=True)
    responsible_employee_id = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    security_notes = models.TextField(blank=True)
    # PRD's «проблемные места» — this single field, not a separate table
    # (donor doesn't model it as one either).
    vulnerable_places = models.TextField(blank=True)

    # Structural layout fields (donor: JSONB DEFAULT '[]', 12 fields).
    access_routes = models.JSONField(default=list, blank=True)
    entrances = models.JSONField(default=list, blank=True)
    exits = models.JSONField(default=list, blank=True)
    service_entrances = models.JSONField(default=list, blank=True)
    parking_zones = models.JSONField(default=list, blank=True)
    dropoff_zones = models.JSONField(default=list, blank=True)
    elevators = models.JSONField(default=list, blank=True)
    stairs = models.JSONField(default=list, blank=True)
    roofs = models.JSONField(default=list, blank=True)
    basements = models.JSONField(default=list, blank=True)
    technical_rooms = models.JSONField(default=list, blank=True)
    cameras = models.JSONField(default=list, blank=True)

    # Infrastructure text fields (donor: 8 plain text columns).
    power_supply = models.TextField(blank=True)
    ventilation = models.TextField(blank=True)
    communication = models.TextField(blank=True)
    internet = models.TextField(blank=True)
    nearby_high_buildings = models.TextField(blank=True)
    public_zones = models.TextField(blank=True)
    crowd_places = models.TextField(blank=True)
    repair_works = models.TextField(blank=True)

    completeness_status = models.CharField(
        max_length=10,
        choices=CompletenessStatus.choices,
        default=CompletenessStatus.RED,
    )
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_verified_by = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "ops_object_passports"
        verbose_name = "Паспорт объекта"
        verbose_name_plural = "Паспорта объектов"
        constraints = [
            # choices без DB-гарда пропускает bulk_create()/.objects.create()
            # (lesson: feedback_vaps_db_integrity_checks) — mirror the
            # ck_<table>_<field>_choices pattern established in 13.5a/13.5c.
            models.CheckConstraint(
                condition=models.Q(
                    completeness_status__in=["RED", "YELLOW", "GREEN"]
                ),
                name="ck_object_passport_completeness_status_choices",
            ),
        ]

    def __str__(self):
        return f"Паспорт {self.object.code} ({self.completeness_status})"
