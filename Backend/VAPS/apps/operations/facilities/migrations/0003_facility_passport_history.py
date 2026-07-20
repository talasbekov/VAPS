import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0002_facility_passport"),
    ]

    operations = [
        migrations.CreateModel(
            name="FacilityPassportHistory",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("changed_by", models.CharField(max_length=100)),
                ("changed_at", models.DateTimeField()),
                ("old_value", models.JSONField(blank=True, null=True)),
                ("new_value", models.JSONField()),
                ("reason", models.TextField(blank=True, default="")),
                (
                    "passport",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="history",
                        to="ops_facilities.facilitypassport",
                    ),
                ),
            ],
            options={
                "db_table": "ops_facility_passport_history",
                "ordering": ["-changed_at"],
            },
        ),
    ]
