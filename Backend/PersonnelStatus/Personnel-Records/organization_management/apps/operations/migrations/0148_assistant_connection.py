import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0147_resource_calculation")]
    operations = [migrations.CreateModel(
        name="OpsAssistantConnection",
        fields=[
            ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
            ("provider", models.CharField(choices=[("disabled", "Отключено"), ("openai", "OpenAI API"), ("ollama", "Ollama")], default="disabled", max_length=16)),
            ("base_url", models.CharField(blank=True, default="", max_length=1000)),
            ("model", models.CharField(blank=True, default="", max_length=200)),
            ("api_key", models.TextField(blank=True, default="", editable=False)),
            ("revision", models.CharField(default=uuid.uuid4, editable=False, max_length=36)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("updated_by", models.CharField(blank=True, default="", max_length=100)),
        ],
        options={"db_table": "ops_assistant_connection", "verbose_name": "Подключение Smart AI", "verbose_name_plural": "Подключение Smart AI",
                 "constraints": [models.CheckConstraint(condition=models.Q(id=1), name="chk_assistant_connection_singleton")]},
    )]
