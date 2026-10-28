import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0151_object_inspections")]
    operations = [
        migrations.AddField(model_name="opsassistanttask", name="processing", field=models.JSONField(default=dict)),
        migrations.CreateModel(
            name="OpsAssistantMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("role", models.CharField(max_length=12)),
                ("text", models.TextField()),
                ("request_key", models.CharField(blank=True, max_length=80, null=True)),
                ("payload_hash", models.CharField(blank=True, max_length=64)),
                ("retries", models.JSONField(default=dict)),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="operations.opsassistanttask")),
            ],
            options={"db_table": "ops_assistant_messages", "verbose_name": "Сообщение помощнику по ОМ", "verbose_name_plural": "Сообщения помощнику по ОМ", "ordering": ["id"], "constraints": [models.UniqueConstraint(fields=("task", "request_key"), name="uniq_om_assistant_message")]},
        ),
    ]
