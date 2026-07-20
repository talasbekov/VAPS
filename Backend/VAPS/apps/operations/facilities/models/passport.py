"""FacilityPassport + history (Story 14.1, FR-19; donor DB-OPS-014/015).

The passport is 1:1 with its Facility and rides its lifecycle (CASCADE). The
«проблемные места» of the PRD are ONE text field (``vulnerable_places``) — the
donor merged PRD §6.1 and VisitX §18.3 into a single column; no child table
exists anywhere in the sources.

``completeness_status`` is a plain guarded field: the rule that computes
RED/YELLOW/GREEN and the verify flow belong to 15.4 — the required-field list
is not fixed by any source, so nothing is derived here.

History vs audit (donor AC-041): every passport change writes BOTH a
``FacilityPassportHistory`` row (domain history: old/new diff + reason, read
back in the passport UI) and an ``audit_logs`` row (FR-36 cross-system trail).
They are different mechanisms, not duplication.
"""

from django.db import models
from django.db.models import Q

from apps.operations.models import TimeStampedModel


class FacilityPassport(TimeStampedModel):
    class Completeness(models.TextChoices):
        RED = "RED"
        YELLOW = "YELLOW"
        GREEN = "GREEN"

    facility = models.OneToOneField(
        "ops_facilities.Facility",
        on_delete=models.CASCADE,
        related_name="passport",
    )
    # Donor keeps object_type free text (no catalog exists in any source);
    # NULL means "not known" — no silent "".
    object_type = models.CharField(max_length=100, null=True, blank=True)
    # ARCH-007: actor as a flat string; ARCH-003: cross-context employee
    # reference as a bare UUID, never an FK into core.
    responsible_user_id = models.CharField(max_length=100, null=True, blank=True)
    responsible_employee_id = models.UUIDField(null=True, blank=True)

    description = models.TextField(blank=True, default="")
    security_notes = models.TextField(blank=True, default="")
    vulnerable_places = models.TextField(
        blank=True, default="", verbose_name="Проблемные места"
    )
    power_supply = models.TextField(blank=True, default="")
    ventilation = models.TextField(blank=True, default="")
    communication = models.TextField(blank=True, default="")
    internet = models.TextField(blank=True, default="")
    nearby_high_buildings = models.TextField(blank=True, default="")
    public_zones = models.TextField(blank=True, default="")
    crowd_places = models.TextField(blank=True, default="")
    repair_works = models.TextField(blank=True, default="")

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

    completeness_status = models.CharField(
        max_length=50, choices=Completeness.choices, default=Completeness.RED
    )
    # verify flow is 15.4 — the fields exist (donor contract) but no service
    # writes them in 14.1.
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_verified_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "ops_facility_passports"
        constraints = [
            models.CheckConstraint(
                condition=Q(completeness_status__in=["RED", "YELLOW", "GREEN"]),
                name="chk_facility_passport_completeness",
            ),
        ]

    def __str__(self):
        return f"Паспорт {self.facility_id} ({self.completeness_status})"


class FacilityPassportHistory(models.Model):
    passport = models.ForeignKey(
        FacilityPassport, on_delete=models.CASCADE, related_name="history"
    )
    changed_by = models.CharField(max_length=100)
    # No auto_now_add / DB default: the write service sets it via Clock.now()
    # (the one controllable clock — same contract as audit_logs.created_at).
    changed_at = models.DateTimeField()
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField()
    reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "ops_facility_passport_history"
        ordering = ["-changed_at"]

    def __str__(self):
        return f"Правка паспорта {self.passport_id} @ {self.changed_at}"
