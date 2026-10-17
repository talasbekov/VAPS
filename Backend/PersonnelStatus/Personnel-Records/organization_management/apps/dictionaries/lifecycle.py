"""Жизненный цикл кадровых справочников (UC-REF-001, подпроект 2).

Зеркало сервиса значений ОМ (`apps/ops/dictionaries.py`) для должностей и
званий: связи, деактивация с датой, запись-преемник, удаление по связям.
Аудит пишется в общий журнал раздела своими сущностями `position`/`rank`.
"""
from django.db import transaction
from django.db.models import Q

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.operations.models_geo import OpsCountry, OpsCity
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError

ENTITY_OF = {Position: audit_service.ENTITY_POSITION, Rank: audit_service.ENTITY_RANK,
             OpsCountry: audit_service.ENTITY_COUNTRY, OpsCity: audit_service.ENTITY_CITY}

#: Сколько носителей связи уходит в ответ и в причину аудита. Столько же
#: показывает сборщик значений ОМ (`_SAMPLE_LIMIT`).
_SAMPLE_LIMIT = 3


def _entity(instance):
    return ENTITY_OF[type(instance)]


def _code(instance):
    return getattr(instance, "code", str(instance.pk))


def _snapshot(instance):
    return {
        "code": _code(instance), "name": instance.name, "nameKk": instance.name_kk,
        "level": getattr(instance, "level", None), "isActive": instance.is_active,
        "inactiveSince": instance.inactive_since.isoformat() if instance.inactive_since else None,
    }


def _label(row):
    """Подпись носителя связи. `__str__` штатной единицы тянет подразделение,
    должность и сотрудника; любой из них может быть пустым и сам по себе
    исключения не даёт, но подпись не имеет права ронять ни ответ, ни
    удаление — поэтому падение вырождается в `#id`."""
    try:
        return str(row)
    except Exception:  # noqa: BLE001 — подпись не важнее операции
        return f"#{row.pk}"


def usage_of(instance):
    """Связи значения в форме сборщика ОМ: `{status, reason, references, totalCount}`."""
    references = []
    if isinstance(instance, (OpsCountry, OpsCity)):
        from organization_management.apps.operations.models_event import OpsSecurityEvent
        field = "country_id" if isinstance(instance, OpsCountry) else "city_id"
        events = OpsSecurityEvent.objects.filter(**{field: instance.pk})
        count = events.count()
        if count:
            references.append({"sourceLabel": "Мероприятия", "count": count,
                               "samples": [str(row) for row in events[:_SAMPLE_LIMIT]]})
        if isinstance(instance, OpsCountry):
            count = instance.cities.count()
            if count:
                references.append({"sourceLabel": "Города", "count": count,
                                   "samples": list(instance.cities.values_list("name", flat=True)[:_SAMPLE_LIMIT])})
    elif isinstance(instance, Position):
        units = list(instance.staff_units.all()[:_SAMPLE_LIMIT])
        count = instance.staff_units.count()
        if count:
            references.append({"sourceLabel": "Штатное расписание", "count": count,
                               "samples": [_label(unit) for unit in units]})
        from organization_management.apps.employees.models import EmployeeTransferHistory
        transfers = EmployeeTransferHistory.objects.filter(
            Q(from_position=instance) | Q(to_position=instance)
        )
        count = transfers.count()
        if count:
            references.append({"sourceLabel": "История перемещений", "count": count,
                               "samples": [_label(row.employee)
                                           for row in transfers.select_related("employee")[:_SAMPLE_LIMIT]]})
    else:
        employees = instance.employee_set.all()
        count = employees.count()
        if count:
            references.append({"sourceLabel": "Сотрудники", "count": count,
                               "samples": [_label(row) for row in employees[:_SAMPLE_LIMIT]]})
    return {"status": "TRACKED", "reason": None, "references": references,
            "totalCount": sum(ref["count"] for ref in references)}


def record_created(instance, *, actor):
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_CREATED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         new_value=_snapshot(instance))


def record_updated(instance, *, actor, old):
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_UPDATED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=old, new_value=_snapshot(instance))


def _has_successor(instance):
    return instance.superseded_by.exists()


