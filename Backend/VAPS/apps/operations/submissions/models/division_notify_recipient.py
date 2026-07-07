from django.core.exceptions import ValidationError
from django.db import models

from apps.operations.models import TimeStampedModel


class DivisionNotifyRecipient(TimeStampedModel):
    """Config: who receives lagging-submission notifications for a division (5.7b1).

    A reference table (admin-managed config, NOT a business record) that maps a
    division to the actor id that catch-up (5.7b2) должна уведомлять when that
    division's management is lagging. This closes the «дивизион→ответственный»
    gap 5.7a left open (Notification.recipient is a flat actor id, but nothing
    resolved it). A global fallback lives on
    ``SubmissionControlSettings.default_notify_recipient``; resolution is
    ``NotifyRecipientSelector.resolve_many``.

    Flat references only (ARCH-003 — ``division_id`` is a plain UUID into
    ``core_divisions.id``, never an FK; resolve names via ``CoreDivisionTreeSelector``,
    never by importing ``apps.core.models``). ``recipient`` is a flat actor id
    (ARCH-007), non-blank both on the DB (CheckConstraint below rejects "" AND
    whitespace-only — ``.create()`` bypasses ``full_clean``, so the invariant truly
    lives on the DB) and via ``clean`` (admin edit-safety: strips + a friendly
    error instead of a raw 500).

    As config it IS registered in Admin — unlike the business records
    ``DailySubmission`` / ``Notification``. Scope (5.7b1): persistence + the bulk
    selector. No catch-up/detect (5.7b2), no ``notify()`` (5.7a), no API (5.7c).
    """

    # Flat UUID → core_divisions.id (ARCH-003, no FK). One recipient per division.
    division_id = models.UUIDField(unique=True)
    # Flat actor id of the recipient (ARCH-007), non-blank (see CheckConstraint).
    recipient = models.CharField(max_length=100)

    class Meta:
        db_table = "division_notify_recipients"
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(recipient__regex=r"^\s*$"),
                name="ck_division_notify_recipient_not_blank",
            ),
        ]
        verbose_name = "Получатель уведомлений подразделения"
        verbose_name_plural = "Получатели уведомлений подразделений"

    def clean(self):
        super().clean()
        stripped = (self.recipient or "").strip()
        if not stripped:
            raise ValidationError({"recipient": "Получатель не может быть пустым."})
        self.recipient = stripped

    def __str__(self):
        return f"{self.division_id} → {self.recipient}"
