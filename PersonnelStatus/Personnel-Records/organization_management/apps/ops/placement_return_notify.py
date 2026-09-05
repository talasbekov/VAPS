"""Уведомление о возврате расстановки объекта (Plane №400, `[ВОЗ-03]`).

Спецификация: «При возврате: … уведомление старшему объекта и замещающим
„Расстановка по объекту „…“ возвращена: N замечаний“». Возврат — решение
согласующего, а чинить его следствия — старшему объекта и замещающим; узнать
о возврате они должны сразу, а не заглянув в карточку.

КТО ПОЛУЧАЕТ. Старший объекта (`chief_employee_id`) и замещающие
(`OpsVisitObjectDeputy`) — через связь «сотрудник → учётка» (тот же
`_employee_users`, что у рассылки о заступлении). Сотрудник без учётки в
отчёт попадает поимённо, как «не дошло»: чинить это некому, если не назвать.

«ОДНО НА ОБЪЕКТ В ДЕНЬ» — ключ модели уведомлений (получатель, вид, деловая
дата, ключ дедупликации), и ключ здесь — ОБЪЕКТ ПОСЕЩЕНИЯ. Два возврата
ОДНОГО объекта в один день дадут старшему одно уведомление с payload первого:
это принято, второй возврат он увидит на самой карточке (баннер и замечания
над деревом, №397), а лента не превратится в дубли.

🔴 А ВОТ РАЗНЫЕ ОБЪЕКТЫ СХЛОПЫВАТЬСЯ НЕ ДОЛЖНЫ (Plane №586). Пока ключом был
только день, один человек — старший (или замещающий) двух объектов одного ОМ
либо двух ОМ на одну дату — о втором возврате не узнавал ВОВСЕ: второе
уведомление молча проглатывалось, а выжившее несло payload первого, и ссылка
`?visit=` вела его не к тому объекту. То есть он открывал исправный объект и
не находил замечаний, о которых ему сообщили.

«Дополнительно штабу при „Срочно“» и подъём объекта вверх в списке заявок
(`[СБС-10]`) этот шаг НЕ делает — см. Decisions: адресата «штаб» в правах
раздела пока нет (тот же открытый вопрос, что в №389), а список заявок —
область соседней карточки №390.

Модуль отдельный — по той же причине, что `forces_notify`: у рассылки свой
предмет, и растить `security_events.py` ею незачем.
"""
from organization_management.apps.operations import notify_service
from organization_management.apps.ops.acknowledgement_notify import _employee_users

KIND = "PLACEMENT_RETURNED"


def notify_placement_returned(event, visit, *, comment, remarks_open, urgent):
    """Разослать возврат старшему объекта и замещающим. Возвращает отчёт.

    🔴 СЧИТАЕТСЯ ДОСТАВЛЕННОЕ, А НЕ ПОПЫТКИ (Plane №809; тот же дефект, что
    №561 закрыла в `forces_notify`). `notify_service.notify` по замыслу
    глотает любое исключение и возвращает `None`, а счётчик рос безусловно:
    при отказе вставки для всех получателей отчёт всё равно сказал бы
    `notified: N` и пустой список недоставленного.

    Модуль заведён ровно против такого: в шапке сказано, что сотрудник без
    учётки попадает в отчёт поимённо, «чинить это некому, если не назвать».
    Отказ записи — то же самое положение, и молчать о нём нельзя тем более:
    у него, в отличие от «нет учётки», нет ни одного другого следа.

    Недоставленное — СВОЙ список, а не добавка к `unlinked`: это разные
    поводы и разная починка. «Нет учётки» чинит кадровик, отказ вставки —
    тот, кто чинит базу; свалив их в одну строку, разбор начинали бы не с
    того.
    """
    employee_ids = []
    if visit.chief_employee_id is not None:
        employee_ids.append(int(visit.chief_employee_id))
    deputies = list(visit.deputies.values_list("employee_id", "employee_name"))
    employee_ids += [int(pk) for pk, _ in deputies]
    if not employee_ids:
        # Форма отчёта ОДНА на все выходы (Plane №809): читатель не должен
        # гадать, есть ли ключ `undelivered` в этой ветке.
        return {"notified": 0, "unlinked": [], "undelivered": [], "nobody": True}
    users = _employee_users(employee_ids)
    payload = {
        "eventId": str(event.pk),
        "eventCode": event.code,
        "eventTitle": event.title,
        "businessDate": event.business_date.isoformat(),
        "visitObjectId": str(visit.pk),
        "objectName": visit.object_name,
        "comment": comment,
        "remarksOpen": int(remarks_open),
        "urgent": bool(urgent),
        "documentVersion": int(visit.document_version or 0),
    }
    notified, unlinked, undelivered = 0, [], []
    names = {str(pk): name for pk, name in deputies}
    if visit.chief_employee_id is not None:
        names[str(visit.chief_employee_id)] = visit.chief_name or str(visit.chief_employee_id)
    for employee_id in dict.fromkeys(str(pk) for pk in employee_ids):
        user_id = users.get(employee_id)
        if user_id is None:
            unlinked.append(names.get(employee_id, employee_id))
            continue
        # Ключ — объект посещения: он же и есть предмет возврата (см. шапку).
        if notify_service.notify(
            user_id, KIND, event.business_date, payload, dedupe_key=str(visit.pk)
        ) is None:
            # Имя И учётка: имя нужно тому, кто пойдёт звонить человеку,
            # учётка — тому, кто пойдёт смотреть, почему запись не легла.
            undelivered.append(f"{names.get(employee_id, employee_id)} · {user_id}")
            continue
        notified += 1
    return {
        "notified": notified,
        "unlinked": unlinked,
        "undelivered": undelivered,
        "nobody": False,
    }
