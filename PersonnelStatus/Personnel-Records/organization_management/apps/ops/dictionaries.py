"""Справочники раздела ОМ — generic-реестр «код → значение».

Связи значения считает СЕРВЕР при чтении, поимённо по источникам:
JOURNAL_ENTRY_TYPES — по журналам штаба живых ОМ (хранят код типа),
POST_REQUIREMENT_GROUPS — по groupCode записей POST_REQUIREMENTS.
Неотслеживаемые справочники несут ПРИЧИНУ, а не ноль («удалять безопасно»
было бы ложью). Удаление необратимо и требует ДОКАЗАННОГО отсутствия связей:
у NOT_TRACKED оно запрещено, используйте деактивацию.
"""
from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)

DEFINITIONS = [
    {
        "code": "JOURNAL_ENTRY_TYPES",
        "label": "Типы записей журнала штаба",
        "description": "Категории записей журнала стадии «Проведение» ОМ.",
    },
    {
        "code": "RETURN_REASONS",
        "label": "Причины возврата",
        "description": "Типовые причины возврата расстановки на доработку.",
    },
    {
        "code": "POST_REQUIREMENTS",
        "label": "Требования к постам",
        "description": "Типовые требования к назначению на пост.",
    },
    {
        "code": "POST_REQUIREMENT_GROUPS",
        "label": "Группы требований",
        "description": "Категории, к которым относятся требования к постам.",
    },
    {
        "code": "PLACEMENT_ROLES",
        "label": "Роли наряда в расстановке",
        "description": (
            "Кем человек идёт в наряде: водитель VIP, ответственный за кортеж, "
            "начальник выездной охраны и прочие места бланка «Общая расстановка»."
        ),
    },
    {
        "code": "SEASONAL_CORRECTIONS",
        "label": "Сезонные поправки",
        "description": "Поправки к нормативам по сезону.",
    },
    {
        "code": "EVENT_PARTICIPATION_KINDS",
        "label": "Виды участия в ОМ",
        "description": (
            "Чем человек занят на мероприятии: физический наряд либо "
            "специфическая группа (досмотра, кинологическая и прочие)."
        ),
    },
    {
        "code": "EVENT_GROUP_ROLES",
        "label": "Роли внутри группы",
        "description": (
            "Кем человек идёт в группе: досмотрщик, кинолог и прочие. Роль "
            "принадлежит КОНКРЕТНОЙ группе — она указывается в поле группы."
        ),
    },
]
_CODES = {d["code"] for d in DEFINITIONS}

#: Справочник → справочник его групп. Раньше эта связь была вписана литералом
#: в трёх местах («если POST_REQUIREMENTS, то проверяй по
#: POST_REQUIREMENT_GROUPS»), и второй такой паре пришлось бы дописывать
#: четвёртое место (Plane №274).
GROUP_PARENT = {
    "POST_REQUIREMENTS": "POST_REQUIREMENT_GROUPS",
    # Роль живёт внутри вида участия, и видом может быть только ГРУППА:
    # у физического наряда ролей внутри нет.
    "EVENT_GROUP_ROLES": "EVENT_PARTICIPATION_KINDS",
}

_JOURNAL_TYPE_LABEL = {
    "INSTRUCTION": "Инструктаж",
    "ORDER": "Распоряжение",
    "INCIDENT": "Инцидент",
    "REPLACEMENT": "Замена",
}

#: Как назвать детей справочника-родителя в отчёте о связях.
_CHILD_LABEL = {
    "POST_REQUIREMENTS": "Требования к постам",
    "EVENT_GROUP_ROLES": "Роли внутри группы",
}

_NOT_TRACKED_REASON = {
    "RETURN_REASONS": (
        "Возврат расстановки хранит свободный комментарий, а не код причины "
        "— связи отследить нельзя."
    ),
    "POST_REQUIREMENTS": (
        "Паспорт объекта и расчёт ОМ хранят требования строкой, а не кодом — "
        "связи отследить нельзя."
    ),
    "SEASONAL_CORRECTIONS": (
        "Поправки пока не читает ни один расчёт — потребителя кода в модели "
        "нет."
    ),
    # До шага Ш-3 роль ещё никто не проставляет: статус участия её не несёт.
    # Когда понесёт — связь станет отслеживаемой, и эта строка уйдёт.
    "EVENT_GROUP_ROLES": (
        "Роль пока не проставляется ни одному статусу — потребителя кода в "
        "модели нет."
    ),
}