def _locked(instance):
    """Та же строка, перечитанная под блокировкой.

    Решение принимается по СВЕЖЕМУ состоянию: два одновременных «заменить»
    иначе оба увидели бы запись активной и оба завели бы преемника — у
    прежней их стало бы два, а инвариант «преемник один» держится только
    сервисом. Вызывается внутри `transaction.atomic`.
    """
    return type(instance).objects.select_for_update().get(pk=instance.pk)


@transaction.atomic
def set_active(instance, *, is_active, actor, reason=""):
    instance = _locked(instance)
    if not isinstance(is_active, bool):
        raise DomainError("VALIDATION_ERROR", 400, detail={"is_active": ["Укажите true или false."]})
    wanted = is_active
    if wanted and _has_successor(instance):
        raise DomainError("DICTIONARY_ENTRY_SUPERSEDED", 409, detail={"code": _code(instance)},
                          message="У значения есть преемник — прежнее остаётся историей и не активируется.")
    old = _snapshot(instance)
    instance.is_active = wanted
    if wanted:
        instance.inactive_since = None
    elif instance.inactive_since is None:
        instance.inactive_since = Clock.today_local()
    instance.save(update_fields=["is_active", "inactive_since", "updated_at"])
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_SET_ACTIVE,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=old, new_value=_snapshot(instance), reason=reason)
    return instance


@transaction.atomic
def supersede(instance, *, data, actor):
    """`data` — validated_data сериализатора создания (name, name_kk, code, level).

    НЕНАЗВАННАЯ КАЗАХСКАЯ ПОДПИСЬ НАСЛЕДУЕТСЯ, А НЕ ОЧИЩАЕТСЯ — как у
    `supersede_entry` в сервисе ОМ. Тело замены повторяет форму заведения, и
    клиент, приславший только русское название с кодом и уровнем, молча терял
    бы казахскую подпись справочника. Очистка остаётся возможной: ключ с
    пустым значением. Отличить одно от другого можно потому, что `name_kk`
    необязателен и без умолчания у поля сериализатора — DRF не кладёт
    пропущенный ключ в `validated_data` вовсе.
    """
    instance = _locked(instance)
    if not instance.is_active:
        raise DomainError("DICTIONARY_ENTRY_INACTIVE", 409, detail={"code": _code(instance)},
                          message="Заменить можно только активное значение.")
    if "name_kk" not in data:
        data = {**data, "name_kk": instance.name_kk}
    successor = type(instance).objects.create(**data, supersedes=instance)
    instance.is_active = False
    instance.inactive_since = Clock.today_local()
    instance.save(update_fields=["is_active", "inactive_since", "updated_at"])
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_SUPERSEDED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value={"code": _code(instance), "name": instance.name, "isActive": True},
                         new_value={"successorId": successor.pk, "successorCode": _code(successor), "successorName": successor.name, "successorNameKk": successor.name_kk,
                                    "inactiveSince": instance.inactive_since.isoformat()})
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_CREATED,
                         entity_type=_entity(successor), entity_id=successor.pk,
                         new_value={**_snapshot(successor), "supersedes": _code(instance)})
    return successor


@transaction.atomic
def remove(instance, *, actor):
    """Удаление по правилу UC-REF-001: нет связей — физически, есть —
    деактивация с датой. Возвращает ("deleted", None) или ("deactivated", instance)."""
    instance = _locked(instance)
    if _has_successor(instance):
        raise DomainError("DICTIONARY_ENTRY_SUPERSEDED", 409, detail={"code": _code(instance)},
                          message="У значения есть преемник — прежнее остаётся историей и не удаляется.")
    usage = usage_of(instance)
    if usage["totalCount"] > 0:
        joined = "; ".join(f"{ref['sourceLabel']} — {', '.join(ref['samples'])}" for ref in usage["references"])
        if instance.is_active:
            instance = set_active(instance, is_active=False, actor=actor,
                                  reason=f"удаление при наличии связей ({usage['totalCount']}): {joined}")
        return "deactivated", instance
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_DELETED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=_snapshot(instance))
    instance.delete()
    return "deleted", None
