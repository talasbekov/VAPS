from django.db import models


class StatusType(models.Model):
    """Reference catalog of personnel status types (DB-OPS-003).

    Natural VARCHAR ``code`` PK (Role/Permission precedent), the FK target for
    ``EmployeeStatus.status_type_code`` via ``to_field="code"`` — the FK
    conversion itself is out of scope for story 2.2. ``is_hard_block`` is the
    stored discriminator the exclusion constraint and conflict detector consume
    (hard -> 422, soft -> 409 + override). Seeded by ``seed_statuses``;
    deactivate via ``is_active`` rather than hard delete (no business records
    point here yet, so this stays a plain reference table).
    """

    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=100)
    is_hard_block = models.BooleanField(default=False)
    priority = models.IntegerField()
    report_column_code = models.CharField(max_length=30)
    counts_in_list = models.BooleanField(default=True)
    counts_in_staff = models.BooleanField(default=True)
    is_ku_owned = models.BooleanField(default=False)
    # FR-16: only "Откомандирован" (DETACHED) loses status-editing rights.
    restricts_editing = models.BooleanField(default=False)
    # FR-39 contract column; concrete palette deferred to the UI story.
    color = models.CharField(max_length=20, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_status_types"
        # priority is not unique → "code" gives a deterministic tie-break.
        ordering = ["priority", "code"]
        verbose_name = "Тип статуса"
        verbose_name_plural = "Типы статусов"

    def __str__(self):
        return self.code