def _require_dictionary(code):
    if code not in _CODES:
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"code": str(code)},
            message="Справочник не найден.",
        )


def usage_of(entry):
    if entry.dictionary_code == "JOURNAL_ENTRY_TYPES":
        carriers = []
        for event in OpsSecurityEvent.objects.all():
            for journal in event.journal_entries:
                if journal.get("type") == entry.code:
                    carriers.append(f"{event.code}: {journal.get('title')}")
        label = _JOURNAL_TYPE_LABEL.get(entry.code, entry.code)
        return {
            "status": "TRACKED",
            "reason": None,
            "references": (
                []
                if not carriers
                else [
                    {
                        "sourceLabel": f"Журналы ОМ ({label})",
                        "count": len(carriers),
                        "samples": carriers[:3],
                    }
                ]
            ),
            "totalCount": len(carriers),
        }
    # Справочник-РОДИТЕЛЬ групп: его значение держат дети через `group_code`.
    # Ищем ребёнка в общей карте, а не по литеральной паре: пар стало две
    # (требования постов и роли внутри группы), и вторая литеральная ветка
    # разошлась бы с первой на первой же правке (Plane №274).
    child_code = next(
        (
            child
            for child, parent in GROUP_PARENT.items()
            if parent == entry.dictionary_code
        ),
        None,
    )
    if child_code is not None:
        carriers = list(
            OpsDictionaryEntry.objects.filter(
                dictionary_code=child_code, group_code=entry.code
            ).values_list("label", flat=True)
        )
        return {
            "status": "TRACKED",
            "reason": None,
            "references": (
                []
                if not carriers
                else [
                    {
                        "sourceLabel": _CHILD_LABEL.get(child_code, child_code),
                        "count": len(carriers),
                        "samples": carriers[:3],
                    }
                ]
            ),
            "totalCount": len(carriers),
        }
    return {
        "status": "NOT_TRACKED",
        "reason": _NOT_TRACKED_REASON.get(
            entry.dictionary_code, "Связи не отслеживаются."
        ),
        "references": [],
        "totalCount": 0,
    }


def serialize_entry(entry):
    return {
        "id": str(entry.pk),
        "dictionaryCode": entry.dictionary_code,
        "code": entry.code,
        "label": entry.label,
        "description": entry.description,
        "isActive": entry.is_active,
        "groupCode": entry.group_code,
        "updatedAt": entry.updated_at.isoformat(),
        "usage": usage_of(entry),
    }


def definitions_with_counts():
    entries = list(
        OpsDictionaryEntry.objects.values_list("dictionary_code", "is_active")
    )
    results = []
    for definition in DEFINITIONS:
        own = [row for row in entries if row[0] == definition["code"]]
        results.append(
            {
                **definition,
                "totalCount": len(own),
                "activeCount": sum(1 for row in own if row[1]),
            }
        )
    return results


def list_entries(dictionary_code):
    _require_dictionary(dictionary_code)
    return [
        serialize_entry(entry)
        for entry in OpsDictionaryEntry.objects.filter(
            dictionary_code=dictionary_code
        )
    ]


@transaction.atomic
def create_entry(dictionary_code, *, code, label, description, group_code,
                 actor):
    _require_dictionary(dictionary_code)
    field_errors = {}
    code = str(code or "").strip().upper()
    if code == "":
        field_errors["code"] = ["Обязательное поле."]
    if not str(label or "").strip():
        field_errors["label"] = ["Обязательное поле."]
    if code and OpsDictionaryEntry.objects.filter(
        dictionary_code=dictionary_code, code=code
    ).exists():
        field_errors["code"] = ["Код уже используется в этом справочнике."]
    group_parent = GROUP_PARENT.get(dictionary_code)
    if (
        group_parent is not None
        and group_code
        and not OpsDictionaryEntry.objects.filter(
            dictionary_code=group_parent,
            code=group_code,
            is_active=True,
        ).exists()
    ):
        field_errors["groupCode"] = ["Группа не найдена или неактивна."]
    if field_errors:
        raise DomainError(
            "VALIDATION_ERROR", 400, detail=field_errors,
            message="Проверьте заполнение формы.",
        )
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code=dictionary_code,
        code=code,
        label=str(label).strip(),
        description=str(description or "").strip(),
        is_active=True,
        group_code=(group_code or None) if group_parent is not None else None,
        updated_by=actor,
    )
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_CREATED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        new_value={
            "dictionary": dictionary_code, "code": code, "label": entry.label,
        },
    )
    return entry


