import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0152_assistant_dialogue")]
    operations = [
        migrations.CreateModel(
            name="OpsAssistantConnectionCheck",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("checked_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("succeeded", models.BooleanField()),
                ("provider", models.CharField(max_length=16)),
                ("model", models.CharField(blank=True, default="", max_length=200)),
                ("checked_saved_revision", models.CharField(blank=True, max_length=36, null=True)),
            ],
            options={"db_table": "ops_assistant_connection_checks", "verbose_name": "Проверка подключения Smart AI",
                     "verbose_name_plural": "Проверки подключения Smart AI", "ordering": ["-checked_at", "-id"],
                     "indexes": [models.Index(fields=["-checked_at", "-id"], name="idx_ai_connection_check_time")]},
        ),
    ]
