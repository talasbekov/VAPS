"""Нормативная база ОМ — справочник законов/приказов/регламентов/инструкций.

Читается реестром «Законы об ОМ» (/security-ops/laws). Файлы документов
система НЕ хранит: file_url — отдельное честное поле (null = файла нет),
а не догадка по коду. Правка — Django Admin (Admin = справочники).
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


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
    pages = models.PositiveIntegerField()
    file_url = models.CharField(max_length=500, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "code", "id"]
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