@transaction.atomic
def update_entry(entry_id, *, label, description, group_code, actor):
    """Правка значения справочника (Plane №274).

    Заказчик просил у модуля все три действия — «Добавлять, удалять,
    редактировать», — а правки не было: значение можно было только завести,
    снять с активных и удалить. Опечатку в подписи приходилось лечить
    удалением и заведением заново, то есть терять связи и историю.

    КОД НЕ ПРАВИТСЯ. На него ссылаются записи журналов, требования постов и
    роли расстановки — по коду, а не по идентификатору строки; сменить его
    значило бы оборвать эти ссылки молча. Ошибочный код лечится заведением
    нового значения и снятием старого, и это видно в журнале действий.

    `group_code` принимается только у требований к постам — там же, где его
    принимает заведение: у остальных справочников группы нет вовсе.
    """
    entry = _lock_entry(entry_id)
    field_errors = {}
    if not str(label or "").strip():
        field_errors["label"] = ["Обязательное поле."]
    group_parent = GROUP_PARENT.get(entry.dictionary_code)
    wants_group = group_parent is not None
    if (
        wants_group
        and group_code
        and not OpsDictionaryEntry.objects.filter(
            dictionary_code=group_parent,
            code=group_code,
            is_active=True,
        ).exists()
    ):
        field_errors["groupCode"] = ["Группа не найдена или неактивна."]
    if field_errors:
        raise DomainError(
            "VALIDATION_ERROR", 400, detail=field_errors,
            message="Проверьте заполнение формы.",
        )

    old = {
        "label": entry.label,
        "description": entry.description,
        "groupCode": entry.group_code,
    }
    entry.label = str(label).strip()
    entry.description = str(description or "").strip()
    if wants_group:
        entry.group_code = group_code or None
    entry.updated_by = actor
    entry.save(
        update_fields=[
            "label", "description", "group_code", "updated_by", "updated_at",
        ]
    )
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_UPDATED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value=old,
        new_value={
            "label": entry.label,
            "description": entry.description,
            "groupCode": entry.group_code,
        },
    )
    return entry


def _lock_entry(entry_id):
    if not str(entry_id).isdigit():
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"id": str(entry_id)},
            message="Запись не найдена.",
        )
    entry = (
        OpsDictionaryEntry.objects.select_for_update()
        .filter(pk=entry_id)
        .first()
    )
    if entry is None:
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"id": str(entry_id)},
            message="Запись не найдена.",
        )
    return entry


@transaction.atomic
def set_entry_active(entry_id, *, is_active, actor):
    entry = _lock_entry(entry_id)
    old = entry.is_active
    entry.is_active = is_active is True
    entry.updated_by = actor
    entry.save(update_fields=["is_active", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_SET_ACTIVE,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value={"isActive": old},
        new_value={"isActive": entry.is_active},
    )
    return entry


@transaction.atomic
def delete_entry(entry_id, *, actor):
    entry = _lock_entry(entry_id)
    usage = usage_of(entry)
    if usage["status"] != "TRACKED":
        raise DomainError(
            "DICTIONARY_USAGE_UNKNOWN", 422,
            message=usage["reason"]
            or "Связи значения не отслеживаются — удаление запрещено, "
            "используйте деактивацию.",
        )
    if usage["totalCount"] > 0:
        joined = "; ".join(
            f"{ref['sourceLabel']} — {', '.join(ref['samples'])}"
            for ref in usage["references"]
        )
        raise DomainError(
            "DICTIONARY_ENTRY_IN_USE", 409,
            detail={"usage": usage},
            message=f"Значение используется ({usage['totalCount']}): {joined}.",
        )
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_DELETED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value={
            "dictionary": entry.dictionary_code,
            "code": entry.code,
            "label": entry.label,
        },
    )
    entry.delete()
