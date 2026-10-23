import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0145_personnel_duty_execution")]
    operations = [
        migrations.CreateModel(
            name="OpsAssistantTask",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("initiated_by", models.CharField(max_length=100)),
                ("request_key", models.CharField(max_length=80)),
                ("request_hash", models.CharField(max_length=64)),
                ("message", models.TextField()),
                ("plan", models.JSONField(default=dict)),
                ("status", models.CharField(default="needs_information", max_length=40)),
                ("delegated", models.BooleanField(default=False)),
                ("revision", models.PositiveIntegerField(default=1)),
                ("event", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assistant_tasks", to="operations.opssecurityevent")),
            ],
            options={"db_table": "ops_assistant_tasks", "verbose_name": "Поручение помощнику по ОМ", "verbose_name_plural": "Поручения помощнику по ОМ", "indexes": [models.Index(fields=["initiated_by", "-updated_at"], name="idx_om_assistant_owner")], "constraints": [models.UniqueConstraint(fields=("initiated_by", "request_key"), name="uniq_om_assistant_request")]},
        ),
        migrations.CreateModel(
            name="OpsAssistantReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("operation_key", models.CharField(max_length=80)),
                ("payload_hash", models.CharField(max_length=64)),
                ("executed_by", models.CharField(max_length=100)),
                ("result", models.JSONField(default=dict)),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="receipts", to="operations.opsassistanttask")),
            ],
            options={"db_table": "ops_assistant_receipts", "verbose_name": "Выполненное действие помощника по ОМ", "verbose_name_plural": "Выполненные действия помощника по ОМ", "constraints": [models.UniqueConstraint(fields=("task", "operation_key"), name="uniq_om_assistant_operation")]},
        ),
    ]
