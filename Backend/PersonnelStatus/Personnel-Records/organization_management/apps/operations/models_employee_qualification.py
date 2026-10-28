"""Append-only evidence of an employee skill assessment; legacy scores are untouched."""
import uuid
from django.core.exceptions import ValidationError
from django.db import models


class OpsEmployeeQualification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="qualification_assessments")
    skill = models.CharField(max_length=32, choices=[
        ("shooting", "Стрельба"), ("hand_to_hand", "Рукопашный бой"),
        ("physical_fitness", "Физическая подготовка"),
    ])
    score = models.PositiveSmallIntegerField()
    assessed_on = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    basis = models.CharField(max_length=1000)
    recorded_by = models.CharField(max_length=100, editable=False)
    recorded_by_name = models.CharField(max_length=150, editable=False)
    request_key = models.CharField(max_length=80, editable=False)
    request_hash = models.CharField(max_length=64, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ops_employee_qualifications"
        verbose_name = "Проверка квалификации сотрудника"
        verbose_name_plural = "Проверки квалификации сотрудников"
        ordering = ["-assessed_on", "-created_at", "-id"]
        indexes = [models.Index(fields=["employee", "skill", "-assessed_on"], name="idx_qualification_skill_date")]
        constraints = [
            models.UniqueConstraint(fields=["employee", "request_key"], name="uniq_qualification_request"),
            models.CheckConstraint(condition=models.Q(score__gte=1, score__lte=5), name="chk_qualification_score"),
            models.CheckConstraint(condition=models.Q(valid_until__isnull=True) | models.Q(valid_until__gte=models.F("assessed_on")), name="chk_qualification_period"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Сохранённая проверка не изменяется. Добавьте новую запись с основанием.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("История проверок не удаляется через карточку сотрудника.")

