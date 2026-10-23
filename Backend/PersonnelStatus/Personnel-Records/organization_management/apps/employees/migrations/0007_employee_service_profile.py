from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('employees', '0006_iin_format_validation')]

    operations = [
        migrations.CreateModel(
            name='EmployeeServiceProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('data', models.JSONField(default=dict)),
                ('revision', models.PositiveIntegerField(default=1)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('employee', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='service_profile', to='employees.employee',
                )),
            ],
            options={'db_table': 'employee_service_profiles'},
        ),
    ]
