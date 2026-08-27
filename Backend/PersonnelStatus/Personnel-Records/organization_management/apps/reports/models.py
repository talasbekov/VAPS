from django.db import models
from django.conf import settings

class Report(models.Model):
    """Модель отчета"""

    class ReportType(models.TextChoices):
        PERSONNEL_ROSTER = 'personnel_roster', 'Расход личного состава'
        DIVISION_REPORT = 'division_report', 'Отчет по подразделению'
        STAFFING_TABLE = 'staffing_table', 'Штатное расписание'
        STATUS_SUMMARY = 'status_summary', 'Сводка по статусам'

    class ReportFormat(models.TextChoices):
        DOCX = 'docx', 'Word документ'
        XLSX = 'xlsx', 'Excel таблица'
        PDF = 'pdf', 'PDF документ'

    class JobStatus(models.TextChoices):
        PENDING = 'pending', 'В очереди'
        PROCESSING = 'processing', 'Генерируется'
        COMPLETED = 'completed', 'Готов'
        FAILED = 'failed', 'Ошибка'

    report_type = models.CharField(max_length=50, choices=ReportType.choices, default=ReportType.PERSONNEL_ROSTER)
    report_format = models.CharField(max_length=10, choices=ReportFormat.choices, default=ReportFormat.PDF)

    # Параметры отчета
    division = models.ForeignKey(
        'divisions.Division',
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )
    date_from = models.DateField(null=True, blank=True)
    date_to = models.DateField(null=True, blank=True)
    filters = models.JSONField(default=dict, blank=True)

    # Результат
    job_id = models.CharField(max_length=100, unique=True, default='0')
    status = models.CharField(
        max_length=20,
        choices=JobStatus.choices,
        default=JobStatus.PENDING
    )
    file = models.FileField(upload_to='reports/', null=True, blank=True)
    error_message = models.TextField(blank=True)

    # Метаданные
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'reports'
        verbose_name = 'Отчёт'
        verbose_name_plural = 'Отчёты'
        # Порядок задаёт МОДЕЛЬ, а не вызывающий: список отчётов пагинируется,
        # а неупорядоченный queryset раскладывается по страницам как решит
        # планировщик — одна и та же запись может прийти дважды или не прийти
        # вовсе (Django об этом и предупреждал: UnorderedObjectListWarning).
        # `-id` вторым ключом обязателен: `created_at` — auto_now_add, и у
        # записей, созданных в одной транзакции, он совпадает до микросекунды.
        ordering = ['-created_at', '-id']
