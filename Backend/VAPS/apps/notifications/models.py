from django.db import models

from apps.operations.models import TimeStampedModel


class Notification(TimeStampedModel):
    """A persisted notification (Story 5.7a).

    The backend record behind FR-13 «уведомления об отставании». One row per
    ``(recipient, kind, business_date)`` — «одно уведомление на день» enforced by
    a ``UniqueConstraint`` so emission is idempotent. ``recipient`` is a flat
    actor id (who is told — like ``DailySubmission.submitted_by``); ``payload`` is
    flat JSON (no FK into core/operations, ARCH-003). ``created_at`` (from
    ``TimeStampedModel``) is «когда»; ``read_at`` supports unread/read tracking
    for the read-API (5.7c) and WS delivery (E11).

    Scope (5.7a): persistence only. The lagging detection / recipient resolution
    is Story 5.7b; the ``GET /notifications`` read-API is 5.7c; WS delivery is
    E11. A business record — NOT registered in Admin (Admin = reference tables).
    """

    class Kind(models.TextChoices):
        SUBMISSION_LAGGING = "SUBMISSION_LAGGING", "Отставание по сдаче"

    recipient = models.CharField(max_length=100)
    kind = models.CharField(max_length=50, choices=Kind.choices)
    business_date = models.DateField()
    payload = models.JSONField(default=dict)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        indexes = [
            # Scoped-recency read (story 5.7c): the read-API query is
            # `recipient=? AND created_at>? ORDER BY -created_at, id`. The
            # UniqueConstraint's leftmost prefix (recipient) can't serve the
            # created_at range/sort, so a dedicated (recipient, -created_at, id)
            # index does — closes 5.7a deferred B9.
            models.Index(
                fields=["recipient", "-created_at", "id"],
                name="ix_notif_recipient_recency",
            ),
            # Unread lookup (story 11.4a): `recipient=? AND read_at IS NULL` is
            # off the leftmost prefix of the recency index above (it isn't
            # ordered by read_at at all), so it falls back to a scan of every
            # row for that recipient. A partial index on the unread subset
            # closes the other half of deferred-work.md:495 (the recency half
            # closed in 5.7c).
            models.Index(
                fields=["recipient"],
                name="ix_notif_recipient_unread",
                condition=models.Q(read_at__isnull=True),
            ),
        ]
        constraints = [
            # «Одно уведомление на день»: at most one of a given kind per
            # recipient per business_date — makes notify() idempotent.
            models.UniqueConstraint(
                fields=["recipient", "kind", "business_date"],
                name="uq_notification_recipient_kind_date",
            ),
            # kind без дефолта → `.objects.create()`/`get_or_create()` НЕ валидируют
            # choices (CharField.choices проверяется только в forms/full_clean —
            # урок chk_daily_submission_event). DB-гард держит словарь видов
            # (зеркало Kind.values; drift ловит test_kind_check_covers_kind_choices).
            models.CheckConstraint(
                condition=models.Q(kind__in=["SUBMISSION_LAGGING"]),
                name="chk_notification_kind",
            ),
        ]
        verbose_name = "Уведомление"
        verbose_name_plural = "Уведомления"

    def __str__(self):
        return f"{self.kind} → {self.recipient} ({self.business_date})"
