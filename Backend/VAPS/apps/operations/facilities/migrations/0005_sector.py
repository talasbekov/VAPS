import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0004_post_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="Sector",
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
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("name", models.CharField(max_length=255)),
                ("sort_order", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "facility",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sectors",
                        to="ops_facilities.facility",
                    ),
                ),
            ],
            options={
                "db_table": "ops_sectors",
                "ordering": ["sort_order", "name", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="sector",
            constraint=models.UniqueConstraint(
                models.F("facility"),
                django.db.models.functions.text.Lower("name"),
                condition=models.Q(('is_active', True)), name="uq_sector_facility_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="sector",
            constraint=models.CheckConstraint(
                condition=models.Q(("name__regex", "\\S")),
                name="chk_sector_name_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="sector",
            constraint=models.CheckConstraint(
                condition=models.Q(("sort_order__gte", 0)),
                name="chk_sector_sort_order_min",
            ),
        ),
    ]
