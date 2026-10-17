"""Казахское наименование у должностей и званий (UC-REF-001).

Необязательное, пустая строка — «перевода нет»; уникален код.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dictionaries", "0003_position_rank_code")]

    operations = [
        migrations.AddField(
            model_name="position",
            name="name_kk",
            field=models.CharField(
                blank=True, default="", max_length=255,
                verbose_name="Название должности (kk)",
            ),
        ),
        migrations.AddField(
            model_name="rank",
            name="name_kk",
            field=models.CharField(
                blank=True, default="", max_length=255, verbose_name="Звание (kk)"
            ),
        ),
    ]
