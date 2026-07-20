"""Facility — охраняемый объект (Story 14.1, FR-19).

The donor DDL (VAPS_7.8.2 DB-OPS-005 ``ops_objects``) is a semantic contract,
not a literal one: operations tables use integer surrogate PKs (ARCH-003), the
Glossary name is Facility — never Object/Site — and ``importance_level_code``
stays a plain nullable string: the importance catalog belongs to the OM
context (E15), so no FK yet. No delete path exists in services — lifecycle is
``is_active`` (soft-delete under external references, ARCH-DATA-025).
"""

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.operations.models import TimeStampedModel


class Facility(TimeStampedModel):
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    address = models.TextField()
    # Donor leaves coordinates unchecked — the range guard below closes that
    # hole at the DB level (the DB owns invariants, not the form layer).
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    importance_level_code = models.CharField(max_length=50, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_facilities"
        # id is the tie-breaker: names are not unique, and pagination over an
        # ambiguous order silently drops rows (canon L427).
        ordering = ["name", "id"]
        constraints = [
            # Case-insensitive: 'OBJ-1' and 'obj-1' are the same facility —
            # a byte-wise unique would let the duplicate slip past the 409.
            models.UniqueConstraint(Lower("code"), name="uq_facility_code"),
            models.CheckConstraint(
                condition=Q(code__regex=r"\S"),
                name="chk_facility_code_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(name__regex=r"\S"),
                name="chk_facility_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(address__regex=r"\S"),
                name="chk_facility_address_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(latitude__isnull=True)
                | (Q(latitude__gte=-90) & Q(latitude__lte=90)),
                name="chk_facility_lat_range",
            ),
            models.CheckConstraint(
                condition=Q(longitude__isnull=True)
                | (Q(longitude__gte=-180) & Q(longitude__lte=180)),
                name="chk_facility_lon_range",
            ),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"
