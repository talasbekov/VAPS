"""Экран сбора сил штаба на таблицах Ш-9 (`[СБС-10]`/`[СБС-11]`/`[СБС-12]`,
Plane №426, Ш-10 плана P2).

Сводка строки списка и карточки заявки СЧИТАЕТСЯ здесь, а не на клиенте:
статус «Ответы получены K из M», «Срочно», «недобор» — правила, и второй
счёт на экране разошёлся бы с сервером при первой правке. История запросов
департаменту (довыделения) читается из таблиц `[МД-06]` (№425) — у JSON
истории нет; текущее состояние по-прежнему из JSON, пока его читают экраны.
"""
import datetime as dt

from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_forces import OpsDepartmentRequest
from organization_management.apps.ops import security_events as events

#: Статусы сбора по спецификации `[СБС-10]`.
STATUS_LABELS = {
    "NEW": "Новая",
    "SENT": "Запросы отправлены",
    "ANSWERED": "Ответы получены",
    "DISTRIBUTED": "Распределено",
}

_FORCES_DEPT = "HEAD_OPS_UNIT"


def _sent_rows(allocations):
    return [r for r in allocations if r.get("status") != events._ALLOCATION_DRAFT]


def _answered(row):
    return row.get("allocating") is not None or row.get("status") in ("SUBMITTED", "ACCEPTED", "DECLINED")


def collection_status(event, allocations):
    """Новая / Запросы отправлены / Ответы получены K из M / Распределено."""
    sent = _sent_rows(allocations)
    if not sent:
        return {"code": "NEW", "label": STATUS_LABELS["NEW"], "answered": 0, "total": len(allocations)}
    # «Распределено» — состав передан на расстановку кнопкой `[СБС-13]`
    # (`force_handover`, №390). Не по стадии: после рекогносцировки ОМ стоит
    # на «Расстановке» автопроходом, а сбор при этом только начинается.
    if getattr(event, "force_handover", None):
        return {"code": "DISTRIBUTED", "label": STATUS_LABELS["DISTRIBUTED"], "answered": len(sent), "total": len(sent)}
    answered = sum(1 for r in sent if _answered(r))
    if answered == 0:
        return {"code": "SENT", "label": STATUS_LABELS["SENT"], "answered": 0, "total": len(sent)}
    return {
        "code": "ANSWERED",
        "label": f"{STATUS_LABELS['ANSWERED']} {answered} из {len(sent)}",
        "answered": answered,
        "total": len(sent),
    }


def is_urgent(event, allocations, now=None):
    """«Срочно» — просрочен срок хотя бы одной заявки или до даты ОМ не
    больше порога `APPROVAL.RETURN_URGENT_DAYS` (тот же порог, что у
    возврата расстановки, `[ВОЗ-02]`)."""
    if any(r.get("overdue") for r in allocations):
        return True
    return bool(events._is_urgent(event, None))


def totals(event, allocations):
    need = events.force_demand_total(event)
    allocating = sum(int(r.get("allocating") or 0) for r in allocations if r.get("allocating") is not None)
    sent = sum(len(r.get("members") or []) for r in allocations)
    return {
        "need": need,
        "requested": sum(int(r.get("need") or 0) for r in allocations),
        "allocating": allocating,
        "sent": sent,
        "shortage": max(0, need - sent),
    }


