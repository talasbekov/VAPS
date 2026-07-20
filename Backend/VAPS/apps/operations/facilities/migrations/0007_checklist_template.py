from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0006_post"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChecklistTemplate",
            fields=[
                (
                    "code",
                    models.CharField(max_length=100, primary_key=True, serialize=False),
                ),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "ops_checklist_templates",
                "ordering": ["code"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("code__regex", "\\S")),
                        name="chk_checklist_template_code_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name__regex", "\\S")),
                        name="chk_checklist_template_name_not_blank",
                    ),
                ],
            },
        ),
    ]
