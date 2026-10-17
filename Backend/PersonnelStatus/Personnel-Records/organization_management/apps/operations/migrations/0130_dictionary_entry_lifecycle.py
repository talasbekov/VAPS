"""Жизненный цикл значения справочника (UC-REF-001, подпроект 2): дата
неактуальности и ссылка на прежнюю запись при замене."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0129_dictionary_manage_permission_name")]

    operations = [
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="inactive_since",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="supersedes",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="superseded_by",
                to="operations.opsdictionaryentry",
            ),
        ),
    ]
