"""Раскладка моделей Django Admin по категориям (Plane №210).

ОДИН РЕЕСТР НА ВЕСЬ ПРОЕКТ. Категория задаётся здесь, а не флагом у каждого
`ModelAdmin`: раскладку надо видеть целиком одним экраном, иначе «Справочники»
медленно наполняются всем подряд, и никто этого не замечает.

ДВА УРОВНЯ ПРАВИЛ, и порядок между ними важен:

1. **Исключение по модели** (`MODEL_CATEGORY`) — «эта модель живёт в разделе
   ОМ, но по смыслу справочник».
2. **Правило по приложению** (`APP_CATEGORY`) — куда уходит всё остальное из
   этого приложения.

Модель, не покрытая ни одним правилом, уезжает в «Прочее» и ВИДНА там. Прятать
её нельзя: ровно из-за невидимых моделей заказчик и попросил показать в Admin
всё (Plane №182).
"""
from __future__ import annotations

# Порядок объявления = порядок на экране. Сверху то, к чему ходят чаще.
CATEGORIES = (
    "Справочники",
    "Структура и штат",
    "Сотрудники и статусы",
    "Охранные мероприятия",
    "Документы и отчёты",
    "Доступ и журналы",
    "Настройки раздела",
    "Фоновые задачи",
)

OTHER_CATEGORY = "Прочее"

# Правило по приложению: куда уходит всё, для чего нет исключения.
APP_CATEGORY = {
    "dictionaries": "Справочники",
    "divisions": "Структура и штат",
    "staff_unit": "Структура и штат",
    "employees": "Сотрудники и статусы",
    "statuses": "Сотрудники и статусы",
    "secondments": "Сотрудники и статусы",
    "operations": "Охранные мероприятия",
    "reports": "Документы и отчёты",
    "documents": "Документы и отчёты",
    "audit": "Доступ и журналы",
    "common": "Доступ и журналы",
    "notifications": "Доступ и журналы",
    "auth": "Доступ и журналы",
}

# Правило по приложению для стороннего кода: расписание и результаты задач —
# это инфраструктура, а не предметная область.
APP_CATEGORY.update(
    {
        "django_celery_beat": "Фоновые задачи",
        "django_celery_results": "Фоновые задачи",
    }
)


def _spread(category: str, app_label: str, *models: str) -> dict[str, str]:
    return {f"{app_label}.{name}": category for name in models}


# Исключения по модели. Нужны в основном разделу ОМ: у него 67 моделей в одном
# приложении, и одной кучей это тот же список, только под другим заголовком.
MODEL_CATEGORY: dict[str, str] = {
    # Справочники раздела: их наполняют сидом и по ним строят выпадающие списки.
    **_spread(
        "Справочники", "operations",
        "OpsDictionaryEntry", "StatusType", "OpsDutyType", "OpsCombatDutyType",
        "OpsCombatRoute", "OpsServiceReportType", "OpsFeedbackRegistry",
        "OpsAnalyticsMetricDefinition", "OpsAnalyticsPeriodPreset",
        "OpsAttentionDetector", "OpsLegalDocument", "OpsVehicle",
    ),
    # Настройки и политики: меняются редко, действуют на весь раздел.
    **_spread(
        "Настройки раздела", "operations",
        "OpsPolicySetting", "OpsPolicySectionVersion", "OpsSettingChangeEvent",
        "OpsSubmissionControlSettings", "OpsPassportFreshnessPolicy",
        "OpsDutyConflictPolicy", "OpsRatingFeatureFlags", "OpsDocumentSequence",
        "OpsDivisionNotifyRecipient",
    ),
    # Всё, что порождает файл или его хранит.
    **_spread(
        "Документы и отчёты", "operations",
        "OpsIssuedDocument", "OpsAttachment", "OpsServiceReportJob",
        "OpsServiceReportArtifact", "OpsRatingExportJob", "OpsRatingExportArtifact",
        "OpsWatermark",
    ),
    # Права, роли и журналы раздела — рядом с такими же портала.
    **_spread(
        "Доступ и журналы", "operations",
        "Permission", "Role", "RolePermission", "UserRole",
        "TemporaryDutyPermission", "OpsAuditLog", "OpsRatingAuditEntry",
        "OpsNotification", "OpsRatingNotification",
    ),
    # Состояния людей: они про сотрудника, а не про мероприятие.
    **_spread(
        "Сотрудники и статусы", "operations",
        "OpsEmployeeStatus", "Secondment", "StatusOverride", "OpsProtectedPerson",
    ),
}


def category_of(app_label: str, object_name: str) -> str:
    """Категория модели: сперва исключение, затем правило приложения."""
    key = f"{app_label}.{object_name}"
    if key in MODEL_CATEGORY:
        return MODEL_CATEGORY[key]
    return APP_CATEGORY.get(app_label, OTHER_CATEGORY)
