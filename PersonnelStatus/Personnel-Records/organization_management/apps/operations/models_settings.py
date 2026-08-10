"""Настройки раздела ОМ и generic-справочники.

Настройка — хранимая строка с границами и редактируемостью КАК СВОЙСТВАМИ
правила (жёсткий запрет пересечения нельзя ослабить никому); разделы
версионируются порознь, версия меняется при каждом принятом изменении.
Журнал изменений — append-only, несёт ГОТОВЫЕ подписи значений (форматирует
владелец вариантов — сервер) и версию политики ПОСЛЕ изменения.

Справочник — реестр «код → значение»; закрытый мир кодов справочников живёт
в сервисе (apps/ops/dictionaries.py), не в таблице: набор справочников —
решение кода, состав значений — данные.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

_SECTIONS = (
    "CONFLICT_RULES",
    "PASSPORT_FRESHNESS",
    "RATING_POLICY",
    "ANALYTICS_LIMITS",
    "LOAD_POLICY",
    "ATTENTION_POLICY",
    "REPORT_LIMITS",
)
_KINDS = ("NUMBER", "CHOICE")
_DICTIONARIES = (
    "RETURN_REASONS",
    "POST_REQUIREMENTS",
    "SEASONAL_CORRECTIONS",
    "JOURNAL_ENTRY_TYPES",
    "POST_REQUIREMENT_GROUPS",
)


class OpsPolicySetting(TimeStampedModel):
    setting_code = models.CharField(max_length=100, unique=True)
    section_code = models.CharField(max_length=50)
    kind = models.CharField(max_length=20)
    value_type = models.CharField(max_length=20)
    safe_label = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # Число или строка режима — JSON, форму значения задаёт kind.
    value = models.JSONField()
    min_value = models.IntegerField(null=True)
    max_value = models.IntegerField(null=True)
    options = models.JSONField(null=True)
    editable = models.BooleanField()
    locked_reason = models.TextField(null=True)
    updated_by = models.CharField(max_length=255, null=True)
    value_updated_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "ops_policy_settings"
        verbose_name = "Настройка раздела ОМ"
        verbose_name_plural = "Настройки раздела ОМ"
        ordering = ["section_code", "setting_code", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(section_code__in=_SECTIONS),
                name="chk_ops_setting_section",
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=_KINDS),
                name="chk_ops_setting_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(setting_code__regex=r"\S"),
                name="chk_ops_setting_code",
            ),
        ]

    def __str__(self):
        return self.setting_code


class OpsPolicySectionVersion(TimeStampedModel):
    section_code = models.CharField(max_length=50, unique=True)
    version = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_policy_section_versions"
        verbose_name = "Версия раздела настроек"
        verbose_name_plural = "Версии разделов настроек"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(section_code__in=_SECTIONS),
                name="chk_ops_section_version_code",
            ),
            models.CheckConstraint(
                condition=models.Q(version__regex=r"\S"),
                name="chk_ops_section_version_value",
            ),
        ]

    def __str__(self):
        return f"{self.section_code} {self.version}"


class OpsSettingChangeEvent(TimeStampedModel):
    setting_code = models.CharField(max_length=100)
    section_code = models.CharField(max_length=50)
    safe_label = models.CharField(max_length=255)
    old_value = models.CharField(max_length=255)
    new_value = models.CharField(max_length=255)
    reason = models.TextField()
    actor_user_id = models.CharField(max_length=255)
    policy_version_after = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_setting_change_events"
        verbose_name = "Изменение настройки"
        verbose_name_plural = "Изменения настроек"
        # Журнал читается свежими сверху и только дополняется.
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.setting_code} → {self.new_value}"


class OpsDictionaryEntry(TimeStampedModel):
    dictionary_code = models.CharField(max_length=50)
    code = models.CharField(max_length=100)
    label = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField()
    # Только для POST_REQUIREMENTS — код записи POST_REQUIREMENT_GROUPS.
    group_code = models.CharField(max_length=100, null=True)
    updated_by = models.CharField(max_length=255, null=True)

    class Meta:
        db_table = "ops_dictionary_entries"
        verbose_name = "Значение справочника ОМ"
        verbose_name_plural = "Значения справочников ОМ"
        ordering = ["dictionary_code", "code", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["dictionary_code", "code"],
                name="uniq_ops_dictionary_entry_code",
            ),
            models.CheckConstraint(
                condition=models.Q(dictionary_code__in=_DICTIONARIES),
                name="chk_ops_dictionary_code",
            ),
            models.CheckConstraint(
                condition=models.Q(code__regex=r"\S"),
                name="chk_ops_dictionary_entry_value_code",
            ),
        ]

    def __str__(self):
        return f"{self.dictionary_code}/{self.code}"
