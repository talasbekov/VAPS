import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0001_facility"),
    ]

    operations = [
        migrations.CreateModel(
            name="FacilityPassport",
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
                (
                    "object_type",
                    models.CharField(blank=True, max_length=100, null=True),
                ),
                (
                    "responsible_user_id",
                    models.CharField(blank=True, max_length=100, null=True),
                ),
                ("responsible_employee_id", models.UUIDField(blank=True, null=True)),
                ("description", models.TextField(blank=True, default="")),
                ("security_notes", models.TextField(blank=True, default="")),
                (
                    "vulnerable_places",
                    models.TextField(
                        blank=True, default="", verbose_name="Проблемные места"
                    ),
                ),
                ("power_supply", models.TextField(blank=True, default="")),
                ("ventilation", models.TextField(blank=True, default="")),
                ("communication", models.TextField(blank=True, default="")),
                ("internet", models.TextField(blank=True, default="")),
                (
                    "nearby_high_buildings",
                    models.TextField(blank=True, default=""),
                ),
                ("public_zones", models.TextField(blank=True, default="")),
                ("crowd_places", models.TextField(blank=True, default="")),
                ("repair_works", models.TextField(blank=True, default="")),
                ("access_routes", models.JSONField(blank=True, default=list)),
                ("entrances", models.JSONField(blank=True, default=list)),
                ("exits", models.JSONField(blank=True, default=list)),
                (
                    "service_entrances",
                    models.JSONField(blank=True, default=list),
                ),
                ("parking_zones", models.JSONField(blank=True, default=list)),
                ("dropoff_zones", models.JSONField(blank=True, default=list)),
                ("elevators", models.JSONField(blank=True, default=list)),
                ("stairs", models.JSONField(blank=True, default=list)),
                ("roofs", models.JSONField(blank=True, default=list)),
                ("basements", models.JSONField(blank=True, default=list)),
                (
                    "technical_rooms",
                    models.JSONField(blank=True, default=list),
                ),
                ("cameras", models.JSONField(blank=True, default=list)),
                (
                    "completeness_status",
                    models.CharField(
                        choices=[
                            ("RED", "Red"),
                            ("YELLOW", "Yellow"),
                            ("GREEN", "Green"),
                        ],
                        default="RED",
                        max_length=50,
                    ),
                ),
                ("last_verified_at", models.DateTimeField(blank=True, null=True)),
                (
                    "last_verified_by",
                    models.CharField(blank=True, max_length=100, null=True),
                ),
                (
                    "facility",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="passport",
                        to="ops_facilities.facility",
                    ),
                ),
            ],
            options={
                "db_table": "ops_facility_passports",
            },
        ),
        migrations.AddConstraint(
            model_name="facilitypassport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("completeness_status__in", ["RED", "YELLOW", "GREEN"])
                ),
                name="chk_facility_passport_completeness",
            ),
        ),
    ]
