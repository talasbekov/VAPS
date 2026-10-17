"""Справочники раздела ОМ — generic-реестр «код → значение».

Связи значения считает СЕРВЕР при чтении, поимённо по источникам, и считает
их у ВСЕХ справочников раздела (UC-REF-001): `collect_usage` собирает карту
«код → ссылки» за один заход по источникам, а `usage_of` только читает её.
Собирать по записи, как делали раньше журналы, значило бы проход по всем
мероприятиям на каждую строку списка.

Три справочника хранят не код, а свободный текст (причины возврата,
требования к постам, сезонные поправки): у них связей нет ПО ПОСТРОЕНИЮ, и
это `TRACKED` с нулём, а не «не отслеживается» — удалять такие значения
безопасно. `UNKNOWN` остаётся на сбой сборщика: тогда удаление запрещено.
"""
import logging
from uuid import uuid4

from django.db import transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)

logger = logging.getLogger(__name__)

DEFINITIONS = [
    {
        "code": "SERVICE_DUTY_KINDS",
        "label": "Виды дежурств",
        "description": "Административные виды для журнала и анализа дежурств. Можно добавлять свои; длительность указывается в записи смены.",
    },
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
        "code": "PLACEMENT_SECTIONS",
        "label": "Секции бланка расстановки",
        "description": (
            "Раздел бланка «Общая расстановка», к которому относится место: "
            "выездная охрана «Ұлан-батор», объект «Сапар» и прочие. Вторая "
            "координата назначения — роль отвечает «кем», секция «где»."
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
_PARTICIPATION_DICTIONARY = "EVENT_PARTICIPATION_KINDS"
_PHYSICAL_SQUAD = "PHYSICAL_SQUAD"
UNSET = object()

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

#: Справочники, чей код в деловых данных не хранится вовсе (свободный текст).
#: Связей у них нет по построению, и это не «не отслеживается», а «нечего
#: отслеживать»: удалять такие значения безопасно.
_FREE_TEXT_REASON = {
    "RETURN_REASONS": (
        "Возврат расстановки хранит свободный комментарий, код причины в "
        "данных не хранится — связей быть не может."
    ),
    "POST_REQUIREMENTS": (
        "Паспорт объекта и расчёт ОМ хранят требования строкой, код в данных "
        "не хранится — связей быть не может."
    ),
    "SEASONAL_CORRECTIONS": (
        "Поправки не читает ни один расчёт, код в данных не хранится — связей "
        "быть не может."
    ),
}

#: Системные коды, зашитые в расчёты раздела (бакетирование расхода, журнал
#: штаба): снимать, удалять и заменять их нельзя.
PROTECTED_CODES = frozenset({
    ("EVENT_PARTICIPATION_KINDS", "PHYSICAL_SQUAD"),
    ("JOURNAL_ENTRY_TYPES", "INSTRUCTION"),
    ("JOURNAL_ENTRY_TYPES", "ORDER"),
    ("JOURNAL_ENTRY_TYPES", "INCIDENT"),
    ("JOURNAL_ENTRY_TYPES", "REPLACEMENT"),
})


def _require_dictionary(code):
    if code not in _CODES:
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"code": str(code)},
            message="Справочник не найден.",
        )


def _json_values(node, key):
    """Все значения ключа `key` в произвольно вложенном JSON."""
    if isinstance(node, dict):
        for name, value in node.items():
            if name == key and isinstance(value, str) and value:
                yield value
            else:
                yield from _json_values(value, key)
    elif isinstance(node, list):
        for item in node:
            yield from _json_values(item, key)


class _Carriers:
    """Накопитель связей: код → источник → (сколько, первые носители).

    Носителей хранится РОВНО СТОЛЬКО, сколько уходит в ответ (`_SAMPLE_LIMIT`),
    а число считается счётчиком. Копить их целиком и резать в конце значило бы
    держать в памяти строку на каждую ссылку справочника — на каждый GET
    списка значений.
    """

    _SAMPLE_LIMIT = 3

    def __init__(self):
        self._rows = {}

    def add(self, code, source, sample):
        if not code:
            return
        sources = self._rows.setdefault(code, {})
        count, samples = sources.get(source, (0, []))
        if len(samples) < self._SAMPLE_LIMIT:
            samples.append(sample)
        sources[source] = (count + 1, samples)

    def as_references(self):
        return {
            code: [
                {"sourceLabel": source, "count": count, "samples": samples}
                for source, (count, samples) in sources.items()
            ]
            for code, sources in self._rows.items()
        }


