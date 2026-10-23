"""Durable OM task ownership and receipts; domain records remain authoritative."""
import uuid
from django.db import models
from .models import TimeStampedModel


class OpsAssistantTask(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    initiated_by = models.CharField(max_length=100)
    request_key = models.CharField(max_length=80)
    request_hash = models.CharField(max_length=64)
    message = models.TextField()
    plan = models.JSONField(default=dict)
    event = models.ForeignKey("operations.OpsSecurityEvent", null=True, blank=True, on_delete=models.SET_NULL, related_name="assistant_tasks")
    status = models.CharField(max_length=40, default="needs_information")
    delegated = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "ops_assistant_tasks"
        verbose_name = "Поручение помощнику по ОМ"
        verbose_name_plural = "Поручения помощнику по ОМ"
        constraints = [models.UniqueConstraint(fields=["initiated_by", "request_key"], name="uniq_om_assistant_request")]
        indexes = [models.Index(fields=["initiated_by", "-updated_at"], name="idx_om_assistant_owner")]


class OpsAssistantReceipt(TimeStampedModel):
    task = models.ForeignKey(OpsAssistantTask, on_delete=models.CASCADE, related_name="receipts")
    operation_key = models.CharField(max_length=80)
    payload_hash = models.CharField(max_length=64)
    executed_by = models.CharField(max_length=100)
    result = models.JSONField(default=dict)

    class Meta:
        db_table = "ops_assistant_receipts"
        verbose_name = "Выполненное действие помощника по ОМ"
        verbose_name_plural = "Выполненные действия помощника по ОМ"
        constraints = [models.UniqueConstraint(fields=["task", "operation_key"], name="uniq_om_assistant_operation")]
