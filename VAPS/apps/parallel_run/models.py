"""Story 6.9 — parallel-run seed: persistent discrepancy registry.

Two flat models (ARCH-003, no cross-context FK) written ONLY by the
parallel-run diff job (`services.parallel_run_diff`), never by an actor:

* ``ParallelRunDiff`` — one classified donor-vs-VAPS discrepancy cell per
  (run_date, division_code, column_code). Mirrors ``donor_diff.DiffCell``
  (division_code/column/vaps/donor/delta/category); ``is_blocking`` and
  ``pending_signature`` are derived at persist time.
* ``ParallelRunDay`` — one summary row per attempted business date. Its
  ``status`` (ok / no_baseline / error) distinguishes «прогнан» from «не
  прогнан», and the consecutive-green count reads from it. It is NOT the
  watermark — the watermark lives in the core ``Watermark`` gateway.

NOT registered in Django Admin (business models, MUST NOT). The owner-signed
model-diff registry, the exit criterion and the green dashboard are Story 7.8.
"""

from django.db import models


class ParallelRunDiff(models.Model):
    """One classified donor-vs-VAPS discrepancy cell for a business date."""

    run_date = models.DateField()
    division_code = models.CharField(max_length=100)
    # Stores ``DiffCell.column`` verbatim — may be a synthetic string such as
    # "Штат<Список", "attached" or "IN_SERVICE", NOT a closed column-code enum.
    column_code = models.CharField(max_length=100)
    donor_value = models.IntegerField()
    vaps_value = models.IntegerField()
    delta = models.IntegerField()
    category = models.CharField(max_length=64)
    is_blocking = models.BooleanField()
    pending_signature = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "parallel_run_diffs"
        constraints = [
            models.UniqueConstraint(
                fields=("run_date", "division_code", "column_code"),
                name="uq_parallel_run_diff_cell",
            ),
            # Category is never a silent empty string (Bratan preference); NOT an
            # enum list — that would couple this migration to the classifier's
            # category catalog (1.8/7.8) and turn a new category into an
            # IntegrityError inside the job's per-day atomic (poisons the
            # connection) instead of a soft ticket.
            models.CheckConstraint(
                condition=~models.Q(category=""),
                name="chk_parallel_run_diff_category_not_empty",
            ),
            # Head-counts are non-negative; ``delta`` may be negative (no floor).
            models.CheckConstraint(
                condition=models.Q(donor_value__gte=0)
                & models.Q(vaps_value__gte=0),
                name="chk_parallel_run_diff_values_nonneg",
            ),
        ]


class ParallelRunDay(models.Model):
    """Per-business-date summary of one parallel-run diff attempt."""

    STATUS_OK = "ok"
    STATUS_NO_BASELINE = "no_baseline"
    STATUS_ERROR = "error"

    run_date = models.DateField(unique=True)
    status = models.CharField(max_length=32)
    blocking_count = models.IntegerField(default=0)
    total_diffs = models.IntegerField(default=0)
    ran_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "parallel_run_days"
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(status=""),
                name="chk_parallel_run_day_status_not_empty",
            ),
            models.CheckConstraint(
                condition=models.Q(blocking_count__gte=0)
                & models.Q(total_diffs__gte=0),
                name="chk_parallel_run_day_counts_nonneg",
            ),
        ]
