"""Нормативная база ОМ — справочник законов/приказов/регламентов/инструкций.

Читается реестром «Законы об ОМ» (/security-ops/laws). file_url сохраняет
прежние внешние ссылки; загруженные версии хранятся отдельно и приватно.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel
from organization_management.apps.operations.legal_document_storage import LegalDocumentStorage


class OpsLegalDocument(TimeStampedModel):
    class Kind(models.TextChoices):
        LAW = "LAW", "Закон"
        ORDER = "ORDER", "Приказ"
        REGULATION = "REGULATION", "Регламент"
        INSTRUCTION = "INSTRUCTION", "Инструкция"

    class Status(models.TextChoices):
        IN_FORCE = "IN_FORCE", "Действует"
        UNDER_REVIEW = "UNDER_REVIEW", "На пересмотре"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    code = models.CharField(max_length=100, unique=True)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    revision = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices)
    pages = models.PositiveIntegerField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    file_url = models.CharField(max_length=500, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "code", "id"]
        verbose_name = "Закон об ОМ"
        verbose_name_plural = "Законы об ОМ"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    kind__in=("LAW", "ORDER", "REGULATION", "INSTRUCTION")
                ),
                name="chk_ops_legal_document_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=("IN_FORCE", "UNDER_REVIEW")),
                name="chk_ops_legal_document_status",
            ),
        ]

    def __str__(self):
        return f"{self.code} — {self.title}"


class OpsLegalDocumentFile(TimeStampedModel):
    document = models.ForeignKey(OpsLegalDocument, on_delete=models.PROTECT, related_name="files")
    file = models.FileField(storage=LegalDocumentStorage(), max_length=250)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "Файл нормативного документа"
        verbose_name_plural = "Файлы нормативных документов"

    def __str__(self):
        return self.original_name