def need_by_object(event):
    """`[СБС-11]`: «„Мейрам“ — 8 (рекогносцировка завершена, Тлесов) · „Рахат“ — 3».

    🔴 ПОСТЫ БЕЗ ОБЪЕКТА ПОЛУЧАЮТ СВОЮ СТРОКУ (Plane №678). Разрез
    `visit_object_posts` отдаёт неразмеченный пост ЕДИНСТВЕННОМУ объекту и
    НИКОМУ, как только объектов стало двое. Для потребности объекта это верно
    — приписать чужое значило бы выдумать факт, — но на экране такие посты
    исчезали совсем: строки объектов не покрывали расчёт, а «Итого» рядом
    считалось по другому источнику, и человек видел «„Мейрам“ — 8 · „Рахат“ —
    3 · Итого 12», где 8 + 3 ≠ 12. Наряд на эти посты просят, и молчать о них
    нельзя: пусть строка честно называется «без объекта посещения».

    Строка добавляется ТОЛЬКО когда объектов несколько и такие посты есть: у
    единственного объекта они уже сидят в его числе, и вторая строка была бы
    двойным счётом.
    """
    rows = []
    visits = list(event.visit_objects.order_by("position", "pk"))
    for visit in visits:
        posts = events.visit_object_posts(event, visit)
        need = sum(int(p.get("need") or 0) for p in posts)
        assigned = sum(
            1 for a in (event.placement_assignments or [])
            if str(a.get("postId")) in {str(p.get("id")) for p in posts}
        )
        rows.append({
            "visitObjectId": str(visit.pk),
            "objectName": visit.object_name,
            "need": need,
            "statusLabel": events.visit_status_label(visit, assigned=assigned),
            "chiefName": visit.chief_name or "",
        })
    if len(visits) > 1:
        loose = sum(
            int(post.get("need") or 0)
            for post in (event.recon_sector_posts or [])
            if not str(post.get("visitObjectId") or "").strip()
        )
        if loose > 0:
            rows.append({
                # Пустой идентификатор — не объект: строка про посты, которые
                # объекту не отнесены. Клиент по нему же и отличает её.
                "visitObjectId": "",
                "objectName": "без объекта посещения",
                "need": loose,
                "statusLabel": "",
                "chiefName": "",
            })
    return rows


#: Право, которым отвечают по заявке департамента (`forces_requests`: «реестр
#: `forces/requests` гейтится `forces.allocate`, правом ДЕПАРТАМЕНТА»).
RESPONSIBLE_PERMISSION = "forces.allocate"


def _responsibles(department_ids):
    """Ответственный за сбор сил департамента — учётка, которая МОЖЕТ ответить
    по его заявке: активная роль с областью РОВНО на департамент и правом
    `forces.allocate`.

    🔴 ОТБОР ПО ПРАВУ, А НЕ ПО ОБЛАСТИ (Plane №680). Докстринг обещал «учётку
    с ролью области ровно на департамент», а запрос фильтровал ТОЛЬКО
    `is_active` и область: победить могла любая активная роль на этом
    департаменте — читатель, оператор, кто угодно. Колонка называла человека,
    который к заявке отношения не имеет.

    🔴 И ПОРЯДОК ЗАДАЁТСЯ ЯВНО. `setdefault` брал ту строку, которую Postgres
    отдал первой, а без `order_by` он вправе отдать их в любом порядке: имя в
    колонке могло меняться между двумя ОДИНАКОВЫМИ запросами. Порядок — по
    идентификатору роли: он не меняется, пока роль не переназначили.

    Право, а не список кодов ролей: отвечать по заявке умеют и «Ответственный
    за расход департамента», и «Ответственный за сбор сил», а завтра появится
    третья роль — перечисление кодов разошлось бы с правами молча, а право
    одно и проверяется тем же ключом, что и сама ручка ответа.
    """
    from organization_management.apps.operations.models import RolePermission, UserRole

    ids = [int(x) for x in department_ids if str(x).isdigit()]
    out = {str(pk): "" for pk in ids}
    if not ids:
        return out
    allowed_roles = list(
        RolePermission.objects.filter(
            permission_code_id=RESPONSIBLE_PERMISSION
        ).values_list("role_code_id", flat=True)
    )
    rows = list(
        UserRole.objects.filter(
            is_active=True,
            scope_division_id__in=ids,
            role_code_id__in=allowed_roles,
        )
        .order_by("id")
        .values_list("scope_division_id", "user_id")
    )
    names = {}
    from django.contrib.auth import get_user_model

    users = {str(u.pk): u for u in get_user_model().objects.filter(pk__in=[r[1] for r in rows if str(r[1]).isdigit()])}
    for division_id, user_id in rows:
        user = users.get(str(user_id))
        if user is None:
            continue
        label = getattr(user, "get_full_name", lambda: "")() or user.get_username()
        names.setdefault(str(division_id), label)
    out.update(names)
    return out


def history(event):
    """Строки запросов департаментам из таблиц `[МД-06]` — по ключу заявки."""
    out = {}
    for row in OpsDepartmentRequest.objects.filter(event_id=event.pk).order_by("allocation_key", "sequence"):
        out.setdefault(row.allocation_key, []).append({
            "sequence": row.sequence,
            "requested": row.requested_count,
            "allocating": row.allocating_count,
            "status": row.status,
            "dueAt": row.due_at.isoformat() if row.due_at else None,
            "recordedAt": row.created_at.isoformat(),
        })
    return out


