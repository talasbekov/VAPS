from django.db import migrations, models


def deactivate_fired_employees(apps, schema_editor):
    Employee = apps.get_model('employees', 'Employee')
    Employee.objects.filter(employment_status='fired', is_active=True).update(
        is_active=False
    )


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0003_employee_callsign'),
    ]

    operations = [
        migrations.RunPython(deactivate_fired_employees, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='employee',
            constraint=models.CheckConstraint(
                condition=(
                    ~models.Q(employment_status='fired') | models.Q(is_active=False)
                ),
                name='employee_fired_requires_inactive',
            ),
        ),
    ]
