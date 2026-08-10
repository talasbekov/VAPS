"""Служебные отчёты (§22.18-22.28) — порт мок-контракта клиента.

Работа: PENDING → PROCESSING → COMPLETED|FAILED. Состояния СЕРВЕРНЫЕ;
ступень генерации выполняется на чтении (фонового исполнителя нет — то же
упрощение, что у выгрузок рейтинга).

Артефакт НЕИЗМЕНЯЕМ (§22.22): формируется ровно на переходе в COMPLETED и
больше не меняется. Срок хранения замораживается В АРТЕФАКТЕ на момент
сборки; редакция считается по СЕРИИ (тип + период + режим выгрузки), а не по
работе. Содержимое наружу не сериализуется нигде, кроме операции скачивания
(§22.23 — постоянной ссылки на файл не существует вовсе).
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

_JOB_STATES = ("PENDING", "PROCESSING", "COMPLETED", "FAILED")


class OpsServiceReportType(TimeStampedModel):
    """Определение отчёта (§22.19) БЕЗ предела периода: глубина принадлежит
    политике «Настроек» (REPORT_LIMITS) и приезжает к типу на чтении."""

    report_type_code = models.CharField(max_length=100, unique=True)
    safe_title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    formats = models.JSONField()
    position = models.IntegerField()

    class Meta:
        db_table = "ops_service_report_types"
        verbose_name = "Тип служебного отчёта"
        verbose_name_plural = "Типы служебных отчётов"
        ordering = ["position", "id"]

    def __str__(self):
        return self.report_type_code


class OpsServiceReportJob(TimeStampedModel):
    """Работа генерации. Ключ идемпотентности уникален: повтор с тем же
    ключом возвращает ТУ ЖЕ работу (§22.21), а не создаёт вторую."""

    job_code = models.CharField(max_length=100, unique=True)
    report_type_code = models.CharField(max_length=100)
    format = models.CharField(max_length=10)
    state = models.CharField(max_length=20)
    progress_percent = models.IntegerField(null=True)
    requested_at = models.DateTimeField()
    created_by_user_id = models.CharField(max_length=255)
    created_by_label = models.CharField(max_length=255)
    completed_at = models.DateTimeField(null=True)
    failure_code = models.CharField(max_length=100, null=True)
    safe_failure_message = models.TextField(null=True)
    artifact_code = models.CharField(max_length=100, null=True)
    idempotency_key = models.CharField(max_length=255, unique=True)
    sensitive = models.BooleanField()
    param_from = models.DateField()
    param_to = models.DateField()

    class Meta:
        db_table = "ops_service_report_jobs"
        verbose_name = "Работа служебного отчёта"
        verbose_name_plural = "Работы служебных отчётов"
        # История читается свежими сверху; ключ — тай-брейкер.
        ordering = ["-requested_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(state__in=_JOB_STATES),
                name="chk_ops_report_job_state",
            ),
        ]

    def __str__(self):
        return self.job_code


class OpsServiceReportArtifact(TimeStampedModel):
    """Неизменяемый файл выгрузки (§22.22). Хранит версии расчёта,
    маскирования и удержания, по которым был построен, и снимок параметров:
    политику могли сменить после сборки, а файл остался прежним."""

    artifact_code = models.CharField(max_length=100, unique=True)
    job_code = models.CharField(max_length=100)
    report_type_code = models.CharField(max_length=100)
    safe_title = models.CharField(max_length=255)
    format = models.CharField(max_length=10)
    revision = models.IntegerField()
    generated_at = models.DateTimeField()
    generated_by = models.CharField(max_length=255)
    param_from = models.DateField()
    param_to = models.DateField()
    calculation_version = models.CharField(max_length=100)
    masking_policy_version = models.CharField(max_length=100)
    retention_policy_version = models.CharField(max_length=100)
    sensitive = models.BooleanField()
    file_size = models.IntegerField()
    hash = models.CharField(max_length=32)
    expires_at = models.DateTimeField()
    content = models.TextField()

    class Meta:
        db_table = "ops_service_report_artifacts"
        verbose_name = "Артефакт служебного отчёта"
        verbose_name_plural = "Артефакты служебных отчётов"
        ordering = ["-generated_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(revision__gte=1),
                name="chk_ops_report_artifact_revision",
            ),
        ]

    def __str__(self):
        return self.artifact_code
