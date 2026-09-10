"""Раскладка моделей Django Admin по категориям (Plane №210).

ОДИН РЕЕСТР НА ВЕСЬ ПРОЕКТ. Категория задаётся здесь, а не флагом у каждого
`ModelAdmin`: раскладку надо видеть целиком одним экраном, иначе «Справочники»
медленно наполняются всем подряд, и никто этого не замечает.

ДВА УРОВНЯ ПРАВИЛ, и порядок между ними важен:

1. **Исключение по модели** (`MODEL_CATEGORY`) — «эта модель живёт в разделе
   ОМ, но по смыслу справочник».
2. **Правило по приложению** (`APP_CATEGORY`) — куда уходит всё остальное из
   этого приложения.

Модель, не покрытая ни одним правилом, уезжает в «Прочее»: это страховка от
ошибки раскладки. После явных allowlist №1140 эта категория должна быть пустой.
"""
from __future__ import annotations

# Порядок объявления = порядок на экране. Сверху то, к чему ходят чаще.
CATEGORIES = (
    "Доступ",
    "Структура и штат",
    "Сотрудники и статусы",
    "Справочники",
    "Охранные мероприятия",
    "Сбор сил и расход",
    "Обратная связь",
    "Документы и отчёты",
    "Служебное",
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
    "audit": "Служебное",
    "common": "Доступ",
    "notifications": "Служебное",
    "auth": "Доступ",
}

# Правило по приложению для стороннего кода: расписание и результаты задач —
# это инфраструктура, а не предметная область.
APP_CATEGORY.update(
    {
        "django_celery_beat": "Служебное",
        "django_celery_results": "Служебное",
    }
)


def _spread(category: str, app_label: str, *models: str) -> dict[str, str]:
    return {f"{app_label}.{name}": category for name in models}


# Исключения по модели. Нужны в основном разделу ОМ: у него 67 моделей в одном
# приложении, и одной кучей это тот же список, только под другим заголовком.
MODEL_CATEGORY: dict[str, str] = {
    **_spread(
        "Обратная связь", "operations",
        "OpsFeedbackRegistry", "OpsFeedbackRequest", "OpsFeedbackComment",
        "OpsFeedbackEvent",
    ),
    # Справочники раздела: их наполняют сидом и по ним строят выпадающие списки.
    **_spread(
        "Справочники", "operations",
        "OpsDictionaryEntry", "StatusType", "OpsDutyType", "OpsCombatDutyType",
        "OpsCombatRoute", "OpsServiceReportType",
        "OpsAnalyticsMetricDefinition", "OpsAnalyticsPeriodPreset",
        "OpsAttentionDetector", "OpsLegalDocument", "OpsVehicle",
        "OpsCountry", "OpsCity", "OpsRatingGroup",
    ),
    # Настройки и политики: меняются редко, действуют на весь раздел.
    **_spread(
        "Служебное", "operations",
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
        "Доступ", "operations",
        "Permission", "Role", "RolePermission", "UserRole", "TemporaryDutyPermission",
    ),
    **_spread(
        "Служебное", "operations",
        "OpsAuditLog", "OpsRatingAuditEntry", "OpsNotification",
        "OpsRatingNotification", "OpsRatingIdempotencyRecord",
    ),
    # Состояния людей: они про сотрудника, а не про мероприятие.
    **_spread(
        # Реестр заявки на сбор сил (`[МД-06]`, Plane №425) — своя категория:
        # четыре таблицы иерархии в «Охранных мероприятиях» перевесили бы треть.
        "Сбор сил и расход", "operations",
        "OpsForceRequest", "OpsDepartmentRequest", "OpsUnitRequest",
        "OpsForceRequestMember", "OpsDailySubmission", "OpsForceCampaign",
        "OpsForceCampaignEvent", "OpsForceCampaignAssignment",
        "OpsForceCampaignPoolMember", "OpsForceCampaignHandover",
    ),
    **_spread(
        "Сотрудники и статусы", "operations",
        "OpsEmployeeStatus", "Secondment", "StatusOverride", "OpsProtectedPerson",
    ),
}

# Сторонние технические модели регистрируют собственные приложения. Они нужны
# инфраструктуре, но не являются рабочими редакторами закрытого контура.
HIDDEN_ADMIN_MODELS = {
    "admin.LogEntry",
    "contenttypes.ContentType",
    "sessions.Session",
    "sites.Site",
    "token_blacklist.BlacklistedToken",
    "token_blacklist.OutstandingToken",
    "django_celery_results.TaskResult",
    "django_celery_results.GroupResult",
    "django_celery_results.ChordCounter",
    "django_celery_beat.ClockedSchedule",
    "django_celery_beat.CrontabSchedule",
    "django_celery_beat.IntervalSchedule",
    "django_celery_beat.PeriodicTask",
    "django_celery_beat.PeriodicTasks",
    "django_celery_beat.SolarSchedule",
}

# Ежедневные редакторы идут первыми. Отсутствующий ключ остаётся в конце своей
# категории, но не меняет целевой порядок самих разделов.
MODEL_PRIORITY = (
    "auth.User", "operations.UserRole", "operations.Role",
    "operations.Permission", "operations.RolePermission",
    "divisions.Division", "staff_unit.StaffUnit", "dictionaries.Position",
    "staff_unit.Vacancy", "employees.Employee", "statuses.EmployeeStatus",
    "operations.OpsEmployeeStatus", "operations.Secondment",
    "dictionaries.Rank", "operations.StatusType", "operations.OpsDictionaryEntry",
    "operations.OpsSecurityEvent", "operations.OpsSecurityEventVisitObject",
    "operations.OpsSecurityObject", "operations.OpsSecurityPost",
    "operations.OpsObjectSector", "operations.OpsEventEvaluation",
    "operations.OpsDailySubmission", "operations.OpsForceRequest",
    "operations.OpsDepartmentRequest", "operations.OpsUnitRequest",
    "operations.OpsFeedbackRequest", "operations.OpsFeedbackComment",
    "operations.OpsIssuedDocument", "reports.Report", "operations.OpsAuditLog",
    "audit.AuditLog", "notifications.Notification", "operations.OpsNotification",
)
MODEL_PRIORITY_INDEX = {label: index for index, label in enumerate(MODEL_PRIORITY)}


def category_of(app_label: str, object_name: str) -> str:
    """Категория модели: сперва исключение, затем правило приложения."""
    key = f"{app_label}.{object_name}"
    if key in MODEL_CATEGORY:
        return MODEL_CATEGORY[key]
    return APP_CATEGORY.get(app_label, OTHER_CATEGORY)
