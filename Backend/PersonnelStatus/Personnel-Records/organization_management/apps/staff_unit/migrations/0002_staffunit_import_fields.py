"""Restore import fields already present in the closed-network database.

The recorded migration name is retained. Existing installations do not execute
this migration again; new installations get the same columns and constraints.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('staff_unit', '0001_initial')]

    operations = [
        migrations.AddField(
            model_name='staffunit', name='external_id',
            field=models.CharField(max_length=100, unique=True, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='staffunit', name='import_order',
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='staffunit', name='position_category',
            field=models.CharField(max_length=100, blank=True, default=''),
        ),
    ]