def _event_scan(dictionary_code, carriers):
    """Один проход по JSON событий — для всех кодов сразу."""
    fields = (
        "code", "journal_entries", "placement_assignments",
        "recon_sector_posts", "force_requests", "force_allocation",
    )
    for code, journals, placements, recon, requests, allocation in (
        OpsSecurityEvent.objects.values_list(*fields).iterator()
    ):
        if dictionary_code == "JOURNAL_ENTRY_TYPES":
            for journal in journals or []:
                if isinstance(journal, dict) and journal.get("type"):
                    label = _JOURNAL_TYPE_LABEL.get(journal["type"], journal["type"])
                    carriers.add(journal["type"], f"Журналы ОМ ({label})",
                                 f"{code}: {journal.get('title')}")
        elif dictionary_code == "PLACEMENT_ROLES":
            for value in _json_values(placements, "roleCode"):
                carriers.add(value, "Расстановка ОМ", code)
        elif dictionary_code == "PLACEMENT_SECTIONS":
            for value in _json_values(placements, "sectionCode"):
                carriers.add(value, "Расстановка ОМ", code)
        elif dictionary_code == _PARTICIPATION_DICTIONARY:
            for value in _json_values(recon, "demandKindCode"):
                carriers.add(value, "Расчёт постов ОМ", code)
            for value in _json_values(requests, "kindCode"):
                carriers.add(value, "Запросы сил ОМ", code)
            for value in _json_values(allocation, "kindCode"):
                carriers.add(value, "Выделение сил ОМ", code)
        elif dictionary_code == "EVENT_GROUP_ROLES":
            for value in _json_values(allocation, "roleCode"):
                carriers.add(value, "Выделение сил ОМ", code)


def collect_usage(dictionary_code):
    """Связи всех значений справочника одним заходом: код → ссылки."""
    carriers = _Carriers()
    if dictionary_code == "SERVICE_DUTY_KINDS":
        from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
        for code, pk in OpsDutyLogEntry.objects.values_list("service_duty_code", "pk"):
            carriers.add(code, "Журнал дежурств", f"Запись №{pk}")
        for code, source, pk in OpsDutyRecordSupplement.objects.exclude(service_duty_code="").values_list("service_duty_code", "source_type", "source_id"):
            carriers.add(code, "Расстановка дежурств" if source == "DISPATCH" else "План дежурств", f"Запись №{pk}")
    # Справочник-РОДИТЕЛЬ групп: его значение держат дети через `group_code`.
    # Ищем ребёнка в общей карте, а не по литеральной паре: пар стало две
    # (требования постов и роли внутри группы), и вторая литеральная ветка
    # разошлась бы с первой на первой же правке (Plane №274).
    child_code = next(
        (child for child, parent in GROUP_PARENT.items() if parent == dictionary_code),
        None,
    )
    if child_code is not None:
        for group_code, label in OpsDictionaryEntry.objects.filter(
            dictionary_code=child_code, group_code__isnull=False
        ).values_list("group_code", "label"):
            carriers.add(group_code, _CHILD_LABEL.get(child_code, child_code), label)
    if dictionary_code in (
        "JOURNAL_ENTRY_TYPES", "PLACEMENT_ROLES", "PLACEMENT_SECTIONS",
        _PARTICIPATION_DICTIONARY, "EVENT_GROUP_ROLES",
    ):
        _event_scan(dictionary_code, carriers)
    if dictionary_code == _PARTICIPATION_DICTIONARY:
        # Импорт локальный, как у внешних справочников: `apps.ops` не тянет
        # модели `apps.operations` на уровне модуля.
        from organization_management.apps.operations.models_forces import (
            OpsForceCampaignAssignment, OpsForceCampaignPoolMember,
        )
        from organization_management.apps.operations.models_status import OpsStatusParticipation

        for kind, event_id, status_id in OpsStatusParticipation.objects.values_list(
            "kind_code", "event_id", "status_id"
        ):
            carriers.add(kind, "Участия в мероприятиях", f"ОМ {event_id}, статус {status_id}")
        for kind, event_id in OpsForceCampaignAssignment.objects.values_list("kind_code", "event_id"):
            carriers.add(kind, "Назначения из общего пула", f"ОМ {event_id}")
        for kind, name in OpsForceCampaignPoolMember.objects.filter(
            removed_at__isnull=True
        ).values_list("kind_code", "employee_name"):
            carriers.add(kind, "Общий пул сил", name or "сотрудник")
    if dictionary_code == "EVENT_GROUP_ROLES":
        from organization_management.apps.operations.models_status import OpsStatusParticipation

        for role, event_id, status_id in OpsStatusParticipation.objects.exclude(
            role_code=""
        ).values_list("role_code", "event_id", "status_id"):
            carriers.add(role, "Участия в мероприятиях", f"ОМ {event_id}, статус {status_id}")
    return carriers.as_references()


