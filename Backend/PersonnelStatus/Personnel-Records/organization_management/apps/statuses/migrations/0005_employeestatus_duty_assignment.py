from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("statuses", "0004_alter_employeestatus_status_type")]

    operations = [migrations.AddField(
        model_name="employeestatus", name="duty_assignment",
        field=models.JSONField(blank=True, null=True, verbose_name="Наряд"),
    )]
