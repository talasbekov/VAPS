"""Сервис ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Сводка ГВО собирается на клиенте из бюллетеня мероприятия; здесь — только
хранение ручных правок (патч по коду ОМ) и справочник лиц. Формы ответов
повторяют мок фронта: {"results": [...]}, ключи camelCase.
"""
from django.core.exceptions import ValidationError
from django.db.models import Q

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
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


# ── История мероприятий (задача заказчика Plane №38) ────────────────────────
#
# «Когда закрывается мероприятие, то как история в модулях Охраняемые лица и
# Объекты и паспорта должна быть кнопка история».
#
# ТОЛЬКО ЗАКРЫТЫЕ. История — это то, что уже случилось; действующее ОМ живёт в
# реестре и меняется, и показывать его в истории значило бы показывать
# незаконченное как факт.
#
# Связь «лицо ↔ объект» живёт на ОБЪЕКТЕ ПОСЕЩЕНИЯ, а не на мероприятии: в
# одном бюллетене лицо посещает свои объекты, и у длинного ОМ объекты разных
# лиц идут одной строкой реестра. Поэтому в истории лица показываются НЕ все
# объекты мероприятия, а только его собственные — ровно как просил заказчик.

CLOSED_STAGE = "CLOSED"


def _history_event(event):
    return {
        "eventId": str(event.pk),
        "code": event.code,
        "title": event.title,
        "kind": event.kind,
        "businessDate": event.business_date.isoformat(),
        "businessDateEnd": (
            event.business_date_end.isoformat()
            if event.business_date_end is not None
            else None
        ),
        "closedAt": event.closed_at.isoformat() if event.closed_at else None,
        "chiefName": event.chief_name,
    }


def person_event_history(person_id):
    """Закрытые ОМ, в которых участвовало охраняемое лицо.

    Лицо привязано ТРЕМЯ способами: главным полем бюллетеня
    (`protected_person`), СПИСКОМ лиц бюллетеня (`protected_persons`, Plane
    №188) и объектом посещения. Все три означают участие, и брать не все
    значило бы терять часть истории: у ОМ, заведённых до появления объектов
    посещения, связь есть только в бюллетене, а у бюллетеня с несколькими
    лицами все, кроме первого, живут ТОЛЬКО в списке.
    """
    visits = (
        OpsSecurityEventVisitObject.objects.filter(
            protected_person_id=person_id, event__stage=CLOSED_STAGE
        )
        .select_related("event")
        .order_by("event__business_date", "position", "id")
    )
    by_event = {}
    order = []
    for visit in visits:
        if visit.event_id not in by_event:
            by_event[visit.event_id] = {
                **_history_event(visit.event),
                "objects": [],
            }
            order.append(visit.event_id)
        by_event[visit.event_id]["objects"].append(
            {
                "visitObjectId": str(visit.pk),
                "objectId": (
                    str(visit.security_object_id)
                    if visit.security_object_id is not None
                    else None
                ),
                "objectName": visit.object_name,
                "visitDay": (
                    visit.visit_day.isoformat()
                    if visit.visit_day is not None
                    else None
                ),
                "note": visit.note,
            }
        )
    # ОМ, где лицо названо ТОЛЬКО в бюллетене: объектов у него в истории нет —
    # и это факт, а не пропуск, поэтому строка всё равно показывается.
    bulletin_only = (
        OpsSecurityEvent.objects.filter(
            # `Q(...) | Q(...)` — главное лицо ИЛИ любое из списка. Через
            # `filter(...).filter(...)` было бы «и то, и другое», а через два
            # запроса пришлось бы сводить их руками и следить за дублями:
            # `distinct` нужен именно из-за соединения по M2M.
            Q(protected_person_id=person_id)
            | Q(protected_persons__id=person_id),
            stage=CLOSED_STAGE,
        )
        .exclude(pk__in=by_event.keys())
        .distinct()
        .order_by("business_date", "id")
    )
    for event in bulletin_only:
        by_event[event.pk] = {**_history_event(event), "objects": []}
        order.append(event.pk)
    # Новые сверху: историю читают от последнего.
    rows = [by_event[key] for key in order]
    rows.sort(key=lambda row: (row["businessDate"], row["code"]), reverse=True)
    return rows


def object_event_history(object_id):
    """Закрытые ОМ, проходившие на объекте, и лица, посещавшие его.

    Лица берутся С ОБЪЕКТА ПОСЕЩЕНИЯ этого мероприятия, а не из бюллетеня: в
    длинном ОМ на разных объектах разные лица, и лицо из бюллетеня в истории
    объекта означало бы «посещал», хотя он мог там и не быть.
    """
    visits = (
        OpsSecurityEventVisitObject.objects.filter(
            security_object_id=object_id, event__stage=CLOSED_STAGE
        )
        .select_related("event")
        .order_by("event__business_date", "position", "id")
    )
    by_event = {}
    order = []
    for visit in visits:
        row = by_event.get(visit.event_id)
        if row is None:
            row = {**_history_event(visit.event), "persons": []}
            by_event[visit.event_id] = row
            order.append(visit.event_id)
        name = visit.protected_person_name.strip()
        # Дедупа тут НЕТ намеренно: один объект не заводится в одно ОМ дважды
        # (ограничение `uniq_ops_event_visit_object`), значит на пару
        # «мероприятие + объект» приходится ровно одна строка и ровно одно
        # лицо. Проверка «нет ли уже такого имени» была бы кодом, который не
        # исполняется, и пробой, которая ничего не стережёт.
        if name != "":
            row["persons"].append(
                {
                    "personId": (
                        str(visit.protected_person_id)
                        if visit.protected_person_id is not None
                        else None
                    ),
                    "name": name,
                    "visitDay": (
                        visit.visit_day.isoformat()
                        if visit.visit_day is not None
                        else None
                    ),
                }
            )
    rows = [by_event[key] for key in order]
    rows.sort(key=lambda row: (row["businessDate"], row["code"]), reverse=True)
    return rows


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
