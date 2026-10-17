"""Казахское наименование у значений справочников раздела ОМ (UC-REF-001).

Необязательное: существующие данные и сиды перевода не имеют, пустая строка
означает «перевода нет». Уникальности нет — уникален код.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0127_dictionary_value_manage_permission")]

    operations = [
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="label_kk",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
