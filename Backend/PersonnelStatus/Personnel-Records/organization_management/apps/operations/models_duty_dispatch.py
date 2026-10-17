"""Placement is owned by the receiver; the personnel allocation stays untouched."""
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models

from organization_management.apps.operations.clock import Clock


class OpsDutyDispatchConfig(models.Model):
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True)
    receiver_department_id = models.PositiveIntegerField(null=True)
    updated_at = models.DateTimeField(default=Clock.now)
    updated_by = models.CharField(max_length=255, blank=True)
    admin_readonly = True

    class Meta:
        db_table = "ops_duty_dispatch_config"
        verbose_name = "Настройка приёма дежурных"
        verbose_name_plural = "Настройки приёма дежурных"
        constraints = [models.CheckConstraint(condition=models.Q(singleton_key=1), name="chk_dispatch_config_singleton")]


class OpsDutyDispatchAssignment(models.Model):
    employee_id = models.PositiveIntegerField()
    employee_name = models.CharField(max_length=500)
    source_status = models.ForeignKey("operations.OpsEmployeeStatus", on_delete=models.PROTECT, related_name="dispatch_assignments")
    receiver_department_id = models.PositiveIntegerField()
    placement = models.JSONField()
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    period = models.GeneratedField(expression=models.Func(models.F("start_at"), models.F("end_at"), models.Value("[)"), function="tstzrange", output_field=DateTimeRangeField()), output_field=DateTimeRangeField(), db_persist=True)
    created_at = models.DateTimeField(default=Clock.now)
    created_by = models.CharField(max_length=255)
    cancelled_at = models.DateTimeField(null=True)
    cancelled_by = models.CharField(max_length=255, blank=True)
    cancelled_reason = models.TextField(blank=True)
    admin_readonly = True

    class Meta:
        db_table = "ops_duty_dispatch_assignments"
        verbose_name = "Расстановка дежурного"
        verbose_name_plural = "Расстановка дежурных"
        ordering = ["start_at", "pk"]
        constraints = [
            models.CheckConstraint(condition=models.Q(start_at__lt=models.F("end_at")), name="chk_dispatch_interval"),
            ExclusionConstraint(name="excl_dispatch_employee_overlap", expressions=[(models.F("employee_id"), RangeOperators.EQUAL), (models.F("period"), RangeOperators.OVERLAPS)], condition=models.Q(cancelled_at__isnull=True)),
        ]
