"""Dated object inspections; separate from passport publication freshness."""
from django.conf import settings
from django.db import models
from organization_management.apps.operations.models import TimeStampedModel


class OpsObjectInspection(TimeStampedModel):
    security_object = models.ForeignKey("operations.OpsSecurityObject", on_delete=models.PROTECT, related_name="inspections")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="object_inspections")
    inspected_on = models.DateField()
    items = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=1)
    completed_at = models.DateTimeField(null=True, blank=True)
    request_key = models.CharField(max_length=80)
    request_hash = models.CharField(max_length=64)

    class Meta:
        db_table = "ops_object_inspections"
        verbose_name = "Обследование объекта"
        verbose_name_plural = "Обследования объектов"
        ordering = ["-inspected_on", "-pk"]
        constraints = [
            models.UniqueConstraint(fields=["reviewer", "request_key"], name="uq_object_inspection_request"),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name="chk_object_inspection_revision"),
        ]

