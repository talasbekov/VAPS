from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0147_resource_calculation")]

    operations = [
        migrations.AddField(
            model_name="opssecurityobject", name="latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opssecurityobject", name="longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opspassportversion", name="latitude_snapshot",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opspassportversion", name="longitude_snapshot",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="opssecurityobject",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(latitude__isnull=True, longitude__isnull=True)
                    | models.Q(
                        latitude__isnull=False, longitude__isnull=False,
                        latitude__gte=-90, latitude__lte=90,
                        longitude__gte=-180, longitude__lte=180,
                    )
                ),
                name="chk_ops_object_location",
            ),
        ),
        migrations.AddConstraint(
            model_name="opspassportversion",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(latitude_snapshot__isnull=True, longitude_snapshot__isnull=True)
                    | models.Q(
                        latitude_snapshot__isnull=False, longitude_snapshot__isnull=False,
                        latitude_snapshot__gte=-90, latitude_snapshot__lte=90,
                        longitude_snapshot__gte=-180, longitude_snapshot__lte=180,
                    )
                ),
                name="chk_ops_passport_location",
            ),
        ),
    ]
