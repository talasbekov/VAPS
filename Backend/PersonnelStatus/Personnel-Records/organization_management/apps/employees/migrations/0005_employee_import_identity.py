from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0004_employee_fired_requires_inactive'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='external_id',
            field=models.CharField(blank=True, default=None, max_length=100, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name='employee',
            name='birth_date',
            field=models.DateField(blank=True, default='1970-01-01', null=True),
        ),
        migrations.AlterField(
            model_name='employee',
            name='hire_date',
            field=models.DateField(blank=True, default='1970-01-01', null=True),
        ),
        migrations.AlterField(
            model_name='employee',
            name='gender',
            field=models.CharField(
                blank=True, choices=[('M', 'Мужской'), ('F', 'Женский')],
                default='M', max_length=1, null=True,
            ),
        ),
    ]
