from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0003_facility_passport_history"),
    ]

    operations = [
        migrations.CreateModel(
            name="PostType",
            fields=[
                (
                    "code",
                    models.CharField(max_length=50, primary_key=True, serialize=False),
                ),
                ("name", models.CharField(max_length=255)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "ops_post_types",
                "ordering": ["code"],
            },
        ),
    ]
