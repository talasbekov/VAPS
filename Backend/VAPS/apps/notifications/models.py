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
        constraints = [
            # «Одно уведомление на день»: at most one of a given kind per
            # recipient per business_date — makes notify() idempotent.
            models.UniqueConstraint(
                fields=["recipient", "kind", "business_date"],
                name="uq_notification_recipient_kind_date",
            ),
        ]
        verbose_name = "Уведомление"
        verbose_name_plural = "Уведомления"

    def __str__(self):
        return f"{self.kind} → {self.recipient} ({self.business_date})"
