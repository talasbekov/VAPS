"""Уведомления начальникам управлений о запросе сил (Plane №392, `[СБС-22]`).

Спецификация: «Кнопка „Отправить в управления“ → уведомления начальникам со
ссылкой». До этого шага `notify_directorates` ставила управлению только
МОМЕНТ оповещения (`notifiedAt`) — персональной рассылки не было сознательно:
связи «учётка ↔ начальник управления» тогда не существовало (см. докстринг
`notify_directorates`). С ролями и областями (Plane №74) она есть: начальник
управления — учётка с ролью, чья область — ЭТО управление.

КТО ПОЛУЧАЕТ. Учётки, которые МОГУТ выделить людей (право `status.manage`,
см. `SELECT_PERMISSION` — Plane №481), с активной ролью, у которой
`scope_division_id` равен управлению — РОВНО ему, а не предкам: запрос адресован управлению, и
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


#: Право, под которым управление ВЫДЕЛЯЕТ людей по запросу (`[СБС-31]`).
#:
#: 🔴 ИМЕННО `status.manage`, А НЕ `forces.select` (Plane №481, №487). Ручек,
#: похожих на «выделение», две: `forces/allocation/<id>/members` департамента
#: гейтится `forces.select`, а та, КУДА ВЕДЁТ ЭТО УВЕДОМЛЕНИЕ, —
#: `forces/requests/<id>/directorate/select` со своим гейтом `status.manage`.
#: У профилей заказчика `forces.select` начальнику управления не выдан вовсе,
#: и фильтр по нему не оставил бы получателей ни одного.
SELECT_PERMISSION = "status.manage"

#: Грант ADMIN. Роль с «*» может всё, значит и выделить людей.
_WILDCARD = "*"


def _roles_that_may_select():
    """Коды ролей, под которыми выделение вообще возможно."""
    from organization_management.apps.operations.models import RolePermission

    return list(
        RolePermission.objects.filter(
            permission_code_id__in=[SELECT_PERMISSION, _WILDCARD]
        ).values_list("role_code_id", flat=True)
    )


def _directorate_heads(division_ids):
    """Учётки, которые МОГУТ выделить людей, с областью РОВНО на управление:
    {division_id → {user_id, …}}.

    🔴 ПРАВО, А НЕ ОДНА ЛИШЬ ОБЛАСТЬ (Plane №481). Докстрока обещала «учётки
    с областью ровно на управление», и фильтр по области был, а по праву —
    нет: под рассылку попадала ЛЮБАЯ активная роль с этой областью — и
    наблюдатель, и оператор подразделения, и кто угодно ещё.

    Чем это било. Человек получал требование «Выделите N сотрудников», которое
    физически не может выполнить: экран ему закрыт. И второе, менее видное:
    поле `notifiedHeads` в аудите переставало отвечать на вопрос «кого на
    самом деле попросили» — разбор «почему не выделили» шёл по ложному следу.

    ВРЕМЕННЫЕ ДЕЖУРСТВА здесь НЕ учитываются, и это осознанно: гранты приходят
    из двух источников (`UserRole` и `TemporaryDutyPermission`), а этот
    фильтр читает первый. Дежурный по управлению выделить людей может, а
    уведомления не получит — расхождение записано карточкой, потому что
    решать его надо вместе с ключом «одно уведомление на день»: окно дежурства
    короче суток, и правило «кого просили» перестанет быть однозначным.
    """
    from organization_management.apps.operations.models import UserRole

    heads = {str(pk): set() for pk in division_ids}
    if not division_ids:
        return heads
    rows = UserRole.objects.filter(
        is_active=True,
        scope_division_id__in=list(division_ids),
        role_code_id__in=_roles_that_may_select(),
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


# ── Штабу: департамент ответил «Выделяем: X» (`[СБС-12]`, Plane №426) ──────
RESPONSE_KIND = "FORCES_RESPONSE"
HEADQUARTERS_ROLE = "HEAD_OPS_UNIT"


def _headquarters_users():
    """Учётки штаба второго департамента — роль `HEAD_OPS_UNIT` (Plane №421)."""
    from organization_management.apps.operations.models import UserRole

    return {
        str(user_id)
        for user_id in UserRole.objects.filter(
            is_active=True, role_code_id=HEADQUARTERS_ROLE
        ).values_list("user_id", flat=True)
    }


def notify_headquarters_response(event, allocation, *, allocating):
    """Штаб получает уведомление при КАЖДОМ изменении «Выделяют» департаментом."""
    payload = {
        "eventId": str(event.pk),
        "eventCode": event.code,
        "eventTitle": event.title,
        "businessDate": event.business_date.isoformat(),
        "allocationId": allocation.get("id"),
        "departmentName": allocation.get("departmentName", ""),
        "requested": int(allocation.get("need") or 0),
        "allocating": int(allocating),
    }
    notified = 0
    for user_id in _headquarters_users():
        # 🔴 СОБЫТИЕ, А НЕ СОСТОЯНИЕ ДНЯ (Plane №677). «Одно на день» —
        # умолчание `notify`, и под ним штаб на ОМ с тремя департаментами
        # получал ОДНО уведомление с именем ответившего первым: второй и
        # третий ответы и все последующие правки «Выделяют» проглатывались
        # без следа, ровно вопреки строке докстринга выше. `dedupe_key=None`
        # снимает схлопывание для этих строк и только для них.
        notify_service.notify(
            user_id,
            RESPONSE_KIND,
            event.business_date,
            payload,
            dedupe_key=None,
        )
        notified += 1
    return {"notified": notified}
