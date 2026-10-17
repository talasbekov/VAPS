"""Restore the missing migration state from verified production schema (2026-09-24).

Production already records this exact migration name and has these columns.
It is not replayed there. Fresh installations receive the same schema.
No imported values are rewritten and nullable dates remain nullable.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('employees', '0004_employee_fired_requires_inactive')]

    operations = [
        migrations.AddField(
            model_name='employee', name='external_id',
            field=models.CharField(max_length=100, unique=True, null=True, blank=True),
        ),
        migrations.AlterField(
            model_name='employee', name='birth_date',
            field=models.DateField(default='1970-01-01', null=True, blank=True),
        ),
        migrations.AlterField(
            model_name='employee', name='hire_date',
            field=models.DateField(default='1970-01-01', null=True, blank=True),
        ),
        migrations.AlterField(
            model_name='employee', name='gender',
            field=models.CharField(max_length=1, choices=[('M', 'Мужской'), ('F', 'Женский')],
                                   default='M', null=True, blank=True),
        ),
    ]
