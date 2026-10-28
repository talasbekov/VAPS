"""Explicit connection-check evidence; no credentials, destinations or payloads."""
from django.db import models
from django.utils import timezone


class OpsAssistantConnectionCheck(models.Model):
    admin_readonly = True
    checked_at = models.DateTimeField(default=timezone.now)
    succeeded = models.BooleanField()
    provider = models.CharField(max_length=16)
    model = models.CharField(max_length=200, blank=True, default="")
    # Only a byte-equivalent saved configuration has a revision. Draft checks
    # and environment-only configurations never attest to saved settings.
    checked_saved_revision = models.CharField(max_length=36, null=True, blank=True)

    class Meta:
        db_table = "ops_assistant_connection_checks"
        verbose_name = "Проверка подключения Smart AI"
        verbose_name_plural = "Проверки подключения Smart AI"
        ordering = ["-checked_at", "-id"]
        indexes = [models.Index(fields=["-checked_at", "-id"], name="idx_ai_connection_check_time")]
