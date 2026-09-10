"""Снимок организационной области служебного отчёта (Plane №1125).

0117 открыл ``report.generate`` начальнику линейного департамента. Право
выдано с областью, поэтому job и его файл обязаны хранить уже развёрнутый
снимок подразделений: последующая смена гранта не расширяет готовый файл.

``NULL`` сохранён для прежних, глобальных отчётов и для безскоупового grant.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0117_head_department_service_reports"),
    ]

    operations = [
        migrations.AddField(
            model_name="opsservicereportjob",
            name="scope_division_ids",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opsservicereportartifact",
            name="scope_division_ids",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