#: Метка «сборщик упал»: список передаёт её строкам вместо карты связей.
#: Отказ сборщика — это `UNKNOWN` у каждой строки (удаление запрещено), а не
#: пятисотка на весь экран справочника.
_COLLECT_FAILED = object()


def _unknown_usage():
    return {
        "status": "UNKNOWN",
        "reason": "Связи посчитать не удалось — удаление запрещено, используйте деактивацию.",
        "references": [], "totalCount": 0,
    }


def usage_of(entry, collected=None):
    """Связи одного значения. `collected` — готовая карта `collect_usage`,
    чтобы список не собирал её заново на каждую строку; `_COLLECT_FAILED` —
    её несостоявшийся сбор."""
    if collected is _COLLECT_FAILED:
        return _unknown_usage()
    try:
        references = (
            collected if collected is not None
            else collect_usage(entry.dictionary_code)
        ).get(entry.code, [])
    except Exception:
        logger.exception("Связи справочника %s посчитать не удалось", entry.dictionary_code)
        return _unknown_usage()
    return {
        "status": "TRACKED",
        "reason": _FREE_TEXT_REASON.get(entry.dictionary_code),
        "references": references,
        "totalCount": sum(ref["count"] for ref in references),
    }


def _division_context(entries, actor_id):
    """Владельцы и пути групп одним чтением дерева, без N+1."""
    owner_ids = {
        entry.owner_division_id for entry in entries
        if entry.dictionary_code == _PARTICIPATION_DICTIONARY
        and entry.code != _PHYSICAL_SQUAD
        and entry.owner_division_id is not None
    }
    if not owner_ids:
        return {}, set()

    divisions = {
        row["id"]: row
        for row in Division.objects.filter(is_active=True).values(
            "id", "name", "parent_id"
        )
    }

    def path_of(division_id):
        names = []
        visited = set()
        current = divisions.get(division_id)
        while current is not None and current["id"] not in visited:
            visited.add(current["id"])
            names.append(current["name"])
            current = divisions.get(current["parent_id"])
        return " / ".join(reversed(names))

    owners = {
        owner_id: {
            "name": divisions[owner_id]["name"],
            "path": path_of(owner_id),
        }
        for owner_id in owner_ids
        if owner_id in divisions
    }
    from organization_management.apps.operations.services import PermissionService

    visible = PermissionService.visible_division_ids(actor_id, "status.manage")
    own_ids = owner_ids if visible is None else owner_ids.intersection(visible)
    return owners, own_ids


def _successor_of(entry):
    """Преемник записи, если есть. `superseded_by` — обратная связь; список
    предзагружает её, чтобы не ходить в базу на каждую строку."""
    successor = next(iter(entry.superseded_by.all()), None)
    if successor is None:
        return None
    return {"id": str(successor.pk), "code": successor.code}


