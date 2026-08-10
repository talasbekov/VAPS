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
        "code": "SEASONAL_CORRECTIONS",
        "label": "Сезонные поправки",
        "description": "Поправки к нормативам по сезону.",
    },
]
_CODES = {d["code"] for d in DEFINITIONS}

_JOURNAL_TYPE_LABEL = {
    "INSTRUCTION": "Инструктаж",
    "ORDER": "Распоряжение",
    "INCIDENT": "Инцидент",
    "REPLACEMENT": "Замена",
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
    if entry.dictionary_code == "POST_REQUIREMENT_GROUPS":
        carriers = list(
            OpsDictionaryEntry.objects.filter(
                dictionary_code="POST_REQUIREMENTS", group_code=entry.code
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
                        "sourceLabel": "Требования к постам",
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
    if (
        dictionary_code == "POST_REQUIREMENTS"
        and group_code
        and not OpsDictionaryEntry.objects.filter(
            dictionary_code="POST_REQUIREMENT_GROUPS",
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
        group_code=(
            (group_code or None)
            if dictionary_code == "POST_REQUIREMENTS"
            else None
        ),
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
