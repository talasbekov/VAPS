from datetime import time

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.operations.models import TimeStampedModel


class SubmissionControlSettings(TimeStampedModel):
    """Singleton config for submission control (FR-13 / FR-18 / FR-39).

    Provides the «контрольный час» and «необходимые управления» that the
    traffic-light (5.5), next-day lock (5.6) and beat notifications (5.7)
    consume — those consumers are out of scope here. Read via
    SubmissionControlSettingsSelector; not edited through a service (plain
    reference config), so it stays Admin-editable once Admin lands in 2.8.
    """

    # Singleton enforcer: unique + the CheckConstraint below pin the key to 1,
    # so exactly one row is possible (not just one-per-key). The default row is
    # seeded by migration 0001, so the selector normally only reads.
    singleton_key = models.PositiveSmallIntegerField(
        default=1, unique=True, editable=False
    )
    # Threshold time in VAPS_LOCAL_TIMEZONE (Asia/Qyzylorda). This is config,
    # NOT a wall-clock read — consumers compare Clock.now() against it.
    control_hour = models.TimeField(default=time(17, 0))
    # «Необходимые управления»: flat UUIDs → core_divisions.id (ARCH-003 —
    # cross-context references are flat UUIDs, never FKs). Resolve names via
    # CoreDivisionTreeSelector, never by importing apps.core.models.
    required_division_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    # Global «дежурный» recipient — the fallback for divisions without a specific
    # DivisionNotifyRecipient (Q1b, 5.7b1). Flat actor id (ARCH-007). May be blank
    # («нет дежурного») → an unmapped division simply is not resolved by
    # NotifyRecipientSelector.resolve_many (5.7b2 logs + skips it).
    default_notify_recipient = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = "ops_submission_control_settings"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(singleton_key=1),
                name="ck_submission_control_settings_singleton",
            ),
            # «Нет дежурного» must mean blank (""), never whitespace-only: a
            # value like "   " is truthy and would resolve every unmapped
            # division to a garbage recipient. Allow "" (default), reject any
            # non-empty all-whitespace value. Mirrors DivisionNotifyRecipient's
            # non-blank guard for symmetry (5.7b1 review).
            models.CheckConstraint(
                condition=~models.Q(default_notify_recipient__regex=r"^\s+$"),
                name="ck_submission_control_settings_duty_not_whitespace",
            ),
        ]
        verbose_name = "Настройки контроля сдачи"
        verbose_name_plural = "Настройки контроля сдачи"

    def __str__(self):
        return f"control_hour={self.control_hour}"
