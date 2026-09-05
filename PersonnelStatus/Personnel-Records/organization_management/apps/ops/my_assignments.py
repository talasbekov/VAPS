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

from organization_management.apps.operations import audit_service
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
                    # СПОСОБ И АВТОР ОТМЕТКИ ЕДУТ К ЧИТАТЕЛЮ (Plane №722).
                    # Без них карточка сотрудника и этап «Проведение»
                    # показывали отметку, поставленную старшим «лично», ровно
                    # так же, как подтверждение самого человека, — а это
                    # разные факты: одно «я прочитал», другое «мне довели
                    # устно». Ключи те же, что в строке назначения, и пустые
                    # значения по умолчанию: у старых строк способа нет.
                    "acknowledgedVia": a.get("acknowledgedVia") or "",
                    "acknowledgedBy": a.get("acknowledgedBy") or "",
                    "declinedAt": a.get("declinedAt"),
                    "declineReason": a.get("declineReason"),
                    # КТО ВПИСАЛ ОТКАЗ (Plane №588) — рядом с текстом, а не
                    # только в журнале: читатель видит слова там же, где
                    # узнаёт, чьи они. Пусто — у строк, заведённых до правки,
                    # и у отказов без разрешимой подписи актора.
                    "declinedBy": a.get("declinedBy") or "",
                    "declinedVia": a.get("declinedVia") or "",
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


def _require_open(event, what):
    """Закрытое мероприятие ответы сотрудника не принимает (Plane №587, №589).

    Один текст на оба ответа: они закрываются одной и той же причиной, а две
    формулировки одного запрета разошлись бы при первой правке.
    """
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION", 422,
            message=f"Мероприятие закрыто — {what} уже нельзя.",
        )


def _patch_assignment(event, assignment_id, **fields):
    event.placement_assignments = [
        {**a, **fields} if str(a.get("id")) == str(assignment_id) else a
        for a in (event.placement_assignments or [])
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    return event


@transaction.atomic
def acknowledge(event_id, assignment_id, *, personal=False, actor=None, actor_name=""):
    """«Ознакомлен, заступлю»: подтверждение ставится, отказ снимается.

    Способ (`[ОЗН-05]`, Plane №447): `self` — сотрудник подтвердил сам,
    `personal` — старший отметил «Ознакомлен лично» (доведено устно); кто
    отметил — `acknowledgedBy`. Пишется в строку назначения — это и есть
    история ознакомления, которую читают лист ознакомления и дело.

    🔴 ЗАКРЫТОЕ МЕРОПРИЯТИЕ НЕ ПРАВИТСЯ (Plane №587). Гард стоял только у
    близнеца `decline`, и до №405 отсутствие его здесь было безобидно:
    подтверждение лишь ставило `acknowledgedAt`. С №405 оно ещё и СТИРАЕТ
    `declinedAt`/`declineReason` — а «отказов N» в сводке закрытия считается
    на чтении по этим полям. Один запрос на закрытый ОМ менял отчёт о УЖЕ
    ЗАКРЫТОМ мероприятии, и причина отказа терялась навсегда. Комментарий
    клиента при этом утверждал, что сервер это стережёт: верно было только
    для отказа.
    """
    event = lock_event(event_id)
    _find_assignment(event, assignment_id)
    _require_open(event, "подтвердить ознакомление")
    return _patch_assignment(
        event, assignment_id,
        acknowledgedAt=_now_iso(), declinedAt=None, declineReason=None,
        acknowledgedVia="personal" if personal else "self",
        acknowledgedBy=(actor_name or str(actor or "")) if personal else "",
    )


@transaction.atomic
def decline(
    event_id, assignment_id, reason, *, actor=None, actor_name="", personal=False
):
    """«Не могу заступить»: причина обязательна — старшему надо знать, кого
    и почему заменять; отказ без слов читался бы как сбой.

    🔴 АВТОР ЗАПИСЫВАЕТСЯ (Plane №588). Отказ читается как СЛОВА САМОГО
    СОТРУДНИКА — «Не могу заступить: …» стоит в его карточке и в листе
    «Ознакомление». А вписать их может не только он: гейт ручки пускает
    старшего и ведущего мероприятие, и это сделано намеренно (человек может
    позвонить). Пока автора не было, чужая формулировка выдавалась за его
    собственную, и опровергнуть её было нечем. Пишем оба следа: `declinedBy` в
    строке — чтобы читатель видел это там же, где текст, и запись в журнале
    мутаций — чтобы разбирательство не упиралось в строку без автора.

    СПОСОБ — ТОЙ ЖЕ МЕРКОЙ, ЧТО У ПОДТВЕРЖДЕНИЯ (`declinedVia`, ср. №447 и
    №721): `self` — сотрудник сказал сам, `personal` — записано с его слов.
    Экран различает эти два случая ПО ПОЛЮ, а не сравнением подписи автора с
    фамилией сотрудника: подписи приходят из разных источников и совпадают не
    всегда. Неизвестность читается как «сказал сам» — преуменьшение вместо
    ложного утверждения о чужих словах, тем же доводом, что в №721.
    """
    event = lock_event(event_id)
    _find_assignment(event, assignment_id)
    # 🔴 ПОРЯДОК ПРОВЕРОК ЗНАЧИМ (Plane №589). Пустая причина проверялась
    # ПЕРВОЙ, и отказ на закрытом ОМ отвечал «Проверьте заполнение формы» с
    # ошибкой поля `reason`. Человек правил текст, отправлял снова и упирался
    # в другой отказ — про этап. Состояние мероприятия старше формы: если
    # действие невозможно вовсе, форму править незачем.
    _require_open(event, "отказаться от назначения")
    text = (reason or "").strip()
    if not text:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"reason": ["Укажите причину, по которой не можете заступить."]},
            message="Проверьте заполнение формы.",
        )
    author = (actor_name or str(actor or "")).strip()
    patched = _patch_assignment(
        event, assignment_id,
        acknowledgedAt=None, declinedAt=_now_iso(), declineReason=text,
        acknowledgedVia="", acknowledgedBy="",
        declinedBy=author,
        declinedVia="personal" if personal else "self",
    )
    audit_service.record(
        actor=actor,
        action=audit_service.ASSIGNMENT_DECLINED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "assignmentId": str(assignment_id),
            "reason": text,
            "declinedBy": author,
            "via": "personal" if personal else "self",
        },
    )
    return patched
