"""Story 19.3 (FR-32/FR-39, OQ-6 нерешён): справочник коэффициентов
поправок нагрузки. `code`(free text)/`multiplier`(единый Decimal) —
минимальная форма reference-таблицы (образец: `apps.operations.
statuses.models.StatusType`), намеренно НЕ связывающая будущую
семантику применения — OQ-6 (§8) не определяет ни единицы, ни
таксономию сезон/погода. Ни одно место кода эту модель не читает; её
применение к расчёту нагрузки/лимита — будущая стори."""

from django.db import models


class LoadCoefficient(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=100)
    multiplier = models.DecimalField(max_digits=6, decimal_places=3)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_load_coefficients"
        verbose_name = "Коэффициент поправки нагрузки"
        verbose_name_plural = "Коэффициенты поправок нагрузки"
        ordering = ["code"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(multiplier__gt=0),
                name="ck_load_coefficient_multiplier_positive",
            ),
            # review (Blind Hunter + Edge Case Hunter): CharField's blank=False
            # is a full_clean()-only guard, never enforced by .objects.create()
            # — without this, an empty-string code silently becomes a valid PK.
            models.CheckConstraint(
                condition=~models.Q(code=""),
                name="ck_load_coefficient_code_not_blank",
            ),
        ]

    def __str__(self):
        return f"{self.code} ({self.multiplier})"
