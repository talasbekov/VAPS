"""Administrator-owned singleton; never initialized by reads or migrations."""
import uuid

from django.db import models


class OpsAssistantConnection(models.Model):
    admin_readonly = True
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    provider = models.CharField(max_length=16, choices=[("disabled", "Отключено"), ("openai", "OpenAI API"), ("ollama", "Ollama")], default="disabled")
    base_url = models.CharField(max_length=1000, blank=True, default="")
    model = models.CharField(max_length=200, blank=True, default="")
    api_key = models.TextField(blank=True, default="", editable=False)
    api_key_format = models.CharField(max_length=16, choices=[("plain", "Прежнее хранение"), ("fernet-v1", "Зашифровано")], default="plain", editable=False)
    revision = models.CharField(max_length=36, default=uuid.uuid4, editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = "ops_assistant_connection"
        verbose_name = "Подключение Smart AI"
        verbose_name_plural = "Подключение Smart AI"
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="chk_assistant_connection_singleton")]