def enrich_allocations(event, allocations):
    """Колонки `[СБС-12]`: Запрошено · Выделяют · Прислано · Комментарий · Статус · Ответственный."""
    responsible = _responsibles([r.get("departmentId") for r in allocations])
    hist = history(event)
    out = []
    for r in allocations:
        out.append({
            **r,
            "sent": len(r.get("members") or []),
            "responsibleName": responsible.get(str(r.get("departmentId")), ""),
            "history": hist.get(str(r.get("id")), []),
            "topUpOf": r.get("topUpOf"),
        })
    return out


def detail_extras(event, allocations):
    """Дополнение к `force_collection_detail` (Ш-2 №271) полями `[СБС-11]`/`[СБС-12]`."""
    return {
        "needByObject": need_by_object(event),
        "totals": totals(event, allocations),
        "boardStatus": collection_status(event, allocations),
        "urgent": is_urgent(event, allocations),
        "allocations": enrich_allocations(event, allocations),
    }


def board_row(event):
    allocations = events.allocation_members_view(event)
    status = collection_status(event, allocations)
    t = totals(event, allocations)
    return {
        "eventId": str(event.pk),
        "code": event.code,
        "title": event.title,
        "businessDate": event.business_date.isoformat(),
        "eventTime": event.event_time.strftime("%H:%M") if event.event_time is not None else None,
        "location": event.location or event.object_name,
        "stage": event.stage,
        "need": t["need"],
        "requested": t["requested"],
        "allocating": t["allocating"],
        "sent": t["sent"],
        "shortage": t["shortage"],
        # Старые поля остаются для читателей №271/№272 (снимаются после переезда).
        "allocated": t["requested"],
        "gathered": t["sent"],
        "departments": len(allocations),
        "collectionStatus": events._collection_status(allocations, t["sent"]),
        "boardStatus": status,
        "urgent": is_urgent(event, allocations),
        "isNew": status["code"] == "NEW",
        "overdueCount": sum(1 for r in allocations if r.get("overdue")),
    }


def sort_key(row):
    """`[СБС-10]`: «Срочно» — вверх, новые — сверху, дальше по дате."""
    return (0 if row["urgent"] else 1, 0 if row["isNew"] else 1, row["businessDate"], row["code"])


@transaction.atomic
def top_up(event_id, allocation_id, *, count, due_at, actor):
    """«Довыделить недобор → …» (`[СБС-12]`): НОВАЯ строка запроса тому же
    департаменту; отправленные цифры не правятся и не удаляются. Строка
    сразу отправляется (оповещение управлений тем же путём, что и первая)."""
    event = events.lock_event(event_id)
    source = events._find_allocation(event, allocation_id)
    if source.get("status") == events._ALLOCATION_DRAFT:
        raise DomainError(
            "ALLOCATION_NOT_SENT", 422,
            message="Довыделить можно только по отправленному запросу — черновик правится на месте.",
        )
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 0
    if count < 1:
        raise events._validation({"count": ["Должно быть не меньше 1."]})
    now = Clock.now()
    parsed_due = None
    if due_at:
        try:
            parsed_due = dt.datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
        except ValueError:
            raise events._validation({"dueAt": ["Неверный формат даты."]})
    key = f"force-allocation-{source.get('departmentId')}-topup-{now.isoformat()}"
    row = {
        "id": key,
        "departmentId": source.get("departmentId"),
        "departmentName": source.get("departmentName"),
        "need": count,
        # Срок — указанный, иначе срок исходного запроса, иначе стандартный.
        "dueAt": (
            parsed_due.isoformat() if parsed_due is not None
            else source.get("dueAt") or events.allocation_default_due_at(event).isoformat()
        ),
        "status": events._ALLOCATION_DRAFT,
        "comment": "",
        "members": [],
        "directorates": [
            {**d, "need": 0, "notifiedAt": None, "id": f"{key}-{d.get('divisionId')}"}
            for d in (source.get("directorates") or [])
        ],
        "topUpOf": source.get("id"),
        "createdAt": now.isoformat(),
    }
    event.force_allocation = [*event.force_allocation, row]
    event.save(update_fields=["force_allocation", "updated_at"])
    if row["directorates"]:
        event = events.notify_directorates(event.pk, key, actor=actor)
    return event
