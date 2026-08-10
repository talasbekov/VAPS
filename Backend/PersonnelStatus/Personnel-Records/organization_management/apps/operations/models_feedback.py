"""Обратная связь (§28) — порт мок-контракта клиента.

Обращение хранит и содержание (описание, шаги, контакт, вложения-МЕТАДАННЫЕ,
техническая информация по согласию), и решения службы (статус, рабочий
приоритет, ответственный). Наружу уходит ПРОЕКЦИЯ: содержание чужого
конфиденциального обращения вырезается на сервере, а не прячется вёрсткой.

Справочник (типы, приоритеты, статусы, модули, КАРТА ПЕРЕХОДОВ) — в данных,
синглтоном: порядок разбора принадлежит службе поддержки, а не коду экрана
и не коду вьюхи.

Лента событий — append-only и ОДНА на timeline и audit: два журнала об одних
событиях рано или поздно разошлись бы. Пишет её единственная точка-дифф в
сервисе (apps/ops/feedback.py) — операции о ленте не знают.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsFeedbackRegistry(TimeStampedModel):
    """Справочник §28 целиком, одной строкой. Подписи и порядок — данные;
    из терминальных статусов переходов нет вовсе — это и есть замок."""

    singleton_key = models.PositiveSmallIntegerField(unique=True, default=1)
    version = models.CharField(max_length=100)
    types = models.JSONField()
    priorities = models.JSONField()
    statuses = models.JSONField()
    modules = models.JSONField()
    status_transitions = models.JSONField()
    terminal_statuses = models.JSONField()

    class Meta:
        db_table = "ops_feedback_registry"
        verbose_name = "Справочник обратной связи"
        verbose_name_plural = "Справочник обратной связи"

    def __str__(self):
        return self.version


class OpsFeedbackRequest(TimeStampedModel):
    """Обращение. Автор и ответственный — денормализованные (user_id RBAC +
    безопасная подпись): раздел ОМ кадры не ведёт, а сеяные demo-персоны
    живой учётки не имеют вовсе."""

    subject = models.CharField(max_length=160)
    description = models.TextField()
    type_code = models.CharField(max_length=30)
    priority_code = models.CharField(max_length=20)
    status_code = models.CharField(max_length=20)
    module_code = models.CharField(max_length=50)
    expected_result = models.TextField(null=True)
    reproduction_steps = models.TextField(null=True)
    # §28 «attachment metadata»: РОВНО [{fileName, sizeBytes, mimeType}] —
    # blob-хранилища нет, содержимое файла не читается вообще.
    attachments = models.JSONField(default=list)
    contact = models.CharField(max_length=255, null=True)
    confidential = models.BooleanField()
    related_route = models.CharField(max_length=255, null=True)
    # null — «не собирали» (согласия не было), а не пустой объект.
    technical_info = models.JSONField(null=True)
    # null до разбора: приравнять к заявленному значило бы утверждать, что
    # обращение уже оценили.
    working_priority_code = models.CharField(max_length=20, null=True)
    assignee_user_id = models.CharField(max_length=255, null=True)
    assignee_label = models.CharField(max_length=255, null=True)
    duplicate_of = models.ForeignKey(
        "self", null=True, on_delete=models.SET_NULL, related_name="duplicates"
    )
    author_user_id = models.CharField(max_length=255)
    author_label = models.CharField(max_length=255)
    submitted_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "ops_feedback_requests"
        verbose_name = "Обращение обратной связи"
        verbose_name_plural = "Обращения обратной связи"
        # Порядок реестра задаёт сервер: недавние сверху, tie-breaker по id —
        # без него две записи одной секунды «съезжали» бы между страницами.
        ordering = ["-created_at", "id"]

    def __str__(self):
        return f"{self.pk}: {self.subject}"


class OpsFeedbackComment(TimeStampedModel):
    """Комментарий. Два ВИДА (PUBLIC_REPLY | INTERNAL_NOTE), а не флаг
    «приватный»: разные читатели, разные права на запись и разная судьба в
    ленте — внутренняя заметка не попадает в ответ автору ВООБЩЕ."""

    request = models.ForeignKey(
        OpsFeedbackRequest, on_delete=models.CASCADE, related_name="comments"
    )
    kind = models.CharField(max_length=20)
    body = models.TextField()
    author_user_id = models.CharField(max_length=255)
    author_label = models.CharField(max_length=255)

    class Meta:
        db_table = "ops_feedback_comments"
        verbose_name = "Комментарий обращения"
        verbose_name_plural = "Комментарии обращений"
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.request_id}/{self.kind}"


class OpsFeedbackEvent(TimeStampedModel):
    """Событие ленты (timeline + audit одной записью): вид для человека,
    old/new — для аудита. Append-only: событий не правят и не удаляют."""

    request = models.ForeignKey(
        OpsFeedbackRequest, on_delete=models.CASCADE, related_name="events"
    )
    kind = models.CharField(max_length=40)
    actor_user_id = models.CharField(max_length=255)
    actor_label = models.CharField(max_length=255)
    at = models.DateTimeField()
    field_code = models.CharField(max_length=50, null=True)
    old_value = models.TextField(null=True)
    new_value = models.TextField(null=True)

    class Meta:
        db_table = "ops_feedback_events"
        verbose_name = "Событие обращения"
        verbose_name_plural = "События обращений"
        # Явные события операции (комментарий) идут раньше диффов того же
        # момента — id сохраняет порядок записи внутри одной секунды.
        ordering = ["at", "id"]

    def __str__(self):
        return f"{self.request_id}/{self.kind}"
