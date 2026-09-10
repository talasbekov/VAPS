"""Уборка участий, переживших своё мероприятие (Plane №346).

ОТКУДА БЕРУТСЯ СИРОТЫ. Ссылка участия на мероприятие ПЛОСКАЯ — `event_id`
целым числом, без внешнего ключа (см. комментарий у `OpsStatusParticipation`).
Это сделано намеренно: раздел статусов не должен зависеть от таблицы
мероприятий. Плата за развязку — удаление мероприятия не уносит участия на
него, и строка остаётся ссылаться в пустоту.

ЧЕМ ЭТО ПЛОХО НА ДЕЛЕ, а не в теории. Ручка отдаёт такое участие с пустыми
`event_code` и `event_title`; нарисовать ссылку на несуществующее ОМ не может
никакой клиент, и проба `tables-data.spec.ts:289` краснеет на каждом полном
прогоне. К 31.08.2026 на стенде накопилось 1135 сирот при 14 живых участиях —
99% строк. Хуже красноты то, что сирота ЗАНИМАЕТ МЕСТО: `seed_expense_chain`
видит пересекающийся статус чужого типа и отступает («у Абаев на эти дни уже
стоит EVENT_ASSIGNMENT — сид не трогает»), то есть годного участия на стенде
не появляется вовсе.

ГРАНИЦА, КОТОРУЮ ЭТА УБОРКА НЕ ПЕРЕХОДИТ. Статус сносится ТОЛЬКО если он имел
участия и ВСЕ они оказались сиротскими. Статус без участий вовсе — законная
строка: `seed_smoke_fixtures._assignments` заводит `EVENT_ASSIGNMENT` без
единого участия, и снос «статусов без участий» уничтожил бы фикстуру,
которую сам же смоук и проверяет.

ВТОРАЯ ГРАНИЦА — МАРКЕР `UNKNOWN_EVENT_ID` (Plane №753). Строка участия с
`event_id = 0` говорит «мероприятие неизвестно», а не «мероприятие снесено»:
её завело слияние снятых кодов (`status_merge`, Plane №486) там, где вид
наряда жил В КОДЕ СТАТУСА и переносить его больше некуда. По букве
определения сироты она под уборку подпадала — и `purge_probe_events
--orphans-only` уничтожал ровно те исторические строки, ради сохранения
которых слияние и писалось.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_status import (
    UNKNOWN_EVENT_ID,
    OpsEmployeeStatus,
    OpsStatusParticipation,
)


@dataclass(frozen=True)
class CleanupResult:
    """Счёт уборки. Отдельным типом, а не парой чисел: вызывающие печатают
    его человеку, и подписи должны быть одни и те же везде."""

    participations: int
    statuses: int

    def __bool__(self) -> bool:
        return bool(self.participations or self.statuses)


@dataclass(frozen=True)
class DuplicateScan:
    """Точный план уборки повторных фактов участия (Plane №858)."""

    groups: int
    kept_ids: tuple[int, ...]
    duplicate_ids: tuple[int, ...]


@dataclass(frozen=True)
class DuplicateCleanupResult(CleanupResult):
    groups: int


def _duplicate_key(row: OpsStatusParticipation):
    status = row.status
    return (
        status.employee_id,
        row.event_id,
        status.status_type_code,
        status.date_start,
        status.date_end,
        status.source,
        status.source_ref or "",
        status.comment,
        status.document_basis,
        status.cancelled_at,
        status.cancelled_by or "",
        status.cancelled_reason,
        row.kind_code,
        row.role_code,
    )


def _scan_duplicate_participations(rows) -> DuplicateScan:
    first_by_key: dict[tuple, int] = {}
    kept_ids: list[int] = []
    duplicate_ids: list[int] = []
    duplicate_keys: set[tuple] = set()
    for row in rows:
        key = _duplicate_key(row)
        if key not in first_by_key:
            first_by_key[key] = row.pk
            continue
        if key not in duplicate_keys:
            kept_ids.append(first_by_key[key])
            duplicate_keys.add(key)
        duplicate_ids.append(row.pk)
    return DuplicateScan(
        groups=len(duplicate_keys),
        kept_ids=tuple(kept_ids),
        duplicate_ids=tuple(duplicate_ids),
    )


def find_duplicate_participations() -> DuplicateScan:
    """Найти лишь семантически одинаковые участия, сохраняя разные дни/виды.

    Пара «сотрудник + ОМ» недостаточна: одна стендовая строка ОМ законно
    используется изо дня в день, а вид участия может меняться. Дубликат —
    совпадение сотрудника, ОМ, интервала, типа статуса, вида/роли участия и
    содержательных полей статуса. Самый ранний факт остаётся каноническим.
    """
    rows = OpsStatusParticipation.objects.select_related("status").order_by(
        "created_at", "id"
    )
    return _scan_duplicate_participations(rows)


@transaction.atomic
def purge_duplicate_participations(
    actor: str = "system:purge_duplicate_participations",
) -> DuplicateCleanupResult:
    """Удалить повторные участия и только опустевшие дубли строк статуса."""
    rows = list(
        OpsStatusParticipation.objects.select_for_update()
        .select_related("status")
        .order_by("created_at", "id")
    )
    scan = _scan_duplicate_participations(rows)
    if not scan.duplicate_ids:
        return DuplicateCleanupResult(participations=0, statuses=0, groups=0)

    duplicate_id_set = set(scan.duplicate_ids)
    duplicate_rows = [row for row in rows if row.pk in duplicate_id_set]
    status_ids = sorted({row.status_id for row in duplicate_rows})
    event_ids = sorted({row.event_id for row in duplicate_rows})
    employee_ids = sorted({row.status.employee_id for row in duplicate_rows})
    OpsStatusParticipation.objects.filter(pk__in=scan.duplicate_ids).delete()

    emptied = [
        status_id
        for status_id in status_ids
        if not OpsStatusParticipation.objects.filter(status_id=status_id).exists()
    ]
    if emptied:
        OpsEmployeeStatus.objects.filter(pk__in=emptied).delete()

    result = DuplicateCleanupResult(
        participations=len(scan.duplicate_ids),
        statuses=len(emptied),
        groups=scan.groups,
    )
    audit_service.record(
        actor=actor,
        action=audit_service.STATUS_PARTICIPATIONS_PURGED,
        entity_type=audit_service.ENTITY_STATUS,
        entity_key="duplicate-participations:exact",
        old_value={
            "reason": "exact-duplicate",
            "groups": result.groups,
            "participations": result.participations,
            "statuses": result.statuses,
            "eventIds": event_ids[:100],
            "employeeIds": employee_ids[:100],
            "duplicateParticipationIds": list(scan.duplicate_ids[:100]),
            "keptParticipationIds": list(scan.kept_ids[:100]),
        },
    )
    return result


def find_orphan_participations(event_ids: list[int] | None = None):
    """Участия, чьё мероприятие не существует.

    `event_ids` сужает выборку до конкретных мероприятий — так уборка после
    удаления не трогает чужие строки. Без него — весь накопленный мусор.
    """
    # 🔴 МАРКЕР «мероприятие неизвестно» ИСКЛЮЧАЕТСЯ ПЕРВЫМ, до всех прочих
    # отборов (Plane №753). Он не сирота: у сироты мероприятие было и его
    # снесли, у маркера его не было никогда. Отбрасывать его здесь, а не в
    # `purge_*`, обязательно — `purge_probe_events --dry-run` печатает
    # найденное этой же функцией, и иначе он обещал бы снести историю.
    rows = OpsStatusParticipation.objects.exclude(event_id=UNKNOWN_EVENT_ID)
    if event_ids is not None:
        rows = rows.filter(event_id__in=event_ids)
    alive = set(
        OpsSecurityEvent.objects.filter(
            id__in=rows.values_list("event_id", flat=True)
        ).values_list("id", flat=True)
    )
    return rows.exclude(event_id__in=alive)


@transaction.atomic
def purge_orphan_participations(
    event_ids: list[int] | None = None, actor: str = "system:purge_orphans"
) -> CleanupResult:
    """Снести сиротские участия и статусы, которые ими и держались.

    `actor` попадает в журнал: уборку зовут из teardown смоука, из чистки
    пробных строк и руками, и «кто это сделал» — первый вопрос, который
    задают, увидев минус тысячу строк (Plane №356).
    """
    orphans = find_orphan_participations(event_ids)
    status_ids = sorted(set(orphans.values_list("status_id", flat=True)))
    # Идентификаторы снимаются ДО удаления — после него спрашивать не у кого.
    orphan_event_ids = list(orphans.values_list("event_id", flat=True))
    # Счёт берётся ДО удаления и по своей модели: `delete()` возвращает итог
    # вместе с каскадом, и число в отчёте перестало бы значить «участий».
    removed_participations = orphans.count()
    orphans.delete()

    # Статус сносится, только если участий у него НЕ ОСТАЛОСЬ, а были: тот,
    # у кого осталось хоть одно живое, — рабочая строка, а не мусор.
    emptied = [
        status_id
        for status_id in status_ids
        if not OpsStatusParticipation.objects.filter(status_id=status_id).exists()
    ]
    removed_statuses = len(emptied)
    if emptied:
        OpsEmployeeStatus.objects.filter(id__in=emptied).delete()
    result = CleanupResult(
        participations=removed_participations, statuses=removed_statuses
    )
    # 🔴 ЗАПИСЬ ТОЛЬКО КОГДА ЧТО-ТО СНЯТО. Уборка зовётся после КАЖДОГО прогона
    # проб и почти всегда находит пусто; строка «снято 0» на каждый запуск
    # утопила бы журнал раздела и сделала бы настоящую уборку неразличимой
    # среди сотен пустых.
    if result:
        audit_service.record(
            actor=actor,
            action=audit_service.STATUS_PARTICIPATIONS_PURGED,
            entity_type=audit_service.ENTITY_STATUS,
            # Ключ СИНТЕТИЧЕСКИЙ, и иначе быть не может: уборка снимает пачку
            # строк, а не правит одну сущность, — указать «тот самый статус»
            # здесь не на что. Журнал требует ровно один ключ, поэтому это
            # `entity_key` с областью уборки, а не выдуманный `entity_id`.
            entity_key=(
                "orphan-participations:scoped"
                if event_ids is not None
                else "orphan-participations:all"
            ),
            # Снимок кладётся в old_value целиком: строки исчезли, и журнал —
            # единственное, что о них помнит. Идентификаторы мероприятий
            # обрезаны сотней: разбирательству хватает образца, а строка
            # журнала на тысячу чисел нечитаема.
            old_value={
                "participations": result.participations,
                "statuses": result.statuses,
                "eventIds": sorted(set(orphan_event_ids))[:100],
                "eventIdsTotal": len(set(orphan_event_ids)),
                "scoped": event_ids is not None,
            },
        )
    return result
