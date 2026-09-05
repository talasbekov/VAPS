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

    🔴 ОБА ИСТОЧНИКА ГРАНТОВ, А НЕ ОДНИ РОЛИ (Plane №800, решение заказчика
    06.09.2026). Права в разделе приходят из ДВУХ таблиц — постоянных
    назначений (`UserRole`) и временных дежурств (`TemporaryDutyPermission`
    со своим окном `starts_at`/`ends_at`); `PermissionService._active_grants`
    перечисляет обе, а эта рассылка читала только первую. Отсюда расхождение:
    заступивший дежурным по управлению ВЫДЕЛИТЬ людей мог — гейт ручки
    пропускал его по дежурному гранту, — а уведомления «Выделите N
    сотрудников» не получал. Запрос уходил постоянному начальнику, которого в
    этот момент может не быть на месте, и никто не понимал, почему список не
    собран.

    Заказчик выбрал «слать ОБОИМ»; отвергнуты «слать только тому, кто на
    дежурстве» (при смене дежурного после рассылки новый не увидел бы ничего)
    и «оставить как есть». Ключ уведомления — (получатель, вид, деловая дата),
    то есть СВОЙ на каждого получателя: двойного уведомления одному человеку
    объединение источников не даёт, даже если он и начальник, и дежурный.

    Окно дежурства короче суток — и это ничего не ломает: рассылка спрашивает
    «кто может выделить ПРЯМО СЕЙЧАС», ровно как и гейт ручки в тот же момент.
    Дежурство, начавшееся после рассылки, уведомления не получит; на этот
    случай у управления есть баннер запроса на экране статусов (`[СБС-30]`).

    Время берётся у `Clock`, а не у `timezone.now()`: остальной раздел живёт по
    нему же, и подменяемые часы — единственный способ проверить границы окна
    пробой.
    """
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.operations.models import (
        TemporaryDutyPermission,
        UserRole,
    )

    heads = {str(pk): set() for pk in division_ids}
    if not division_ids:
        return heads
    ids = list(division_ids)
    roles = _roles_that_may_select()

    rows = UserRole.objects.filter(
        is_active=True,
        scope_division_id__in=ids,
        role_code_id__in=roles,
    ).values_list("scope_division_id", "user_id")

    now = Clock.now()
    duty_rows = TemporaryDutyPermission.objects.filter(
        is_active=True,
        scope_division_id__in=ids,
        duty_role_code__in=roles,
        starts_at__lte=now,
        ends_at__gte=now,
    ).values_list("scope_division_id", "user_id")

    for division_id, user_id in list(rows) + list(duty_rows):
        heads.setdefault(str(division_id), set()).add(str(user_id))
    return heads


def notify_directorate_heads(event, allocation, directorates):
    """Разослать запрос сил начальникам управлений заявки.

    `directorates` — строки управлений заявки (`{divisionId, name, need,
    …}`), как их держит `force_allocation[].directorates`. Возвращает отчёт:
    сколько учёток уведомлено, у каких управлений начальника не нашлось, кому
    не отправляли и кому не дошло — поимённо, а не числом: «двоим не дошло» не
    говорит, кому, и чинить это некому.

    🔴 УПРАВЛЕНИЕ БЕЗ КВОТЫ НЕ ЗОВУТ (Plane №557). Раньше рассылка шла по ВСЕМ
    действующим управлениям департамента, а `need` по умолчанию ноль — и
    начальники управлений, которым ничего не назначили, получали требование
    «Выделите 0 сотрудников». Хуже, чем шум: ключ уведомления — «получатель,
    вид, деловая дата», поэтому пустышка ПЕРЕКРЫВАЛА настоящий запрос, если
    департамент в тот же день раскладывал квоту и рассылал заново. Одно
    ошибочное нажатие глушило рассылку до завтра.

    🔴 СЧИТАЕТСЯ ДОСТАВЛЕННОЕ, А НЕ ПОПЫТКИ (Plane №561). `notify_service.notify`
    по замыслу глотает любое исключение и возвращает `None`, а счётчик рос
    безусловно: при отказе вставки для всех получателей журнал аудита всё
    равно писал `notifiedHeads: N` и пустой список недоставленного. Модуль
    заведён ровно против такого — «рассылка, которая молчит о недоставленном».
    """
    ids = [int(row["divisionId"]) for row in directorates if str(row.get("divisionId", "")).isdigit()]
    heads = _directorate_heads(ids)
    notified, headless, without_quota, undelivered = 0, [], [], []
    for row in directorates:
        key = str(row.get("divisionId"))
        if int(row.get("need") or 0) <= 0:
            without_quota.append(row.get("name") or key)
            continue
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
            if notify_service.notify(user_id, KIND, event.business_date, payload) is None:
                undelivered.append(f"{row.get('name') or key} · {user_id}")
                continue
            notified += 1
    return {
        "notified": notified,
        "headlessDirectorates": headless,
        "withoutQuota": without_quota,
        "undelivered": undelivered,
    }


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