def serialize_entry(entry, *, owners=None, own_ids=None, usage=None):
    owners = owners or {}
    own_ids = own_ids or set()
    owner = owners.get(entry.owner_division_id)
    result = {
        "id": str(entry.pk),
        "dictionaryCode": entry.dictionary_code,
        "code": entry.code,
        "label": entry.label,
        "labelKk": entry.label_kk,
        "description": entry.description,
        "isActive": entry.is_active,
        "groupCode": entry.group_code,
        "updatedAt": entry.updated_at.isoformat(),
        "usage": usage if usage is not None else usage_of(entry),
        "inactiveSince": (
            entry.inactive_since.isoformat() if entry.inactive_since else None
        ),
        "supersedes": (
            {"id": str(entry.supersedes_id), "code": entry.supersedes.code}
            if entry.supersedes_id else None
        ),
        "supersededBy": _successor_of(entry),
    }
    if entry.dictionary_code == _PARTICIPATION_DICTIONARY:
        result.update({
            "ownerDivisionId": (
                str(entry.owner_division_id)
                if owner is not None else None
            ),
            "ownerDivisionName": owner["name"] if owner is not None else None,
            "ownerDivisionPath": owner["path"] if owner is not None else None,
            "isOwn": entry.owner_division_id in own_ids,
        })
    return result


#: Справочники раздела, живущие СВОЕЙ таблицей, а не generic-реестром.
#:
#: Заказчик завёл тип статуса в админке и не нашёл его на экране «Система →
#: Справочники» (Plane №344): реестр показывал только `OpsDictionaryEntry`, а
#: типы статусов — отдельная таблица со своими полями (приоритет, колонка
#: расхода, жёсткая блокировка, предельный срок). Реестр справочников обязан
#: перечислять ВСЕ справочники раздела, иначе он отвечает на вопрос «какие у
#: нас справочники» неправдой.
#:
#: 🔴 ЭТИ СТРОКИ НЕ ПОПАДАЮТ В `DEFINITIONS`, и это не оплошность. `_CODES`
#: собирается из `DEFINITIONS` и охраняет `entries`/`create_entry`: попади код
#: туда, generic-ручка приняла бы его и попыталась завести `OpsDictionaryEntry`
#: с чужим `dictionary_code` — а его отбивает CHECK-constraint таблицы, то есть
#: ошибка вылезла бы из базы, а не из проверки. Реестр перечисляет — правит
#: каждый своей ручкой.
EXTERNAL_DEFINITIONS = [
    {
        "code": "STATUS_TYPES",
        "label": "Типы статусов сотрудников",
        "description": (
            "Каталог статусов раздела ОМ: приоритет, колонка суточного "
            "расхода, жёсткая блокировка, предельный срок."
        ),
        # Экран значений — свой; generic-адрес `/dictionaries/<код>/entries`
        # этот справочник не обслуживает и обслуживать не должен.
        "screen": "status-types",
        # Правится сидом (`seed_status_types`), а не экраном: клиент обязан
        # знать это до того, как нарисует кнопку «Добавить значение».
        "readOnly": True,
    },
]


def _external_definitions_with_counts():
    """Счётчики внешних справочников — по их СОБСТВЕННЫМ таблицам.

    Импорт локальный: `apps.ops` не должен тянуть модели `apps.operations` на
    уровне модуля — это замкнуло бы импорт через `models_settings`.
    """
    from organization_management.apps.operations.status_types import StatusType
    from organization_management.apps.dictionaries.models import Position, Rank
    from organization_management.apps.operations.models_geo import OpsCountry, OpsCity

    counts = {
        "STATUS_TYPES": (
            StatusType.objects.count(),
            StatusType.objects.filter(is_active=True).count(),
        ),
    }
    models = {"POSITIONS": Position, "RANKS": Rank, "COUNTRIES": OpsCountry, "CITIES": OpsCity}
    definitions = EXTERNAL_DEFINITIONS + [
        {"code": "POSITIONS", "label": "Должности", "description": "Должности штатного расписания", "screen": "personnel/positions", "readOnly": False},
        {"code": "RANKS", "label": "Звания", "description": "Звания сотрудников", "screen": "personnel/ranks", "readOnly": False},
        {"code": "COUNTRIES", "label": "Страны", "description": "Страны проведения мероприятий", "screen": "geo/countries", "readOnly": False},
        {"code": "CITIES", "label": "Города", "description": "Города по странам", "screen": "geo/cities", "readOnly": False},
    ]
    counts.update({code: (model.objects.count(), model.objects.filter(is_active=True).count()) for code, model in models.items()})
    results = []
    for definition in definitions:
        total, active = counts[definition["code"]]
        results.append(
            {**definition, "totalCount": total, "activeCount": active}
        )
    return results


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
                # Поля внешних справочников проставляются и здесь, а не только
                # там: строка без `screen` читалась бы клиентом как undefined,
                # и разбирающемуся пришлось бы гадать, забыли её или у неё нет
                # своего экрана.
                "screen": None,
                "readOnly": False,
                "totalCount": len(own),
                "activeCount": sum(1 for row in own if row[1]),
            }
        )
    return results + _external_definitions_with_counts()


