"""Independent planning aggregate. Never allocates operational resources."""
from django.core.exceptions import ValidationError
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsResourceCalculation(TimeStampedModel):
    event = models.OneToOneField("operations.OpsSecurityEvent", on_delete=models.CASCADE, related_name="resource_calculation")
    owner_division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, related_name="resource_calculations")
    document = models.JSONField(default=dict)
    snapshot = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    updated_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_resource_calculations"
        verbose_name = "Расчёт сил и средств"
        verbose_name_plural = "Расчёты сил и средств"
        constraints = [models.CheckConstraint(condition=models.Q(version__gte=1), name="chk_resource_calc_version")]

    def save(self, *args, **kwargs):
        if self.pk:
            old = type(self).objects.filter(pk=self.pk).values_list("owner_division_id", flat=True).first()
            if old is not None and old != self.owner_division_id:
                raise ValidationError("Владелец сохранённого расчёта неизменяем.")
        return super().save(*args, **kwargs)
