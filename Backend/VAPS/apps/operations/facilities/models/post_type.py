from django.db import models


class PostType(models.Model):
    """Reference catalog of post types (donor ``ops_post_types``, DB-OPS-004).

    Natural VARCHAR ``code`` PK (StatusType/Role precedent). ``is_active``
    extends the donor (code+name only) per the house catalog canon —
    deactivate instead of delete. Seeded by ``seed_facilities``
    (FIXED/MOBILE/CHECKPOINT/RESERVE); admin-managed (catalog, not a
    business model).
    """

    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_post_types"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} {self.name}"
