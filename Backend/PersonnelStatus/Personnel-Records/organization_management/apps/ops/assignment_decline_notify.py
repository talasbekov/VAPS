"""Уведомление об отказе сотрудника заступить (Plane №451, `[ПРФ-04]`).

Сотрудник отвечает «Не могу заступить» с причиной прямо в своём профиле. До
этого шага отказ был виден ТОЛЬКО тому, кто сам откроет этап «Ознакомление» в
карточке ОМ, — то есть узнавали о нём поздно, а замену искали в день
мероприятия.

КТО ПОЛУЧАЕТ. Старший объекта, к которому относится пост отказавшегося, его
замещающие и старший мероприятия. Замену ищут они; ведущий мероприятие —
последний рубеж, если у объекта старшего нет вовсе. Сотрудник без учётки
попадает в отчёт поимённо: чинить это некому, если не назвать (тот же довод,
что в `placement_return_notify`).

🔴 КЛЮЧ ДЕДУПЛИКАЦИИ — НАЗНАЧЕНИЕ, А НЕ ДЕНЬ. «Одно на день» здесь было бы
неправдой: отказ — СОБЫТИЕ, и за день их может быть несколько, от разных
людей. Под общим ключом (получатель, вид, дата) второй и третий отказы
проглатывались бы без следа — ровно та беда, которую разбирал №677 на ответах
департаментов. Ключ «назначение» при этом схлопывает ПОВТОРНЫЙ отказ по одному
и тому же назначению: это один и тот же факт, пересказанный дважды.

Модуль отдельный — по той же причине, что `forces_notify` и
`placement_return_notify`: у рассылки свой предмет, и растить им
`my_assignments.py` незачем.
"""
from organization_management.apps.operations import notify_service
from organization_management.apps.ops.acknowledgement_notify import (
    _employee_users,
    dismissed_employees,
)
from organization_management.apps.ops.security_events import _visit_of_post

KIND = "ASSIGNMENT_DECLINED"


def _visit_of_assignment(event, assignment):
    """Объект посещения поста, на котором стоял отказавшийся.

    🔴 ПРАВИЛО ЗДЕСЬ НЕ ПЕРЕПИСЫВАЕТСЯ, А БЕРЁТСЯ ОБЩЕЕ (найдено ревью,
    задача №825). Своя версия читала у поста `visitObjectId` и сдавалась,
    когда его нет, — но неразмеченный пост это НЕ неизвестный пост:
    неизвестен он только при ДВУХ и более объектах. У единственного объекта
    его посты — ВСЕ, включая неразмеченные, и разметки сегодня нет у
    большинства ОМ: расчёт постов ведётся на мероприятии целиком (решение
    24.08.2026), а `visitObjectId: None` пишется любой строке рекогносцировки,
    сохранённой без него; размечает посты только импорт из паспорта.

    Цена ошибки была ровно та, ради устранения которой карточка и заведена:
    на ОМ с ОДНИМ объектом и постами, заведёнными руками, старший объекта и
    его замещающие не получали НИЧЕГО, а ссылка в письме вела на мероприятие
    вместо объекта. Оставался только ведущий ОМ — а если его нет, об отказе
    не узнавал никто.
    """
    return _visit_of_post(event, assignment.get("postId"))


def notify_assignment_declined(event, assignment, *, reason):
    """Разослать отказ старшим. Возвращает отчёт той же формы, что соседи.

    Форма отчёта ОДНА на все выходы (тот же довод, что в №809): читатель не
    должен гадать, есть ли ключ в этой ветке.
    """
    visit = _visit_of_assignment(event, assignment)
    names = {}
    employee_ids = []
    if visit is not None:
        if visit.chief_employee_id is not None:
            employee_ids.append(int(visit.chief_employee_id))
            names[str(visit.chief_employee_id)] = (
                visit.chief_name or str(visit.chief_employee_id)
            )
        for pk, name in visit.deputies.values_list("employee_id", "employee_name"):
            employee_ids.append(int(pk))
            names[str(pk)] = name or str(pk)
    if event.chief_employee_id is not None:
        employee_ids.append(int(event.chief_employee_id))
        names.setdefault(
            str(event.chief_employee_id),
            event.chief_name or str(event.chief_employee_id),
        )
    if not employee_ids:
        return {
            "notified": 0,
            "unlinked": [],
            "undelivered": [],
            "dismissed": [],
            "nobody": True,
        }

    users = _employee_users(employee_ids)
    dismissed = set(dismissed_employees(employee_ids))
    payload = {
        "eventId": str(event.pk),
        "eventCode": event.code,
        "eventTitle": event.title,
        "businessDate": event.business_date.isoformat(),
        "assignmentId": str(assignment.get("id")),
        "employeeName": str(assignment.get("employeeName") or ""),
        "postId": str(assignment.get("postId") or ""),
        "reason": reason,
        # Объект нужен ссылке `?visit=`: без него старший двух объектов
        # открыл бы не тот (тот же довод, что в №586).
        "visitObjectId": "" if visit is None else str(visit.pk),
        "objectName": "" if visit is None else visit.object_name,
    }
    # Счёт ведёт общий помощник (Plane №829). Форма строки недоставленного —
    # «имя · учётка» — теперь тоже его, одна на все модули: здесь когда-то
    # стоял словарь, и одна графа журнала получалась разноформатной (№825).
    tally = notify_service.DeliveryTally()
    for employee_id in dict.fromkeys(str(pk) for pk in employee_ids):
        # Уволенный старший объекта — своей графой (Plane №900): слать ему об
        # отказе не надо, и в «нет учётки» он бы звал чинить несуществующее.
        if employee_id in dismissed:
            tally.skip_dismissed(names.get(employee_id, employee_id))
            continue
        user_id = users.get(employee_id)
        if user_id is None:
            tally.skip_unlinked(names.get(employee_id, employee_id))
            continue
        tally.deliver(
            user_id,
            KIND,
            event.business_date,
            payload,
            dedupe_key=str(assignment.get("id")),
            label=names.get(employee_id, employee_id),
        )
    return {
        "notified": tally.notified,
        "unlinked": tally.unlinked,
        "undelivered": tally.undelivered,
        "dismissed": tally.dismissed,
        "nobody": False,
    }
