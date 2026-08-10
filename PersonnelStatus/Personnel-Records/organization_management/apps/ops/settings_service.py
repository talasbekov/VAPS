"""Настройки раздела ОМ — владелец политик (§21.7).

Правка настройки поднимает версию РАЗДЕЛА и в той же транзакции пишется
насквозь в политику-потребитель: passport.* → OpsPassportFreshnessPolicy,
conflict.rest_after_duty.mode → OpsDutyConflictPolicy. Потребители продолжают
читать свои синглтоны — но владелец значения и версии теперь один: настройки.

Право правки решает сервер по-записно: у запертого правила своя причина
(lockedReason), у нехватки права — своя; мок хардкодил «править можно всем».
"""
import re

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy,
)
from organization_management.apps.operations.models_object import (
    OpsPassportFreshnessPolicy,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
    OpsSettingChangeEvent,
)

_NO_MANAGE_REASON = "Нужно право управления настройками (ops.settings.manage)."

_UNIT = {
    "DAYS": "дн.",
    "PERCENT": "%",
    "COUNT": "шт.",
    "HOURS": "ч",
    "MINUTES": "мин",
}


def format_value(setting, value):
    """Подпись значения для журнала — собирает владелец вариантов."""
    if setting.kind == "CHOICE":
        for option in setting.options or []:
            if option.get("value") == value:
                return option.get("safeLabel", str(value))
        return str(value)
    return f"{value} {_UNIT.get(setting.value_type, '')}".strip()


def next_policy_version(current):
    """Растёт последний числовой сегмент `<префикс>.<N>` / `<префикс>-vN`."""
    dot = re.match(r"^(.*\.)(\d+)$", current)
    if dot:
        return f"{dot.group(1)}{int(dot.group(2)) + 1}"
    v = re.match(r"^(.*-v)(\d+)$", current)
    if v:
        return f"{v.group(1)}{int(v.group(2)) + 1}"
    return f"{current}.2"


def serialize_setting(setting, *, can_manage):
    base = {
        "settingCode": setting.setting_code,
        "sectionCode": setting.section_code,
        "kind": setting.kind,
        "valueType": setting.value_type,
        "safeLabel": setting.safe_label,
        "description": setting.description,
        "value": setting.value,
        "updatedAt": (
            setting.value_updated_at.isoformat()
            if setting.value_updated_at
            else None
        ),
        "updatedBy": setting.updated_by,
        "editable": setting.editable,
        "lockedReason": setting.locked_reason,
        "action": {
            "canEdit": setting.editable and can_manage,
            "disabledReason": (
                setting.locked_reason
                if not setting.editable
                else (None if can_manage else _NO_MANAGE_REASON)
            ),
        },
    }
    if setting.kind == "NUMBER":
        base["minValue"] = setting.min_value
        base["maxValue"] = setting.max_value
    else:
        base["options"] = setting.options or []
    return base


def serialize_event(event):
    return {
        "id": str(event.pk),
        "settingCode": event.setting_code,
        "sectionCode": event.section_code,
        "safeLabel": event.safe_label,
        "oldValue": event.old_value,
        "newValue": event.new_value,
        "reason": event.reason,
        "actorUserId": event.actor_user_id,
        "changedAt": event.created_at.isoformat(),
        "policyVersionAfter": event.policy_version_after,
    }


def section_versions():
    return {
        row.section_code: row.version
        for row in OpsPolicySectionVersion.objects.all()
    }


def _validate_value(setting, value):
    if setting.kind == "CHOICE":
        if not isinstance(value, str) or not any(
            option.get("value") == value for option in setting.options or []
        ):
            return {"value": ["Выберите один из допустимых режимов."]}
        return {}
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return {"value": ["Укажите числовое значение."]}
    if int(value) != value:
        return {"value": ["Значение задаётся целым числом."]}
    if value < setting.min_value or value > setting.max_value:
        return {
            "value": [
                "Допустимый диапазон — от "
                f"{setting.min_value} до {setting.max_value}."
            ]
        }
    return {}


def _sync_policy_consumers(setting, version_after):
    """Сквозная запись в политику-потребитель — в той же транзакции: версия
    посчитанного результата обязана совпадать с версией раздела настроек."""
    if setting.section_code == "PASSPORT_FRESHNESS":
        fields = {
            "passport.verification_interval_days": "verification_interval_days",
            "passport.due_soon_percent": "due_soon_percent",
        }
        field = fields.get(setting.setting_code)
        if field is not None:
            OpsPassportFreshnessPolicy.objects.update_or_create(
                singleton_key=1,
                defaults={field: int(setting.value), "version": version_after},
            )
    if setting.setting_code == "conflict.rest_after_duty.mode":
        OpsDutyConflictPolicy.objects.update_or_create(
            singleton_key=1,
            defaults={
                "rest_after_duty_mode": setting.value,
                "version": version_after,
            },
        )


@transaction.atomic
def update_setting(setting_code, *, value, reason, actor):
    setting = (
        OpsPolicySetting.objects.select_for_update()
        .filter(setting_code=setting_code)
        .first()
    )
    if setting is None:
        raise DomainError(
            "ENTITY_NOT_FOUND", 404,
            detail={"settingCode": str(setting_code)},
            message="Настройка не найдена.",
        )
    if not setting.editable:
        raise DomainError(
            "SETTING_LOCKED", 422,
            message=setting.locked_reason or "Правило заперто.",
        )
    field_errors = _validate_value(setting, value)
    if not isinstance(reason, str) or reason.strip() == "":
        field_errors["reason"] = ["Укажите причину изменения."]
    if field_errors:
        raise DomainError(
            "VALIDATION_ERROR", 400, detail=field_errors,
            message="Проверьте заполнение формы.",
        )

    old_label = format_value(setting, setting.value)
    setting.value = int(value) if setting.kind == "NUMBER" else value
    setting.updated_by = actor
    setting.value_updated_at = Clock.now()
    setting.save(
        update_fields=["value", "updated_by", "value_updated_at", "updated_at"]
    )
    new_label = format_value(setting, setting.value)

    version_row, _ = OpsPolicySectionVersion.objects.select_for_update(
    ).get_or_create(
        section_code=setting.section_code,
        defaults={"version": f"{setting.section_code.lower()}-v1"},
    )
    version_row.version = next_policy_version(version_row.version)
    version_row.save(update_fields=["version", "updated_at"])

    _sync_policy_consumers(setting, version_row.version)

    event = OpsSettingChangeEvent.objects.create(
        setting_code=setting.setting_code,
        section_code=setting.section_code,
        safe_label=setting.safe_label,
        old_value=old_label,
        new_value=new_label,
        reason=reason.strip(),
        actor_user_id=actor,
        policy_version_after=version_row.version,
    )
    audit_service.record(
        actor=actor,
        action=audit_service.SETTINGS_UPDATED,
        entity_type=audit_service.ENTITY_POLICY_SETTING,
        entity_id=setting.pk,
        old_value={"value": old_label},
        new_value={"value": new_label, "policyVersion": version_row.version},
        reason=reason.strip(),
    )
    return setting, version_row.version, event
