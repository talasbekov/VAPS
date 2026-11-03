"""Local AI schema only; original tasks and connection fallback remain intact."""
import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0148_object_map_locations")]
    operations = [
        migrations.CreateModel(
            name='OpsAssistantConnection',
            fields=[
                ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ('provider', models.CharField(choices=[('disabled', 'Отключено'), ('openai', 'OpenAI API'), ('ollama', 'Ollama')], default='disabled', max_length=16)),
                ('base_url', models.CharField(blank=True, default='', max_length=1000)),
                ('model', models.CharField(blank=True, default='', max_length=200)),
                ('api_key', models.TextField(blank=True, default='', editable=False)),
                ('revision', models.CharField(default=uuid.uuid4, editable=False, max_length=36)),
                ('api_key_format', models.CharField(choices=[('plain', 'Прежнее хранение'), ('fernet-v1', 'Зашифровано')], default='plain', editable=False, max_length=16)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.CharField(blank=True, default='', max_length=100)),
            ],
            options={'db_table': 'ops_assistant_connection', 'verbose_name': 'Подключение Smart AI', 'verbose_name_plural': 'Подключение Smart AI', 'constraints': [models.CheckConstraint(condition=models.Q(id=1), name='chk_assistant_connection_singleton')]},
        ),
        migrations.AddField(
            model_name='opsassistanttask',
            name='processing',
            field=models.JSONField(default=dict),
        ),
        migrations.CreateModel(
            name='OpsAssistantMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.CharField(blank=True, max_length=100, null=True)),
                ('role', models.CharField(max_length=12)),
                ('text', models.TextField()),
                ('request_key', models.CharField(blank=True, max_length=80, null=True)),
                ('payload_hash', models.CharField(blank=True, max_length=64)),
                ('retries', models.JSONField(default=dict)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='operations.opsassistanttask')),
            ],
            options={'db_table': 'ops_assistant_messages', 'verbose_name': 'Сообщение помощнику по ОМ', 'verbose_name_plural': 'Сообщения помощнику по ОМ', 'ordering': ['id'], 'constraints': [models.UniqueConstraint(fields=('task', 'request_key'), name='uniq_om_assistant_message')]},
        ),
    ]