def list_entries(dictionary_code, *, actor_id=None):
    _require_dictionary(dictionary_code)
    entries = list(
        OpsDictionaryEntry.objects.filter(dictionary_code=dictionary_code)
        .select_related("supersedes")
        .prefetch_related("superseded_by")
    )
    owners, own_ids = _division_context(entries, actor_id)
    # Карта связей одна на весь справочник: собирать её на каждую строку
    # значило бы проход по всем мероприятиям столько раз, сколько значений.
    try:
        collected = collect_usage(dictionary_code)
    except Exception:
        logger.exception("Связи справочника %s посчитать не удалось", dictionary_code)
        collected = _COLLECT_FAILED
    rows = [
        serialize_entry(
            entry, owners=owners, own_ids=own_ids,
            usage=usage_of(entry, collected=collected),
        )
        for entry in entries
    ]
    from organization_management.apps.dictionaries.review import change_metadata, add_replacement_families
    changes = change_metadata(audit_service.ENTITY_DICTIONARY_ENTRY, [entry.pk for entry in entries])
    for row in rows:
        row["lastChange"] = changes.get(int(row["id"]))
    return add_replacement_families(rows, predecessor_key="supersedes", active_key="isActive")


def _validated_owner(dictionary_code, code, owner_division_id, field_errors):
    """Проверить владельца специальной группы и вернуть нормализованный id."""
    if dictionary_code != _PARTICIPATION_DICTIONARY:
        return None
    if code == _PHYSICAL_SQUAD:
        if owner_division_id not in (None, ""):
            field_errors["ownerDivisionId"] = [
                "Физнаряд не принадлежит отдельному подразделению."
            ]
        return None
    if owner_division_id in (None, ""):
        field_errors["ownerDivisionId"] = [
            "Для специальной группы выберите подразделение-владельца."
        ]
        return None
    try:
        normalized = int(owner_division_id)
    except (TypeError, ValueError):
        normalized = None
    if normalized is None or not Division.objects.filter(
        pk=normalized, is_active=True
    ).exists():
        field_errors["ownerDivisionId"] = [
            "Подразделение не найдено или неактивно."
        ]
        return None
    return normalized


@transaction.atomic
def create_entry(dictionary_code, *, code, label, description, group_code,
                 label_kk="", owner_division_id=None, supersedes=None, actor):
    _require_dictionary(dictionary_code)
    field_errors = {}
    code = str(code or "").strip().upper()
    if dictionary_code == "SERVICE_DUTY_KINDS" and not code:
        code = "DUTY_" + uuid4().hex.upper()
    if code == "":
        field_errors["code"] = ["Обязательное поле."]
    if len(code) > 100:
        field_errors["code"] = ["Не более 100 символов."]
    if len(str(label or "").strip()) > 255:
        field_errors["label"] = ["Не более 255 символов."]
    if not str(label or "").strip():
        field_errors["label"] = ["Обязательное поле."]
    if len(str(label_kk or "").strip()) > 255:
        field_errors["labelKk"] = ["Не более 255 символов."]
    if code and OpsDictionaryEntry.objects.filter(
        dictionary_code=dictionary_code, code=code
    ).exists():
        field_errors["code"] = ["Код уже используется в этом справочнике."]
    owner_division_id = _validated_owner(
        dictionary_code, code, owner_division_id, field_errors
    )
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
        label_kk=str(label_kk or "").strip(),
        description=str(description or "").strip(),
        is_active=True,
        group_code=(group_code or None) if group_parent is not None else None,
        owner_division_id=owner_division_id,
        supersedes=supersedes,
        updated_by=actor,
    )
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_CREATED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        new_value={
            "dictionary": dictionary_code, "code": code, "label": entry.label,
            "labelKk": entry.label_kk,
            "ownerDivisionId": owner_division_id,
            "supersedes": supersedes.code if supersedes is not None else None,
        },
    )
    return entry


