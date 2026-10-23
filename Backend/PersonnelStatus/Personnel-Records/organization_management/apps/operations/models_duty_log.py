"""Administrative duty records; supplements never replace their source rows."""
from django.db import models

from organization_management.apps.operations.clock import Clock


class DutyExecutionFields(models.Model):
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.CharField(max_length=255, blank=True, default="")
    actual_start = models.DateTimeField(null=True, blank=True)
    started_by = models.CharField(max_length=255, blank=True, default="")
    actual_end = models.DateTimeField(null=True, blank=True)
    completed_by = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        abstract = True


def actual_interval_constraint(name):
    return models.CheckConstraint(
        condition=models.Q(actual_end__isnull=True) | (
            models.Q(actual_start__isnull=False) & models.Q(actual_end__gte=models.F("actual_start"))
        ), name=name,
    )


class OpsDutyLogEntry(DutyExecutionFields):
    revision = models.PositiveIntegerField(default=1)
    client_request_id = models.UUIDField(null=True, blank=True, unique=True)
    creation_fingerprint = models.CharField(max_length=64, blank=True, default="")
    employee_id = models.PositiveBigIntegerField()
    employee_name = models.CharField(max_length=500)
    # Historical affiliation is not rewritten when the employee transfers.
    division_id = models.PositiveBigIntegerField(null=True)
    division_name = models.CharField(max_length=500, blank=True, default="")
    service_duty_code = models.CharField(max_length=100)
    service_duty_label = models.CharField(max_length=255)
    planned_start = models.DateTimeField()
    planned_end = models.DateTimeField()
    location_label = models.CharField(max_length=500, blank=True, default="")
    document_basis = models.CharField(max_length=500, blank=True, default="")
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=Clock.now)
    created_by = models.CharField(max_length=255)
    updated_at = models.DateTimeField(default=Clock.now)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=255, blank=True, default="")
    cancelled_reason = models.TextField(blank=True, default="")
    admin_readonly = True

    class Meta:
        db_table = "ops_duty_log_entries"
        ordering = ["planned_start", "pk"]
        verbose_name = "Запись журнала дежурств"
        verbose_name_plural = "Журнал дежурств"
        indexes = [
            models.Index(fields=["division_id", "planned_start"], name="duty_log_division_start"),
            models.Index(fields=["employee_id", "planned_start"], name="duty_log_employee_start"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(planned_start__lt=models.F("planned_end")), name="chk_duty_log_plan_interval"),
            models.CheckConstraint(condition=models.Q(service_duty_code__regex=r"\S"), name="chk_duty_log_kind"),
            actual_interval_constraint("chk_duty_log_actual_interval"),
        ]


class OpsDutyCreationClosure(models.Model):
    """A durable receipt prevents a late POST from recreating a closed attempt."""
    client_request_id = models.UUIDField()
    created_by = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=Clock.now)
    admin_readonly = True

    class Meta:
        db_table = "ops_duty_creation_closures"
        verbose_name = "Закрытая попытка записи дежурства"
        verbose_name_plural = "Закрытые попытки записи дежурства"
        constraints = [models.UniqueConstraint(fields=["created_by", "client_request_id"], name="uniq_duty_creation_closure")]


class OpsDutyRecordSupplement(DutyExecutionFields):
    source_type = models.CharField(max_length=20)
    source_id = models.PositiveBigIntegerField()
    # Existing PLAN/DISPATCH keep the empty key. STATUS owns one supplement
    # per exact exit, identified by content rather than a mutable array index.
    source_key = models.CharField(max_length=64, blank=True, default="")
    source_snapshot = models.JSONField(default=dict, blank=True)
    service_duty_code = models.CharField(max_length=100, blank=True, default="")
    service_duty_label = models.CharField(max_length=255, blank=True, default="")
    employee_id = models.PositiveBigIntegerField(null=True)
    employee_name = models.CharField(max_length=500, blank=True, default="")
    division_id = models.PositiveBigIntegerField(null=True)
    division_name = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(default=Clock.now)
    created_by = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(default=Clock.now)
    updated_by = models.CharField(max_length=255, blank=True, default="")
    admin_readonly = True

    class Meta:
        db_table = "ops_duty_record_supplements"
        verbose_name = "Дополнение учёта дежурства"
        verbose_name_plural = "Дополнения учёта дежурств"
        constraints = [
            models.UniqueConstraint(fields=["source_type", "source_id", "source_key"], name="uniq_duty_supplement_source"),
            models.CheckConstraint(condition=models.Q(source_type__in=("DISPATCH", "PLAN", "STATUS")), name="chk_duty_supplement_source"),
            models.CheckConstraint(condition=(models.Q(source_type="STATUS", source_key__regex=r"^[0-9a-f]{64}$",
                source_snapshot__has_keys=["source_id", "employee_id", "placement", "date_start", "date_end", "planned_start", "planned_end"])
                | (~models.Q(source_type="STATUS") & models.Q(source_key="", source_snapshot={}))), name="chk_duty_supplement_key"),
            models.CheckConstraint(condition=(~models.Q(source_type="PLAN") | models.Q(
                acknowledged_at__isnull=True, actual_start__isnull=True, actual_end__isnull=True,
                acknowledged_by="", started_by="", completed_by="",
            )), name="chk_duty_plan_execution_owner"),
            actual_interval_constraint("chk_duty_supplement_actual"),
        ]
