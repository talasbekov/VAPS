"""Реестры аналитики службы (§22) — порт мок-фикстур клиента.

В таблицах лежат ОПРЕДЕЛЕНИЯ, а не числа: сами показатели считаются на
запросе из живых смен. Пороги и пресеты живут в данных, потому что §22.5
прямо запрещает хардкодить «последние 7 дней» и «порог перегрузки» в коде.

Политика наблюдений (§22.11) разделена на две части: МЕТОДИКА (мера, текст,
маршрут) — здесь, в определении детектора; администрируемые ЧИСЛА (допуски и
пороги) — в разделе «Настройки» (ATTENTION_POLICY), откуда они накладываются
на определения при каждом запросе.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

_METRIC_UNITS = ("COUNT", "PERCENT", "MINUTES", "HOURS")
_MEASURES = (
    "ACKNOWLEDGEMENT_MISSING",
    "CONFLICT_SHARE",
    "UNFINISHED_OVERDUE",
    "UNCONFIRMED_OVERDUE",
    "SOURCE_AGE",
)
_TITLE_CODES = (
    "VERIFICATION_REQUIRED",
    "DATA_UNCONFIRMED",
    "THRESHOLD_EXCEEDED",
    "UNFINISHED_PROCESSES",
    "SOURCE_NOT_UPDATED",
)
_SEVERITIES = ("CRITICAL", "WARNING", "INFO")


class OpsAnalyticsMetricDefinition(TimeStampedModel):
    """Показатель §22.7. Пороги NULL — справочный показатель без тревоги:
    выдуманный порог сделал бы обычную работу службы «предупреждением»."""

    metric_code = models.CharField(max_length=100, unique=True)
    safe_label = models.CharField(max_length=255)
    unit = models.CharField(max_length=20)
    warning_from = models.IntegerField(null=True)
    critical_from = models.IntegerField(null=True)
    drilldown_available = models.BooleanField()
    position = models.IntegerField()

    class Meta:
        db_table = "ops_analytics_metric_definitions"
        verbose_name = "Показатель аналитики службы"
        verbose_name_plural = "Показатели аналитики службы"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(unit__in=_METRIC_UNITS),
                name="chk_ops_metric_unit",
            ),
        ]

    def __str__(self):
        return self.metric_code


class OpsAnalyticsPeriodPreset(TimeStampedModel):
    """Пресет периода §22.5. «Произвольный период» пресетом НЕ является: у
    него нет своей глубины, он задаётся датами и проверяется сервером."""

    preset_code = models.CharField(max_length=50, unique=True)
    safe_label = models.CharField(max_length=255)
    offset_days = models.IntegerField()
    length_days = models.IntegerField()
    position = models.IntegerField()

    class Meta:
        db_table = "ops_analytics_period_presets"
        verbose_name = "Пресет периода аналитики"
        verbose_name_plural = "Пресеты периодов аналитики"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(length_days__gte=1),
                name="chk_ops_preset_length_floor",
            ),
        ]

    def __str__(self):
        return self.preset_code


class OpsAttentionDetector(TimeStampedModel):
    """Методика детектора §22.11. Числа (parameter/warning/critical) здесь —
    значения ПО УМОЛЧАНИЮ: администрируемые лежат в «Настройках» и
    накладываются поверх при запросе."""

    category_code = models.CharField(max_length=100, unique=True)
    measure = models.CharField(max_length=50)
    title_code = models.CharField(max_length=50)
    safe_description_template = models.TextField()
    parameter = models.IntegerField()
    warning_from = models.IntegerField(null=True)
    critical_from = models.IntegerField(null=True)
    base_severity = models.CharField(max_length=20)
    target_route = models.CharField(max_length=255, null=True)
    target_permission = models.CharField(max_length=100, null=True)
    position = models.IntegerField()

    class Meta:
        db_table = "ops_attention_detectors"
        verbose_name = "Детектор внимания"
        verbose_name_plural = "Детекторы внимания"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(measure__in=_MEASURES),
                name="chk_ops_detector_measure",
            ),
            models.CheckConstraint(
                condition=models.Q(title_code__in=_TITLE_CODES),
                name="chk_ops_detector_title",
            ),
            models.CheckConstraint(
                condition=models.Q(base_severity__in=_SEVERITIES),
                name="chk_ops_detector_severity",
            ),
        ]

    def __str__(self):
        return self.category_code