@transaction.atomic
def update_entry(
    entry_id, *, label, description, group_code, label_kk=UNSET,
    owner_division_id=UNSET, actor
):
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
    if not entry.is_active:
        raise DomainError("DICTIONARY_ENTRY_INACTIVE", 409, message="Корректировать можно только активное значение.")
    field_errors = {}
    if not str(label or "").strip():
        field_errors["label"] = ["Обязательное поле."]
    if len(str(label or "").strip()) > 255:
        field_errors["label"] = ["Не более 255 символов."]
    if label_kk is not UNSET and len(str(label_kk or "").strip()) > 255:
        field_errors["labelKk"] = ["Не более 255 символов."]
    group_parent = GROUP_PARENT.get(entry.dictionary_code)
    wants_group = group_parent is not None
    normalized_owner = entry.owner_division_id
    if owner_division_id is not UNSET:
        normalized_owner = _validated_owner(
            entry.dictionary_code, entry.code, owner_division_id, field_errors
        )
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
        "labelKk": entry.label_kk,
        "description": entry.description,
        "groupCode": entry.group_code,
        "ownerDivisionId": entry.owner_division_id,
    }
    entry.label = str(label).strip()
    if label_kk is not UNSET:
        entry.label_kk = str(label_kk or "").strip()
    entry.description = str(description or "").strip()
    if wants_group:
        entry.group_code = group_code or None
    if owner_division_id is not UNSET:
        entry.owner_division_id = normalized_owner
    entry.updated_by = actor
    entry.save(
        update_fields=[
            "label", "label_kk", "description", "group_code", "owner_division_id",
            "updated_by", "updated_at",
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
            "labelKk": entry.label_kk,
            "description": entry.description,
            "groupCode": entry.group_code,
            "ownerDivisionId": entry.owner_division_id,
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


def _require_unprotected(entry):
    if (entry.dictionary_code, entry.code) in PROTECTED_CODES:
        raise DomainError(
            "DICTIONARY_ENTRY_PROTECTED", 422,
            detail={"code": entry.code},
            message="Системное значение: его нельзя снять, удалить или заменить, только исправить подпись.",
        )


def _has_successor(entry):
    return entry.superseded_by.exists()


@transaction.atomic
def set_entry_active(entry_id, *, is_active, actor, reason=""):
    entry = _lock_entry(entry_id)
    if not isinstance(is_active, bool):
        raise DomainError("VALIDATION_ERROR", 400, detail={"isActive": ["Укажите true или false."]})
    wanted = is_active
    if not wanted:
        _require_unprotected(entry)
    elif _has_successor(entry):
        raise DomainError(
            "DICTIONARY_ENTRY_SUPERSEDED", 409,
            detail={"code": entry.code},
            message="У значения есть преемник — прежнее остаётся историей и не активируется.",
        )
    old = {"label": entry.label, "labelKk": entry.label_kk, "code": entry.code, "isActive": entry.is_active,
           "inactiveSince": entry.inactive_since.isoformat() if entry.inactive_since else None}
    entry.is_active = wanted
    if wanted:
        entry.inactive_since = None
    elif entry.inactive_since is None:
        entry.inactive_since = Clock.today_local()
    entry.updated_by = actor
    entry.save(update_fields=["is_active", "inactive_since", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_SET_ACTIVE,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value=old,
        new_value={"label": entry.label, "labelKk": entry.label_kk, "code": entry.code, "isActive": entry.is_active,
                   "inactiveSince": entry.inactive_since.isoformat() if entry.inactive_since else None},
        reason=reason,
    )
    return entry


@transaction.atomic
def supersede_entry(entry_id, *, code, label, label_kk=UNSET, description=UNSET,
                    group_code=UNSET, owner_division_id=UNSET, actor):
    """«Редактирование по сути»: новая запись взамен прежней.

    Прежняя закрывается для нового выбора (is_active=False, дата
    неактуальности), но остаётся в старых данных: на неё ссылаются по коду.

    НЕНАЗВАННОЕ ПОЛЕ НАСЛЕДУЕТСЯ, А НЕ ОЧИЩАЕТСЯ (`UNSET`, как у
    `update_entry`). Тело замены повторяет форму заведения, и клиент, приславший
    только код с названием, менял бы смысл записи молча: роль теряла бы группу,
    специальная группа — подразделение-владельца, а запись — казахскую подпись.
    Очистка остаётся возможной — ключ с пустым значением.
    """
    old = _lock_entry(entry_id)
    _require_unprotected(old)
    if not old.is_active:
        raise DomainError(
            "DICTIONARY_ENTRY_INACTIVE", 409,
            detail={"code": old.code},
            message="Заменить можно только активное значение.",
        )
    successor = create_entry(
        old.dictionary_code, code=code, label=label,
        label_kk=old.label_kk if label_kk is UNSET else label_kk,
        description=old.description if description is UNSET else description,
        group_code=old.group_code if group_code is UNSET else group_code,
        owner_division_id=(
            old.owner_division_id if owner_division_id is UNSET
            else owner_division_id
        ),
        actor=actor, supersedes=old,
    )
    old.is_active = False
    old.inactive_since = Clock.today_local()
    old.updated_by = actor
    old.save(update_fields=["is_active", "inactive_since", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_SUPERSEDED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=old.pk,
        old_value={"code": old.code, "label": old.label, "isActive": True},
        new_value={"successorId": successor.pk, "successorCode": successor.code, "successorLabel": successor.label, "successorLabelKk": successor.label_kk,
                   "inactiveSince": old.inactive_since.isoformat()},
    )
    return successor


@transaction.atomic
def remove_entry(entry_id, *, actor, deactivate_when_used=True):
    """Удаление по правилу UC-REF-001: нет связей — физически, есть —
    деактивация с датой. Возвращает ("deleted", None) или ("deactivated", entry)."""
    entry = _lock_entry(entry_id)
    _require_unprotected(entry)
    if _has_successor(entry):
        raise DomainError(
            "DICTIONARY_ENTRY_SUPERSEDED", 409,
            detail={"code": entry.code},
            message="У значения есть преемник — прежнее остаётся историей и не удаляется.",
        )
    usage = usage_of(entry)
    if usage["status"] != "TRACKED":
        raise DomainError(
            "DICTIONARY_USAGE_UNKNOWN", 422,
            message=usage["reason"] or "Связи посчитать не удалось — удаление запрещено.",
        )
    if usage["totalCount"] > 0:
        joined = "; ".join(
            f"{ref['sourceLabel']} — {', '.join(ref['samples'])}"
            for ref in usage["references"]
        )
        if not deactivate_when_used:
            raise DomainError(
                "DICTIONARY_ENTRY_IN_USE", 409,
                detail={"usage": usage},
                message=f"Значение используется ({usage['totalCount']}): {joined}.",
            )
        if entry.is_active:
            entry = set_entry_active(
                entry.pk, is_active=False, actor=actor,
                reason=f"удаление при наличии связей ({usage['totalCount']}): {joined}",
            )
        return "deactivated", entry
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_DELETED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value={"dictionary": entry.dictionary_code, "code": entry.code, "label": entry.label},
    )
    entry.delete()
    return "deleted", None


def delete_entry(entry_id, *, actor):
    """Только физическое удаление (админка Django): со связями — 409, как раньше."""
    result, _ = remove_entry(entry_id, actor=actor, deactivate_when_used=False)
    if result != "deleted":
        # Смена умолчания `remove_entry` не вправе превратить удаление в
        # админке в тихую деактивацию: админка обещает удалить или отказать.
        raise RuntimeError(
            f"delete_entry ожидал удаление записи {entry_id}, получил {result!r}"
        )
