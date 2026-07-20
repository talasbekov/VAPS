import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ops_facilities", "0007_checklist_template"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChecklistItem",
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
                ("text", models.TextField()),
                ("category", models.CharField(blank=True, max_length=100, null=True)),
                ("is_required", models.BooleanField(default=True)),
                ("sort_order", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="ops_facilities.checklisttemplate",
                    ),
                ),
            ],
            options={
                "db_table": "ops_checklist_items",
                "ordering": ["sort_order", "id"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("text__regex", "\\S")),
                        name="chk_checklist_item_text_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("category__isnull", True),
                            ("category__regex", "\\S"),
                            _connector="OR",
                        ),
                        name="chk_checklist_item_category_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("sort_order__gte", 0)),
                        name="chk_checklist_item_sort_order_min",
                    ),
                ],
            },
        ),
    ]
