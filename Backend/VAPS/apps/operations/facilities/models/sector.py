"""Sector — зона ответственности из нескольких постов (14.2, FR-5.4).

«Старший сектора» is deliberately NOT a column: it is a per-date assignment
role (donor ``ops_assignment_roles.SECTOR_SENIOR``, ТЗ:53/101) that E16's
расстановка will bind — the donor's ``ops_object_sectors`` has no senior
field either. The sector itself is pure topology.
"""

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.operations.models import TimeStampedModel


class Sector(TimeStampedModel):
    facility = models.ForeignKey(
        "ops_facilities.Facility",
        on_delete=models.CASCADE,
        related_name="sectors",
    )
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_sectors"
        ordering = ["sort_order", "name", "id"]
        constraints = [
            # Case-insensitive per facility ('Периметр' ≡ 'ПЕРИМЕТР', 14.1
            # code lesson) and PARTIAL: a deactivated sector releases its
            # name — soft-delete must not squat display identifiers (there
            # is no reactivate path). Donor UNIQUE(object_id, name) is
            # byte-wise and total, freed by DELETE which we do not have.
            models.UniqueConstraint(
                "facility",
                Lower("name"),
                condition=Q(is_active=True),
                name="uq_sector_facility_name",
            ),
            models.CheckConstraint(
                condition=Q(name__regex=r"\S"),
                name="chk_sector_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(sort_order__gte=0),
                name="chk_sector_sort_order_min",
            ),
        ]

    def __str__(self):
        return f"{self.name} @ {self.facility_id}"
