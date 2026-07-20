from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Facility",
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
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.CharField(blank=True, max_length=100, null=True),
                ),
                ("code", models.CharField(max_length=50)),
                ("name", models.CharField(max_length=255)),
                ("address", models.TextField()),
                (
                    "latitude",
                    models.DecimalField(
                        blank=True, decimal_places=6, max_digits=9, null=True
                    ),
                ),
                (
                    "longitude",
                    models.DecimalField(
                        blank=True, decimal_places=6, max_digits=9, null=True
                    ),
                ),
                (
                    "importance_level_code",
                    models.CharField(blank=True, max_length=50, null=True),
                ),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "ops_facilities",
                "ordering": ["name", "id"],
                "constraints": [
                    models.UniqueConstraint(
                        Lower("code"), name="uq_facility_code"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("code__regex", "\\S")),
                        name="chk_facility_code_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name__regex", "\\S")),
                        name="chk_facility_name_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("address__regex", "\\S")),
                        name="chk_facility_address_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("latitude__isnull", True),
                            models.Q(
                                ("latitude__gte", -90), ("latitude__lte", 90)
                            ),
                            _connector="OR",
                        ),
                        name="chk_facility_lat_range",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("longitude__isnull", True),
                            models.Q(
                                ("longitude__gte", -180),
                                ("longitude__lte", 180),
                            ),
                            _connector="OR",
                        ),
                        name="chk_facility_lon_range",
                    ),
                ],
            },
        ),
    ]
