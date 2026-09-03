"""Уведомления начальникам управлений о запросе сил (Plane №392, `[СБС-22]`).

Спецификация: «Кнопка „Отправить в управления“ → уведомления начальникам со
ссылкой». До этого шага `notify_directorates` ставила управлению только
МОМЕНТ оповещения (`notifiedAt`) — персональной рассылки не было сознательно:
связи «учётка ↔ начальник управления» тогда не существовало (см. докстринг
`notify_directorates`). С ролями и областями (Plane №74) она есть: начальник
управления — учётка с ролью, чья область — ЭТО управление.

КТО ПОЛУЧАЕТ. Учётки с активной ролью, у которой `scope_division_id` равен
управлению — РОВНО ему, а не предкам: запрос адресован управлению, и
ответственный за департамент (область выше) его и отправляет — слать ему же
его собственный запрос было бы шумом. Это осознанное отличие от
`acknowledgement_notify._supervisor_users`, где берутся все предки:
заступление подчинённого касается каждого уровня над ним, запрос сил —
одного.

«ОДНО НА ДЕНЬ» — ключ модели уведомлений (получатель, вид, деловая дата):
начальник управления, запрошенный в один день по двум мероприятиям, получит
одно уведомление с payload ПЕРВОГО. В payload лежит код мероприятия и
идентификатор заявки — по ним видно, о чём речь, а второе мероприятие того же
дня он увидит на экране статусов баннером (`[СБС-30]`, Plane №394).

Модуль отдельный, а не функция внутри `security_events.py`: у рассылки свой
предмет (кому и что), и держать её рядом с правилами раскладки значило бы
растить файл, в котором и так под пять тысяч строк.
"""
from organization_management.apps.operations import notify_service

#: Вид уведомления. Заведён в модели вместе с этим шагом (миграция 0074).
KIND = "FORCES_REQUEST"


def _directorate_heads(division_ids):
    """Учётки с областью РОВНО на управление: {division_id → {user_id, …}}."""
    from organization_management.apps.operations.models import UserRole

    heads = {str(pk): set() for pk in division_ids}
    if not division_ids:
        return heads
    rows = UserRole.objects.filter(
        is_active=True, scope_division_id__in=list(division_ids)
    ).values_list("scope_division_id", "user_id")
    for division_id, user_id in rows:
        heads.setdefault(str(division_id), set()).add(str(user_id))
    return heads


def notify_directorate_heads(event, allocation, directorates):
    """Разослать запрос сил начальникам управлений заявки.

    `directorates` — строки управлений заявки (`{divisionId, name, need,
    …}`), как их держит `force_allocation[].directorates`. Возвращает отчёт:
    сколько учёток уведомлено и у каких управлений начальника не нашлось —
    поимённо, а не числом: «двоим не дошло» не говорит, кому, и чинить это
    некому.
    """
    ids = [int(row["divisionId"]) for row in directorates if str(row.get("divisionId", "")).isdigit()]
    heads = _directorate_heads(ids)
    notified, headless = 0, []
    for row in directorates:
        key = str(row.get("divisionId"))
        users = heads.get(key, set())
        if not users:
            headless.append(row.get("name") or key)
            continue
        payload = {
            "eventId": str(event.pk),
            "eventCode": event.code,
            "eventTitle": event.title,
            "businessDate": event.business_date.isoformat(),
            "allocationId": allocation.get("id"),
            "departmentName": allocation.get("departmentName", ""),
            "directorateId": key,
            "directorateName": row.get("name", ""),
            # Сколько просят с ЭТОГО управления — цифра раскладки департамента.
            "need": int(row.get("need") or 0),
            "dueAt": allocation.get("dueAt"),
        }
        for user_id in users:
            notify_service.notify(user_id, KIND, event.business_date, payload)
            notified += 1
    return {"notified": notified, "headlessDirectorates": headless}
