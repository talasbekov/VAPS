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

#: Кадровая запись есть, но человек уволен (Plane №596). Причина СВОЯ, а не
#: общая с «нет привязки»: это разные положения, и человек должен понимать, что
#: с ним произошло. Учётка живёт дольше кадровой записи, и пока причины не
#: было, уволенный продолжал видеть задачу поста, требования, форму одежды и
#: вооружение — сведения о наряде, к которому он больше не имеет отношения.
DISMISSED_REASON = (
    "Сотрудник уволен — назначения закрытых нарядов больше не показываются."
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
    `event.manage`.

    🔴 ЗАМЕЩАЮЩИЙ ОБЪЕКТА — ТОЖЕ (Plane №453). Спецификация `[ОЗН-09]` даёт
    ему ту же работу по этапу, КРОМЕ «Завершить»: он видит отказ сотрудника
    заступить и обязан успеть заменить его или напомнить, а не ждать
    старшего, которого может не быть на месте. Прежнее правило знало только
    старших, и замещающий на этапе был зрителем.

    «Кроме завершить» держится НЕ здесь, а списком действий во вьюхе
    (`_EVENT_LEAD_ONLY_ACTIONS`, Plane №613): завершение переводит на
    «Проведение» мероприятие целиком, и его не отдают ни замещающему, ни даже
    старшему отдельного объекта. Разделять правило по двум местам — не
    красиво, но честно: здесь ответ на вопрос «его ли это этап», там — «какое
    действие ведёт весь ОМ».

    Замещающий-НАБЛЮДАТЕЛЬ (без `can_edit_placement`) сюда не попадает: флаг
    заведён ровно затем, чтобы отличать того, кто ВЕДЁТ объект, от внесённого
    «в список» (Plane №572).
    """
    if employee is None or not employee.is_active:
        return False
    if int(employee.pk) in _placement_chiefs(event):
        return True
    return _leads_as_deputy(event, employee)


def _leads_as_deputy(event, employee):
    """Ведёт ли этот сотрудник хоть один объект мероприятия замещающим."""
    from organization_management.apps.operations.models_event import (
        OpsVisitObjectDeputy,
    )

    return OpsVisitObjectDeputy.objects.filter(
        visit_object__event_id=event.pk,
        employee_id=employee.pk,
        can_edit_placement=True,
    ).exists()


def may_read(target_employee_id, actor_employee, allowed_division_ids):
    """Чьи назначения можно прочитать без `event.view`.

    Свои — всегда (привязка есть). Чужие — когда подразделение сотрудника
    входит в область `status.manage` актора (`None` — область не сужена).
    Область пустая или сотрудник без штатной единицы — отказ: угадывать,
    «свой ли», гейт не имеет права.

    🔴 УВОЛЕННЫЙ НЕ ЧИТАЕТ ДАЖЕ СВОЁ (Plane №596). В ветке «сам себе»
    проверки `is_active` не было, а начальники прикрыты ею через
    `_find_personnel` (он фильтрует `is_active=True`) — то есть правило
    держалось для чужих и не держалось для своих. Учётка живёт дольше
    кадровой записи, и уволенный продолжал видеть задачу поста, требования,
    форму одежды и вооружение: сведения о наряде, к которому он больше не
    имеет отношения. Соседние решения этого же модуля (`may_acknowledge`,
    `may_manage_stage`) проверяют `is_active` первой строкой — здесь то же
    правило и тот же порядок.
    """
    if actor_employee is not None and not actor_employee.is_active:
        return False
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


def _phone_of(employee_id):
    """Телефон сотрудника для строки ознакомления (`[ОЗН-03]`, Plane №452).

    Служебный, иначе личный, иначе пусто. Порядок не случаен: звонит старший
    по службе, служебный номер для этого и заведён, а личный подставляется
    только когда служебного нет — «звонить некуда» хуже, чем звонок на личный.
    """
    employee = Employee.objects.filter(pk=employee_id).only(
        "work_phone", "personal_phone"
    ).first()
    if employee is None:
        return ""
    return (employee.work_phone or employee.personal_phone or "").strip()


@transaction.atomic
def mark_viewed(employee_id):
    """Отметить, что человек ОТКРЫЛ свои назначения (`[ОЗН-02]`, Plane №452).

    🔴 ЗАЧЕМ ЗАПИСЬ НА ЧТЕНИИ. Старший на этапе «Ознакомление» видел три
    состояния — подтвердил, отказался, ждём, — и в третьем не мог отличить «не
    видел» от «видел и молчит». Это разные положения и разные действия:
    первому напомнить, второму позвонить. Другого способа узнать факт
    открытия у системы нет: карточку назначения человек читает, а не нажимает.

    ПИШЕТСЯ ОДИН РАЗ И ТОЛЬКО ДО ОТВЕТА. Условие `viewedAt is None` делает
    отметку разовой: обычное чтение списка не пишет НИЧЕГО, и запись случается
    ровно на первом заходе. После ответа факт открытия смысла не имеет —
    ответ его поглощает, — и переписывать строку ради него значило бы дёргать
    JSON мероприятия на каждом обновлении профиля.

    ТОЛЬКО СВОЙ СПИСОК. Зовётся из ветки «мои назначения» без параметра
    `?employee=`: чтение старшим чужого списка не имеет права ставить «он
    открыл» — это было бы ложью о другом человеке, да ещё и той, по которой
    решают, звонить ему или нет.
    """
    key = str(employee_id)
    stamped = 0
    # 🔴 ТОЛЬКО ЭТАП «ОЗНАКОМЛЕНИЕ», И ЭТО НЕ ПРИДИРКА (найдено ревью №825).
    # Отметка ставилась по ВСЕМ мероприятиям, где человек есть в расстановке, —
    # а профиль показывает и ГОТОВЯЩИЕСЯ назначения (`ProfileBody`: всё, что
    # раньше «Ознакомления», рисуется плашкой «назначение готовится», и кнопок
    # ответа у такой строки НЕТ вовсе). Расстановка согласуется днями; человек
    # заглядывает в профиль, видит плашку без единой кнопки — и получает
    # «открыл». Отметка разовая, поэтому она уже не обновится: к началу этапа
    # старший видит «Открыл 03.09, не ответил» и идёт звонить тому, кому было
    # не на что нажать, а корзина «не открыли» пустеет. То есть различение
    # «не видел / видел и молчит», ради которого №452 и заведена, схлопывалось
    # обратно — тем сильнее, чем дольше готовился ОМ.
    #
    # Закрытые мероприятия отсеиваются тем же отбором: `CLOSED` — не
    # `ACKNOWLEDGEMENT`. Прежде заход в профиль писал в закрытый агрегат и
    # двигал его `updated_at` («обновлено» на экране), а старший, открыв дело
    # июльского ОМ, читал «Открыл 06.09» — против правила №587/№589, которым
    # закрыты соседние `acknowledge` и `decline`.
    candidates = list(
        OpsSecurityEvent.objects.filter(
            stage="ACKNOWLEDGEMENT",
            placement_assignments__contains=[{"employeeId": key}],
        ).values_list("pk", flat=True)
    )
    for event_id in candidates:
        # 🔴 ЗАМОК, А НЕ ОДНА ТРАНЗАКЦИЯ (найдено ревью №825). Функция читает
        # `placement_assignments` целиком и сохраняет целиком; все остальные
        # писатели этого JSON (`acknowledge`, `decline`, `remind_assignment`,
        # `complete`, `move_placement`, `replace_assignment`) берут `lock_event`.
        # Транзакция без замка от потерянного обновления не спасает — она лишь
        # делает потерю атомарной: старший жмёт «Напомнить всем» ровно тогда,
        # когда назначенный открывает профиль, обе стороны переписывают весь
        # массив, побеждает последний. Пропавшая отметка читается не как
        # гонка, а как «кнопка не сработала».
        event = lock_event(event_id)
        rows = event.placement_assignments or []
        touched = False
        updated = []
        for a in rows:
            unanswered = a.get("acknowledgedAt") is None and a.get("declinedAt") is None
            if (
                str(a.get("employeeId")) == key
                and a.get("viewedAt") is None
                and unanswered
            ):
                updated.append({**a, "viewedAt": _now_iso()})
                touched = True
                stamped += 1
            else:
                updated.append(a)
        if touched:
            event.placement_assignments = updated
            event.save(update_fields=["placement_assignments", "updated_at"])
    return stamped


def assignments_of(employee_id):
    """Строки расстановки сотрудника по ВСЕМ мероприятиям — плоско, с
    мероприятием, объектом посещения и постом в каждой строке: профилю
    нужна карточка «где, когда, что делать», а не агрегат ОМ."""
    key = str(employee_id)
    rows = []
    # Телефон один на человека, а строк у него столько, сколько назначений:
    # читается ОДИН раз до цикла, иначе список из десяти нарядов стоил бы
    # десяти запросов за одним и тем же номером (`[ОЗН-03]`, Plane №452).
    phone = _phone_of(employee_id)
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
                    # 🔴 «ОТКРЫЛ И НЕ НАЖАЛ» (`[ОЗН-02]`, Plane №452). Четвёртое
                    # состояние строки, без которого старший не отличает «не
                    # видел» от «видел и молчит»: первому надо напомнить,
                    # второму — звонить. Ставится ОДИН раз, при первом чтении
                    # человеком СВОЕГО списка (см. `mark_viewed`).
                    "viewedAt": a.get("viewedAt"),
                    # ☎ В СТРОКЕ (`[ОЗН-03]`): служебный телефон, иначе личный.
                    # Порядок не случаен — звонит старший по службе, и
                    # служебный номер для этого и заведён; личный подставляется
                    # только когда служебного нет, потому что «звонить некуда»
                    # хуже, чем звонок на личный. Пусто — телефона нет ни
                    # одного, и строка честно молчит.
                    "phone": phone,
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
    # 🔴 ОБ ОТКАЗЕ УЗНАЮТ СРАЗУ, А НЕ ЗАГЛЯНУВ В КАРТОЧКУ (Plane №451). До
    # этого отказ был виден только тому, кто сам откроет этап «Ознакомление»
    # в карточке ОМ, — и замену искали в день мероприятия. Рассылка идёт
    # старшему объекта, его замещающим и старшему мероприятия: заменять
    # человека им.
    #
    # Рассылка не роняет отказ: `notify_service` глотает свои беды сам, а
    # ответ ручки принадлежит сотруднику и не должен зависеть от того, дошло
    # ли письмо старшему.
    #
    # 🔴 А ВОТ ОТЧЁТ РАССЫЛКИ ТЕПЕРЬ ЧИТАЮТ (найдено ревью, задача №825).
    # Здесь стояло «отчёт здесь никто не читает» — и это описание дефекта, а
    # не довод: модуль рассылки честно считает доставленное, называет
    # поимённо тех, у кого нет учётки, и тех, кому запись не легла, — и всё
    # это выбрасывалось. Разбор «старший не узнал об отказе» упирался в
    # пустоту. Ровно ту же дыру закрыла №814 у соседней рассылки, положив
    # отчёт в запись журнала; здесь запись журнала уже есть, и отчёт кладётся
    # в неё же. Поэтому рассылка идёт ДО `audit_service.record`.
    from organization_management.apps.ops.assignment_decline_notify import (
        notify_assignment_declined,
    )

    row = next(
        (
            a
            for a in (patched.placement_assignments or [])
            if str(a.get("id")) == str(assignment_id)
        ),
        None,
    )
    delivery = {
        "notified": 0,
        "unlinked": [],
        "undelivered": [],
        "dismissed": [],
        "nobody": True,
    }
    if row is not None:
        delivery = notify_assignment_declined(patched, row, reason=text) or delivery
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
            "notified": delivery.get("notified", 0),
            "unlinked": delivery.get("unlinked", []),
            "undelivered": delivery.get("undelivered", []),
            # Уволенные — своей графой (Plane №900): без неё они лежали бы в
            # `unlinked`, и журнал звал бы заводить учётку тому, кого в наряде
            # уже нет.
            "dismissed": delivery.get("dismissed", []),
            # «Некому было слать» и «рассылка отказала» — разные беды и разная
            # починка (тот же довод, что у `unlinked` и `undelivered`).
            "nobody": bool(delivery.get("nobody", False)),
        },
    )
    return patched
