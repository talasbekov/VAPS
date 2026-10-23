from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('employees', '0007_employee_service_profile')]

    operations = [
        migrations.AlterModelOptions(
            name='employeeserviceprofile',
            options={
                'verbose_name': 'Служебный профиль сотрудника',
                'verbose_name_plural': 'Служебные профили сотрудников',
            },
        ),
    ]
