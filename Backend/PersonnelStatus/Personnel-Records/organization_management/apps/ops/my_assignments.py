"""Назначения сотрудника глазами САМОГО сотрудника и его начальника
(Plane №403, `[ОЗН-09]`).

До этого профиль ходил за реестром ОМ целиком и отбирал свои строки на
клиенте, а реестр открыт только держателю `event.view` — рядовому
сотруднику (`acc_employee`) назначения не показывались никогда, и ему же
было негде подтвердить ознакомление: `acknowledge/…` стоял под
`event.manage`.

Здесь — «роль в данных», как у смен дежурств (`duty-shifts/mine`, Plane
№381): человек читает СВОИ строки, найденные по связи `User → Employee`,
а не по коду права. Начальник читает строки подчинённого по области
`status.manage` (той же, что проставляет ему статусы) — только чтение.
Штаб и админ проходят общим `event.view`.
"""
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_event import OpsSecurityEvent
from django.db import transaction

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops.security_events import (
    _now_iso,
    _placement_chiefs,
    employee_scope_division,
    lock_event,
)

UNLINKED_REASON = (
    "Учётная запись не связана с кадровой записью — назначения показать нечем."
)


def employee_of_user(user_id):
    """Кадровая запись вызывающего либо `None` — привязки нет."""
    if not user_id:
        return None
    return Employee.objects.filter(user_id=user_id).first()


def _own_assignment(event, assignment_id, employee_id):
    return any(
        str(a.get("id")) == str(assignment_id)
        and str(a.get("employeeId")) == str(employee_id)
        for a in (event.placement_assignments or [])
    )


def may_acknowledge(event, assignment_id, employee):
    """Подтвердить ознакомление без `event.manage` может тот, ЧЬЁ это
    назначение, и старший мероприятия/объекта (по данным, не по праву).

    Ведущий мероприятие проходит общим `event.manage` и сюда не попадает.
    Послабление «старший не назначен → любой» из `placement_is_led_by` здесь
    НЕ действует: подтверждение за другого — не простой, а подмена подписи.
    """
    if employee is None or not employee.is_active:
        return False
    if _own_assignment(event, assignment_id, employee.pk):
        return True
    return int(employee.pk) in _placement_chiefs(event)


def may_manage_stage(event, employee):
    """Старший мероприятия/объекта ведёт «Ознакомление» по данным
    (Plane №432, `[ОЗН-09]`): напоминает, заменяет, завершает — без
    `event.manage`."""
    if employee is None or not employee.is_active:
        return False
    return int(employee.pk) in _placement_chiefs(event)


def may_read(target_employee_id, actor_employee, allowed_division_ids):
    """Чьи назначения можно прочитать без `event.view`.

    Свои — всегда (привязка есть). Чужие — когда подразделение сотрудника
    входит в область `status.manage` актора (`None` — область не сужена).
    Область пустая или сотрудник без штатной единицы — отказ: угадывать,
    «свой ли», гейт не имеет права.
    """
    if actor_employee is not None and str(actor_employee.pk) == str(
        target_employee_id
    ):
        return True
    if allowed_division_ids is None:
        return True
    if not allowed_division_ids:
        return False
    division = employee_scope_division(target_employee_id)
    return division is not None and division in allowed_division_ids


def assignments_of(employee_id):
    """Строки расстановки сотрудника по ВСЕМ мероприятиям — плоско, с
    мероприятием, объектом посещения и постом в каждой строке: профилю
    нужна карточка «где, когда, что делать», а не агрегат ОМ."""
    key = str(employee_id)
    rows = []
    events = (
        OpsSecurityEvent.objects.filter(placement_assignments__contains=[{"employeeId": key}])
        .prefetch_related("visit_objects")
        .order_by("business_date", "code")
    )
    for event in events:
        posts = {str(p.get("id")): p for p in (event.recon_sector_posts or [])}
        visits = {str(v.pk): v.object_name for v in event.visit_objects.all()}
        for a in event.placement_assignments or []:
            if str(a.get("employeeId")) != key:
                continue
            post = posts.get(str(a.get("postId")))
            visit_id = str((post or {}).get("visitObjectId") or "") or None
            rows.append(
                {
                    "assignmentId": a.get("id"),
                    "eventId": str(event.pk),
                    "eventCode": event.code,
                    "eventTitle": event.title,
                    "eventStage": event.stage,
                    "businessDate": event.business_date.isoformat(),
                    "businessDateEnd": (
                        event.business_date_end.isoformat()
                        if event.business_date_end
                        else None
                    ),
                    "objectName": event.object_name,
                    "visitObjectId": visit_id,
                    "visitObjectName": visits.get(visit_id) if visit_id else None,
                    "postId": a.get("postId"),
                    # Пост могли снять с расчёта после назначения — строка
                    # остаётся, подпись честная.
                    "postFound": post is not None,
                    "sector": (post or {}).get("sector", ""),
                    "post": (post or {}).get("post", ""),
                    "task": (post or {}).get("task", ""),
                    "requirements": (post or {}).get("requirements", ""),
                    "uniform": (post or {}).get("uniform", ""),
                    "weapon": (post or {}).get("weapon", ""),
                    "roleCode": a.get("roleCode"),
                    "sectionCode": a.get("sectionCode"),
                    "acknowledgedAt": a.get("acknowledgedAt"),
                    "declinedAt": a.get("declinedAt"),
                    "declineReason": a.get("declineReason"),
                }
            )
    return rows


# ── Ответ сотрудника на назначение (Plane №405, `[ПРФ-04]`) ─────────────────
#
# Два ответа на карточке: «Ознакомлен, заступлю» и «Не могу заступить» с
# причиной. Оба — поля той же строки `placement_assignments`, а не отдельная
# сущность: этап «Ознакомление» считает готовность по `acknowledgedAt`, и
# отказ обязан быть виден там же, где подтверждение. Отказ снимает
# подтверждение и наоборот — два ответа разом были бы ложью.


def _find_assignment(event, assignment_id):
    if not any(
        str(a.get("id")) == str(assignment_id)
        for a in (event.placement_assignments or [])
    ):
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"id": str(assignment_id)},
            message="Назначение не найдено.",
        )


def _patch_assignment(event, assignment_id, **fields):
    event.placement_assignments = [
        {**a, **fields} if str(a.get("id")) == str(assignment_id) else a
        for a in (event.placement_assignments or [])
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    return event


@transaction.atomic
def acknowledge(event_id, assignment_id):
    """«Ознакомлен, заступлю»: подтверждение ставится, отказ снимается."""
    event = lock_event(event_id)
    _find_assignment(event, assignment_id)
    return _patch_assignment(
        event, assignment_id,
        acknowledgedAt=_now_iso(), declinedAt=None, declineReason=None,
    )


@transaction.atomic
def decline(event_id, assignment_id, reason):
    """«Не могу заступить»: причина обязательна — старшему надо знать, кого
    и почему заменять; отказ без слов читался бы как сбой."""
    event = lock_event(event_id)
    _find_assignment(event, assignment_id)
    text = (reason or "").strip()
    if not text:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"reason": ["Укажите причину, по которой не можете заступить."]},
            message="Проверьте заполнение формы.",
        )
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION", 422,
            message="Мероприятие закрыто — отказаться от назначения уже нельзя.",
        )
    return _patch_assignment(
        event, assignment_id,
        acknowledgedAt=None, declinedAt=_now_iso(), declineReason=text,
    )
