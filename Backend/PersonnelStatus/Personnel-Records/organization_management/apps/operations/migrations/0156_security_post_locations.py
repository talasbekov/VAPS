from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0155_combat_optional_event_lifecycle")]

    operations = [
        migrations.AddField(
            model_name="opssecuritypost", name="latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opssecuritypost", name="longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="opssecuritypost",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(latitude__isnull=True, longitude__isnull=True)
                    | models.Q(
                        latitude__isnull=False, longitude__isnull=False,
                        latitude__gte=-90, latitude__lte=90,
                        longitude__gte=-180, longitude__lte=180,
                    )
                ),
                name="chk_ops_post_location",
            ),
        ),
    ]
