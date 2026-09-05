"""Сервис ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Сводка ГВО собирается на клиенте из бюллетеня мероприятия; здесь — только
хранение ручных правок (патч по коду ОМ) и справочник лиц. Формы ответов
повторяют мок фронта: {"results": [...]}, ключи camelCase.
"""
from django.core.exceptions import ValidationError

from organization_management.apps.operations.exceptions import DomainError
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
    # Ссылки на справочники (Plane №435, `[ГВО-08]`): встречающие,
    # провожающие, состав делегации/ГВО — идентификаторы сотрудников.
    "meetEmployeeIds",
    "farewellEmployeeIds",
    "delegationEmployeeIds",
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
            # Код `OL-N` (Plane №417) — печатается в бюллетене и сводках.
            "code": p.display_code,
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
# 🔴 СПИСОК ОБЯЗАН ПОКРЫВАТЬ ВЕСЬ `ALLOWED_PATCH_KEYS` (Plane №689). Ключ,
# который РАЗРЕШЕНО записать, но которого нет ни в одном разделе, снять
# «Вернуть исходные» уже не может — он остаётся в сводке навсегда. Так и
# случилось со ссылками на справочники (`*EmployeeIds`, `[ГВО-08]`): их
# добавили в разрешённые, а по разделам не разложили, и идентификаторы
# снятых встречающих переживали любой сброс. Проба
# `test_every_allowed_key_belongs_to_a_section` держит это соответствие.
SECTION_PATCH_KEYS = {
    "head": ("country",),
    "persons": ("persons",),
    "arrival": ("arrival", "meet", "meetEmployeeIds"),
    "departure": ("departure", "farewell", "farewellEmployeeIds"),
    "org": (
        "stay", "sbChief", "weapons", "obVariant", "radio", "wishes",
        "delegation", "delegationEmployeeIds",
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


# ── Визит иностранного ОЛ (Plane №435, `[МД-05]`) ───────────────────────────


def visit_for_event(event, *, create=False):
    """Визит мероприятия: только у `kind=FOREIGN`; `create=True` заводит его
    при первом обращении. У внутреннего ОМ — `None` всегда."""
    from organization_management.apps.operations.models_gvo import OpsForeignVisit

    if event.kind != "FOREIGN":
        return None
    if not create:
        return OpsForeignVisit.objects.filter(event=event).first()
    visit, _created = OpsForeignVisit.objects.get_or_create(
        event=event, defaults={"protected_person_id": event.protected_person_id}
    )
    return visit


# Обязательные поля визита (`[ГВО-07]`, Plane №436): без них «Утвердить»
# недоступна. Ключ — путь в собранной сводке; поле считается заполненным, если
# в нём есть данные ЛИБО оно помечено «уточняется» (`[ГВО-06]`): «данных нет от
# принимающей стороны» — тоже ответ, и утверждение он не держит.
REQUIRED_VISIT_FIELDS = (
    ("country", "Страна"),
    ("persons", "Охраняемые лица"),
    ("arrival.date", "Дата прибытия"),
    ("departure.date", "Дата убытия"),
    ("responsible", "Старший ГВО"),
)


def _field_value(summary, path):
    node = summary
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def missing_required(summary, visit):
    """Незаполненные обязательные поля визита — подписями, по порядку."""
    flagged = set((visit.unspecified or []) if visit is not None else [])
    missing = []
    for path, label in REQUIRED_VISIT_FIELDS:
        if path in flagged:
            continue
        value = _field_value(summary or {}, path)
        empty = (
            value is None
            or value == ""
            or (isinstance(value, (list, dict)) and len(value) == 0)
        )
        if empty:
            missing.append(label)
    return missing


def approve_visit(om_code, *, actor):
    """«Утвердить» визит (`[ГВО-07]`, `[ГВО-09]`): штаб; недоступно, пока не
    заполнены обязательные поля. Повторное утверждение — отказ, а не тихое
    «ок»: утверждённая версия одна."""
    from organization_management.apps.ops import documents_summary

    event = _event_or_none(om_code)
    if event is None:
        return None
    _require_foreign(event)
    visit = visit_for_event(event, create=True)
    if visit.status == "APPROVED":
        raise DomainError(
            "VISIT_ALREADY_APPROVED", 422,
            message="Визит уже утверждён — правки заведут новую версию.",
        )
    row = documents_summary.summary_row(event)
    missing = missing_required(row.get("summary"), visit)
    if missing:
        raise DomainError(
            "VISIT_REQUIRED_MISSING", 422,
            detail={"missing": missing},
            message="Заполните обязательные поля: " + ", ".join(missing) + ".",
        )
    from organization_management.apps.operations.clock import Clock

    visit.status = "APPROVED"
    visit.approved_at = Clock.now()
    visit.approved_by = str(actor or "")[:100]
    visit.save(update_fields=["status", "approved_at", "approved_by", "updated_at"])
    audit_service.record(
        actor=str(actor or "system"),
        action=audit_service.GVO_VISIT_APPROVED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=str(event.pk),
        new_value={"omCode": event.code, "version": visit.version},
    )
    return documents_summary.summary_row(event)


def _require_foreign(event):
    if event.kind != "FOREIGN":
        raise DomainError(
            "VISIT_FOREIGN_ONLY",
            422,
            message=(
                "Сводные данные ГВО ведутся только у мероприятий с участием "
                "иностранцев — у внутреннего ОМ визита нет."
            ),
        )


def _parse_unspecified(raw):
    """Флаги «уточняется» (`[ГВО-06]`): список ключей полей."""
    if raw is None:
        return None
    if not isinstance(raw, list) or any(not isinstance(k, str) for k in raw):
        raise ValidationError({"unspecified": "Ожидается список ключей полей."})
    return sorted(set(k.strip() for k in raw if k.strip()))


def apply_patch(om_code, body, user, actor=None):
    """Тело — {section, values} (контракт UpdateGvoSummaryRequest фронта):
    values мержатся по ключам верхнего уровня — присланный ключ замещает
    секцию целиком, отсутствующий — не трогается (семантика мока)."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    if not isinstance(body, dict) or "values" not in body:
        raise ValidationError({"values": "Ожидается тело {section, values}."})
    # РАЗДЕЛ НЕОБЯЗАТЕЛЕН (Plane №694). Он и раньше только ПРОВЕРЯЛСЯ —
    # результат `_section_keys` здесь не используется, а состав тела бьётся по
    # `ALLOWED_PATCH_KEYS` строкой ниже. Пока раздел был обязателен, клиент
    # сохранял правку ЦИКЛОМ из PATCH по одному на изменённый раздел: падение
    # середины оставляло половину сохранённой, а флаги «уточняется», ехавшие с
    # последним вызовом, — нет. Отсутствие раздела означает «правка нескольких
    # разделов разом»; присланный — проверяется, как и прежде, чтобы опечатка
    # в имени не проходила молча.
    if body.get("section") is not None:
        _section_keys(body["section"])
    values = body["values"]
    if not isinstance(values, dict):
        raise ValidationError({"values": "values должен быть объектом."})
    unknown = sorted(set(values) - set(ALLOWED_PATCH_KEYS))
    if unknown:
        raise ValidationError(
            {"patch": f"Неизвестные секции патча: {', '.join(unknown)}"}
        )
    _require_foreign(event)
    unspecified = _parse_unspecified(body.get("unspecified"))
    rec, _created = OpsGvoSummaryPatch.objects.get_or_create(
        event=event, defaults={"patch": {}}
    )
    rec.patch = {**rec.patch, **values}
    rec.updated_by = user if getattr(user, "is_authenticated", False) else None
    rec.save(update_fields=["patch", "updated_by", "updated_at"])
    # Визит — новый источник правды (Plane №435): та же правка пишется в
    # него, версия растёт; патч живёт рядом, пока его читают.
    visit = visit_for_event(event, create=True)
    visit.data = {**(visit.data or {}), **values}
    if unspecified is not None:
        visit.unspecified = unspecified
    visit.version += 1
    # 🔴 ПРАВКА СНИМАЕТ УТВЕРЖДЕНИЕ (Plane №685). Отказ `approve_visit` уже
    # обещал это словами — «Визит уже утверждён — правки заведут новую
    # версию», — но код обещания не выполнял: статус поднимался только
    # DRAFT→READY и APPROVED не снимался никогда. Штаб утверждал визит, затем
    # любой с `gvo.manage` переписывал страну, группы и транспорт, а шапка и
    # реестр по-прежнему показывали «Утверждён» с ПРЕЖНЕЙ отметкой времени —
    # утверждение относилось к содержимому, которого больше нет. Переутвердить
    # при этом было нельзя: `approve_visit` отбивал VISIT_ALREADY_APPROVED, и
    # выхода из этого состояния не существовало вовсе.
    #
    # Отметка утверждения СНИМАЕТСЯ, а не остаётся рядом со статусом READY:
    # `approvedAt` уезжает в шапку визита и в реестр, и оставленный там час
    # утверждения версии, которой больше нет, — та же ложь, только тише.
    # История не теряется: кто и когда утверждал, записано в журнале
    # (`GVO_VISIT_APPROVED` с номером версии), а снятие пишется туда же.
    if visit.status == "APPROVED":
        _revoke_approval(visit, event, actor)
    elif visit.status == "DRAFT":
        visit.status = "READY"
    visit.save(
        update_fields=[
            "data", "unspecified", "version", "status",
            "approved_at", "approved_by", "updated_at",
        ]
    )
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


def _revoke_approval(visit, event, actor):
    """Снять утверждение с визита, чей состав изменился (Plane №685).

    Не сохраняет — вызывающий пишет визит одним `save` вместе со своими
    полями: два `save` подряд дали бы две записи `updated_at` на одно
    действие человека.
    """
    visit.status = "READY"
    visit.approved_at = None
    visit.approved_by = ""
    audit_service.record(
        actor=str(actor or "system"),
        action=audit_service.GVO_VISIT_APPROVAL_REVOKED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=str(event.pk),
        # Номер НОВОЙ версии: по нему в журнале видно, какая правка сняла
        # утверждение, — рядом с записью `GVO_VISIT_APPROVED` о прежней.
        new_value={"omCode": event.code, "version": visit.version},
    )


def reset_patch(om_code, body, actor=None):
    """Тело — {section} (ResetGvoSummaryRequest): снимаются только ключи
    раздела; пустой остаток удаляет запись целиком. None — нет такого ОМ."""
    event = _event_or_none(om_code)
    if event is None:
        return None
    _require_foreign(event)
    keys = _section_keys((body or {}).get("section"))
    visit = visit_for_event(event)
    if visit is not None:
        visit.data = {k: v for k, v in (visit.data or {}).items() if k not in keys}
        # ФЛАГИ РАЗДЕЛА СНИМАЮТСЯ ВМЕСТЕ С ЕГО ДАННЫМИ (Plane №689). «Вернуть
        # исходные» их не трогало, и документ продолжал печатать «уточняется»
        # у поля, которого человек уже вернул к исходному, — пометка пережила
        # то, что поясняла.
        #
        # Принадлежность считается ПЕРВЫМ СЕГМЕНТОМ пути, а не отдельной
        # картой: путь флага и есть адрес значения в сводке (`arrival.date`,
        # `stay.place`), поэтому его верхний ключ — тот же, что в
        # `SECTION_PATCH_KEYS`. Вторая карта разошлась бы с первой при первой
        # же новой секции.
        visit.unspecified = [
            path
            for path in (visit.unspecified or [])
            if str(path).split(".")[0] not in keys
        ]
        visit.version += 1
        # Сброс — тоже правка (Plane №685): утверждение относилось к прежнему
        # содержимому и после возврата к исходному больше не действует.
        if visit.status == "APPROVED":
            _revoke_approval(visit, event, actor)
        visit.save(
            update_fields=[
                "data", "unspecified", "version", "status",
                "approved_at", "approved_by", "updated_at",
            ]
        )
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
