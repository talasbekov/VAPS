"""Собранные → объекты посещения → расстановка (Plane №390, `[СБС-13]`).

Спецификация: «Блок 3 „Собранные сотрудники → объекты“: слева — люди по
департаментам, справа — объекты с ёмкостью „потребность 8 / назначено 5“.
Назначение чекбоксами + „На объект…“. Кнопка „Передать на расстановку“: при
недоборе — подтверждение с комментарием».

Состав (`force_roster`) — люди, которых штаб принял (СС-5). До этого шага
состав был ОДИН на мероприятие: расстановка объекта черпала из общего пула, и
у ОМ с двумя объектами люди одного объекта предлагались на посты другого.
Теперь строка состава несёт `visitObjectId` — кому штаб отдал человека;
`null` — ещё не распределён.

Модуль отдельный от `security_events.py` — тот под пять тысяч строк и
делится с соседней сессией; здесь только распределение и передача.
"""
import datetime as dt

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops.security_events import (
    _not_found,
    _validation,
    force_collection_detail,
    force_roster_view,
    lock_event,
)


def _now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _object_capacity(event):
    """Объекты посещения с ёмкостью: потребность по расчёту постов и сколько
    людей состава уже отдано объекту. Потребность — та же, что показывает
    реестр (`_visit_placement`, Plane №387): второй счёт разошёлся бы."""
    from organization_management.apps.ops.api.serializers import _visit_placement

    visits = list(event.visit_objects.all())
    single = len(visits) == 1
    roster = event.force_roster or []
    rows = []
    for visit in visits:
        need, _assigned_posts = _visit_placement(event, visit, single=single)
        given = sum(1 for row in roster if str(row.get("visitObjectId") or "") == str(visit.pk))
        rows.append(
            {
                "visitObjectId": str(visit.pk),
                "objectName": visit.object_name,
                # `null` — расчёт постов по объекту не размечен (см. №387).
                "need": need,
                "assigned": given,
            }
        )
    return rows


def collection_with_objects(event_id):
    """Карточка сбора штаба + состав с объектами и передача."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    detail = force_collection_detail(event_id)
    event = OpsSecurityEvent.objects.get(pk=event_id)
    return {
        **detail,
        "roster": force_roster_view(event),
        "objects": _object_capacity(event),
        "handover": event.force_handover or {},
    }


@transaction.atomic
def assign_roster_objects(event_id, rows, *, actor):
    """Отдать людей состава объектам: `[{employeeId, visitObjectId|null}]`.

    Список ЦЕЛИКОМ для названных людей; не названные не трогаются — штаб
    распределяет в несколько заходов. Чужой объект — отказ по форме: объект
    обязан быть объектом ЭТОГО мероприятия.
    """
    event = lock_event(event_id)
    if event.force_handover:
        raise DomainError(
            "FORCE_HANDED_OVER",
            422,
            message="Состав уже передан на расстановку — распределение закрыто.",
        )
    known_objects = {str(v.pk) for v in event.visit_objects.all()}
    wanted = {}
    for index, row in enumerate(rows or []):
        employee_id = str(row.get("employeeId") or "").strip()
        if not employee_id:
            raise _validation({f"rows.{index}.employeeId": ["Укажите сотрудника."]})
        target = row.get("visitObjectId")
        target = None if target in (None, "") else str(target)
        if target is not None and target not in known_objects:
            raise _validation(
                {f"rows.{index}.visitObjectId": ["Объект не принадлежит мероприятию."]}
            )
        wanted[employee_id] = target
    roster = event.force_roster or []
    roster_ids = {str(r.get("employeeId")) for r in roster}
    missing = [e for e in wanted if e not in roster_ids]
    if missing:
        raise _validation({"rows": [f"Не в составе мероприятия: {', '.join(missing)}."]})
    event.force_roster = [
        {**r, "visitObjectId": wanted[str(r.get("employeeId"))]}
        if str(r.get("employeeId")) in wanted
        else r
        for r in roster
    ]
    event.save(update_fields=["force_roster", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_SPLIT,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={"code": event.code, "rosterObjects": wanted},
    )
    return collection_with_objects(event.pk)


@transaction.atomic
def hand_over_to_placement(event_id, *, comment, actor):
    """«Передать на расстановку». При недоборе по любому объекту комментарий
    обязателен — это решение штаба отдать меньше, и оно записывается."""
    event = lock_event(event_id)
    if event.force_handover:
        raise DomainError(
            "FORCE_HANDED_OVER", 422, message="Состав уже передан на расстановку."
        )
    objects = _object_capacity(event)
    shortfall = [
        {**row, "short": int(row["need"]) - int(row["assigned"])}
        for row in objects
        if row["need"] is not None and int(row["assigned"]) < int(row["need"])
    ]
    unassigned = sum(
        1 for r in (event.force_roster or []) if not r.get("visitObjectId")
    )
    if unassigned:
        raise DomainError(
            "FORCE_ROSTER_UNASSIGNED",
            422,
            message=f"Не распределены по объектам: {unassigned} чел. — сначала отдайте их объектам.",
        )
    clean = str(comment or "").strip()
    if shortfall and clean == "":
        raise _validation(
            {"comment": ["При недоборе укажите комментарий — передача с недобором."]}
        )
    event.force_handover = {
        "at": _now_iso(),
        "by": str(actor or ""),
        "comment": clean,
        "shortfall": shortfall,
    }
    event.save(update_fields=["force_handover", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_ACCEPTED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={"code": event.code, "handover": event.force_handover},
    )
    return collection_with_objects(event.pk)
