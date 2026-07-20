import apps.operations.facilities.models.post
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0005_sector"),
    ]

    operations = [
        migrations.CreateModel(
            name="Post",
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
                ("code", models.CharField(max_length=50)),
                ("name", models.CharField(max_length=255)),
                ("max_service_minutes", models.IntegerField(default=480)),
                (
                    "requirements",
                    models.JSONField(
                        blank=True,
                        default=apps.operations.facilities.models.post._default_requirements,
                    ),
                ),
                ("tasks", models.TextField(blank=True, default="")),
                ("features", models.TextField(blank=True, default="")),
                ("location_description", models.TextField(blank=True, default="")),
                ("is_outdoor", models.BooleanField(blank=True, null=True)),
                ("max_continuous_minutes", models.IntegerField(blank=True, null=True)),
                (
                    "min_rating",
                    models.DecimalField(
                        blank=True, decimal_places=1, max_digits=3, null=True
                    ),
                ),
                ("requires_weapon", models.BooleanField(default=False)),
                ("requires_special_equipment", models.BooleanField(default=False)),
                ("requires_uniform", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "facility",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="posts",
                        to="ops_facilities.facility",
                    ),
                ),
                (
                    "post_type",
                    models.ForeignKey(
                        db_column="post_type_code",
                        default="FIXED",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="posts",
                        to="ops_facilities.posttype",
                    ),
                ),
                (
                    "sector",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="posts",
                        to="ops_facilities.sector",
                    ),
                ),
            ],
            options={
                "db_table": "ops_posts",
                "ordering": ["code", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.UniqueConstraint(
                models.F("facility"),
                django.db.models.functions.text.Lower("code"),
                condition=models.Q(('is_active', True)), name="uq_post_facility_code",
            ),
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.CheckConstraint(
                condition=models.Q(("code__regex", "\\S")),
                name="chk_post_code_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.CheckConstraint(
                condition=models.Q(("name__regex", "\\S")),
                name="chk_post_name_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("max_service_minutes__gte", 30), ("max_service_minutes__lte", 1440)
                ),
                name="chk_post_service_minutes_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("max_continuous_minutes__isnull", True),
                    ("max_continuous_minutes__gt", 0),
                    _connector="OR",
                ),
                name="chk_post_continuous_minutes_min",
            ),
        ),
        migrations.AddConstraint(
            model_name="post",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("min_rating__isnull", True),
                    ("min_rating__gte", 0),
                    _connector="OR",
                ),
                name="chk_post_min_rating_min",
            ),
        ),
    ]
