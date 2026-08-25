"""Сервис ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Сводка ГВО собирается на клиенте из бюллетеня мероприятия; здесь — только
хранение ручных правок (патч по коду ОМ) и справочник лиц. Формы ответов
повторяют мок фронта: {"results": [...]}, ключи camelCase.
"""
from django.core.exceptions import ValidationError

from organization_management.apps.operations import audit_service
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
)
# `visits` СНЯТ («Реестр ОМ-35.1»): объекты посещения живут таблицей
# `ops_security_event_visit_objects`, и патч сводки был вторым списком тех же
# объектов — они расходились молча. Правка дня и примечания идёт ручкой
# PATCH .../visit-objects/{id}/, добавление и снятие объекта — теми же
# ручками, что у реестра. Ключ остаётся в этом комментарии нарочно: чтобы
# следующий заход не вернул его «за компанию» с новой секцией.


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


# Раздел модалки → ключи патча, которые он кладёт/снимает. Дословно
# gvoSectionPatchKeys фронта (entities/gvo-summary/model/sections.ts);
# person:<i>/person:new правят persons, group:<i>/group:new — groups.
SECTION_PATCH_KEYS = {
    "head": ("country",),
    "persons": ("persons",),
    "arrival": ("arrival", "meet"),
    "departure": ("departure", "farewell"),
    "org": (
        "stay", "sbChief", "weapons", "obVariant", "radio", "wishes",
        "delegation",
    ),
    "groups": ("responsible", "groups"),
    "resp": ("responsible",),
    "transport": ("transport",),
}


def _section_keys(section):
    if isinstance(section, str):
        if section.startswith("person:"):
            return ("persons",)
        if section.startswith("group:"):
            return ("groups",)
        keys = SECTION_PATCH_KEYS.get(section)
        if keys is not None:
            return keys
    raise ValidationError({"section": f"Неизвестный раздел: {section!r}"})


def apply_patch(om_code, body, user, actor=None):
    """Тело — {section, values} (контракт UpdateGvoSummaryRequest фронта):
    values мержатся по ключам верхнего уровня — присланный ключ замещает
    секцию целиком, отсутствующий — не трогается (семантика мока)."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    if not isinstance(body, dict) or "values" not in body:
        raise ValidationError({"values": "Ожидается тело {section, values}."})
    _section_keys(body.get("section"))  # валидация раздела
    values = body["values"]
    if not isinstance(values, dict):
        raise ValidationError({"values": "values должен быть объектом."})
    unknown = sorted(set(values) - set(ALLOWED_PATCH_KEYS))
    if unknown:
        raise ValidationError(
            {"patch": f"Неизвестные секции патча: {', '.join(unknown)}"}
        )
    rec, _created = OpsGvoSummaryPatch.objects.get_or_create(
        event=event, defaults={"patch": {}}
    )
    rec.patch = {**rec.patch, **values}
    rec.updated_by = user if getattr(user, "is_authenticated", False) else None
    rec.save(update_fields=["patch", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.GVO_SUMMARY_PATCHED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={"omCode": event.code, "keys": sorted(values)},
    )
    return {
        "omCode": event.code,
        "patch": rec.patch,
        "updatedAt": rec.updated_at.isoformat(),
    }


def reset_patch(om_code, body, actor=None):
    """Тело — {section} (ResetGvoSummaryRequest): снимаются только ключи
    раздела; пустой остаток удаляет запись целиком. None — нет такого ОМ."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    keys = _section_keys((body or {}).get("section"))
    rec = OpsGvoSummaryPatch.objects.filter(event=event).first()
    remaining = {}
    if rec is not None:
        remaining = {k: v for k, v in rec.patch.items() if k not in keys}
        if remaining:
            rec.patch = remaining
            rec.save(update_fields=["patch", "updated_at"])
        else:
            rec.delete()
    audit_service.record(
        actor=actor,
        action=audit_service.GVO_SUMMARY_RESET,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={"omCode": event.code, "section": (body or {}).get("section")},
    )
    return {"omCode": event.code, "patch": remaining}


def list_legal_documents():
    from organization_management.apps.operations.models_legal import (
        OpsLegalDocument,
    )

    return [
        {
            "id": str(d.id),
            "kind": d.kind,
            "code": d.code,
            "title": d.title,
            "description": d.description,
            "revision": d.revision,
            "status": d.status,
            "pages": d.pages,
            "fileUrl": d.file_url,
        }
        for d in OpsLegalDocument.objects.filter(is_active=True)
    ]
