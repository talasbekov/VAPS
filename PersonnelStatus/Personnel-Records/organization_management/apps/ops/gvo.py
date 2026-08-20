"""Сервис ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Сводка ГВО собирается на клиенте из бюллетеня мероприятия; здесь — только
хранение ручных правок (патч по коду ОМ) и справочник лиц. Формы ответов
повторяют мок фронта: {"results": [...]}, ключи camelCase.
"""
from django.core.exceptions import ValidationError

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import (
    OpsGvoSummaryPatch,
    OpsProtectedPerson,
)

# Разрешённые секции патча — ключи GvoSummary фронта дословно
# (entities/gvo-summary/model/types.ts, GvoSummaryPatch = Partial<GvoSummary>).
# Неизвестный ключ — ошибка контракта, а не молчаливое сохранение: иначе
# опечатка клиента похоронит правку.
ALLOWED_PATCH_KEYS = (
    "country",
    "persons",
    "arrival",
    "departure",
    "meet",
    "farewell",
    "stay",
    "delegation",
    "sbChief",
    "weapons",
    "wishes",
    "obVariant",
    "radio",
    "responsible",
    "groups",
    "transport",
    "visits",
)


def list_persons():
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "callsign": p.callsign,
            "category": p.category,
            "bio": p.bio,
        }
        for p in OpsProtectedPerson.objects.filter(is_active=True)
    ]


def _event_or_none(om_code):
    return OpsSecurityEvent.objects.filter(code=om_code).first()


def list_patches():
    return [
        {
            "omCode": rec.event.code,
            "patch": rec.patch,
            "updatedAt": rec.updated_at.isoformat(),
        }
        for rec in OpsGvoSummaryPatch.objects.select_related("event")
    ]


def apply_patch(om_code, body, user):
    """Merge по ключам верхнего уровня: присланный ключ замещает секцию
    целиком, отсутствующий — не трогается (семантика мока)."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    unknown = sorted(set(body) - set(ALLOWED_PATCH_KEYS))
    if unknown:
        raise ValidationError(
            {"patch": f"Неизвестные секции патча: {', '.join(unknown)}"}
        )
    rec, _created = OpsGvoSummaryPatch.objects.get_or_create(
        event=event, defaults={"patch": {}}
    )
    rec.patch = {**rec.patch, **body}
    rec.updated_by = user if getattr(user, "is_authenticated", False) else None
    rec.save(update_fields=["patch", "updated_by", "updated_at"])
    return {
        "omCode": event.code,
        "patch": rec.patch,
        "updatedAt": rec.updated_at.isoformat(),
    }


def reset_patch(om_code):
    """True — патч был и удалён либо его не было (идемпотентно); None — нет ОМ."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    OpsGvoSummaryPatch.objects.filter(event=event).delete()
    return True
