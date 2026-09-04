"""Запрос сил ГЛАЗАМИ УПРАВЛЕНИЯ (Plane №394, `[СБС-30]`).

Начальник управления приходит из уведомления «Выделите N сотрудников на
ОМ-…» на экран «Статусы сотрудников» и видит баннер «Запрос на ОМ-…: выделено
X из Y». Ему нужна ОДНА строка управления из заявки департамента — и ничего
сверх неё: соседние управления, состав департамента и решения штаба не его
вопрос, и присылать их в браузер значило бы понадеяться, что экран не
покажет.

Своя ручка, а не `forces/requests/<id>/` департамента: та гейтится
`forces.allocate` (ответственный за департамент), у начальника управления
его нет и не будет. Гейт здесь — `status.manage` (тот, кто проставляет
«Участие в ОМ» по своему управлению), и область берётся под ним же. НЕ
`forces.select`: у профилей заказчика его нет, и живой стенд отвечал бы
начальнику управления 403 — см. `forces_directorate_request` во вьюхах.
(Строка исправлена в №487: она обещала `forces.select` и расходилась с
кодом, который под ней же и написан.) Чужая заявка — 404, а не 403:
существование чужой строки не подтверждается перебором идентификаторов,
как и у департамента.

Модуль отдельный от `security_events.py`: у чтения свой предмет, а тот файл
и так под пять тысяч строк.
"""
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.security_events import (
    _as_division_id,
    _not_found,
    allocation_members_view,
)


def _directorate_row_view(event, allocation, mine, allocation_id):
    """Шапка мероприятия плюс СВОИ строки управлений одной заявки.

    Вынесено из `directorate_request_view`, чтобы список и одиночная заявка
    отдавали ОДНУ И ТУ ЖЕ форму: разойдись они — баннер, читающий обе ручки,
    показывал бы разные поля в зависимости от того, пришёл человек по ссылке
    из уведомления или открыл раздел из меню.
    """
    return {
        "eventId": str(event.pk),
        "code": event.code,
        "title": event.title,
        "businessDate": event.business_date.isoformat(),
        "allocationId": allocation_id,
        "departmentName": allocation.get("departmentName", ""),
        "status": allocation.get("status"),
        "dueAt": allocation.get("dueAt"),
        # Обычно одна строка; несколько — у роли с областью на
        # департамент (она видит все его управления).
        "directorates": [
            {
                "divisionId": str(row.get("divisionId")),
                "name": row.get("name", ""),
                "need": int(row.get("need") or 0),
                "assigned": int(row.get("assigned") or 0),
                "notifiedAt": row.get("notifiedAt"),
            }
            for row in mine
        ],
    }


def _mine_of(allocation, allowed_division_ids):
    """Строки управлений заявки, попадающие в область актора.

    `allowed_division_ids is None` — область не сужена (администратор): своя
    любая строка.
    """
    return [
        row
        for row in allocation.get("directorates", [])
        if allowed_division_ids is None
        or _as_division_id(row.get("divisionId")) in allowed_division_ids
    ]


def directorate_requests_view(allowed_division_ids):
    """Все ОПОВЕЩЁННЫЕ запросы, адресованные управлениям актора (Plane №487).

    🔴 ЗАЧЕМ ЭТА РУЧКА ВООБЩЕ ЕСТЬ. Статус «Участие в ОМ» вручную не
    заводится (решение заказчика в №427: `_refuse_manual_participation`
    отвечает 422 и отсылает к чекбоксам запроса). Чекбоксы показывает баннер
    на «Статусах сотрудников», а тот до №487 выходил ТОЛЬКО по параметру
    адреса `?forcesRequest=<id>`, который кладёт единственная ссылка — из
    уведомления. Списка «что просят у МОЕГО управления» не существовало:
    реестр `forces/requests` гейтится `forces.allocate`, правом ДЕПАРТАМЕНТА.
    Человек, открывший раздел из меню, статус поставить не мог ничем — это и
    есть жалоба «с модуля не ставятся статус Участие на ОМ».

    Опираться на одно уведомление нельзя и по второй причине: доставка у него
    дырявая (идемпотентность по дню и получатели без фильтра прав — отдельные
    карточки). Список отвечает на вопрос «что от меня ждут» из данных, а не
    из письма.

    ОПОВЕЩЁННЫЕ, а не все: пока штаб не разослал запрос, выделять нечего —
    показать такую строку значило бы позвать человека к работе, которой ему
    ещё не поручали. Порядок — по дате мероприятия: ближайшее сверху.
    """
    if allowed_division_ids is not None and not allowed_division_ids:
        return []
    rows = []
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]):
        for allocation in allocation_members_view(event):
            mine = [
                row
                for row in _mine_of(allocation, allowed_division_ids)
                if row.get("notifiedAt")
            ]
            if not mine:
                continue
            rows.append(
                _directorate_row_view(event, allocation, mine, allocation.get("id"))
            )
    rows.sort(key=lambda row: (row["businessDate"], row["code"]))
    return rows


def directorate_request_view(allocation_id, allowed_division_ids):
    """Строка СВОЕГО управления в заявке департамента + шапка мероприятия.

    `allowed_division_ids is None` — область не сужена (администратор, роль
    без области): тогда любая строка управления своя. Пустое множество —
    видеть нечего: 404 на любую заявку.
    """
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]):
        for allocation in allocation_members_view(event):
            if allocation.get("id") != allocation_id:
                continue
            mine = _mine_of(allocation, allowed_division_ids)
            if not mine:
                raise _not_found("Запрос управлению не найден.", allocation_id)
            return _directorate_row_view(event, allocation, mine, allocation_id)
    raise _not_found("Запрос управлению не найден.", allocation_id)


def select_for_request(allocation_id, employee_ids, allowed_division_ids, *, actor):
    """Начальник управления выделяет людей ПО ЗАПРОСУ (Plane №395, `[СБС-31]`).

    Спецификация: «Начальник отмечает сотрудников чекбоксами. Статус „Участие
    в ОМ“ создаётся автоматически с мероприятием и датами из запроса. Поле
    „мероприятие“ он не выбирает и не видит. Объект на этом шаге пуст».

    Мероприятие и даты берутся ИЗ ЗАЯВКИ, а статус ставит тот же путь, что и
    штабное выделение (`add_allocation_member`): второй способ ставить статус
    привлечения разошёлся бы с первым в правилах занятости и в расходе дня.

    ПООДИНОЧКЕ, А НЕ ПАКЕТОМ. Каждый сотрудник — своё решение сервера:
    пересечение статусов у одного не должно отменять выделение остальных.
    Поэтому отказы СОБИРАЮТСЯ, а не роняют запрос: ответ называет, кого
    выделили и кому отказано — с причиной, поимённо. Мягкий конфликт (409)
    приходит той же причиной; обход по причине — тем же полем `override`,
    что у штаба.

    Область — управления актора под `status.manage`: чужого сотрудника
    выделить нельзя, и это отказ по конкретному человеку, а не по запросу.
    """
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.ops.security_events import (
        add_allocation_member,
        employee_scope_division,
        personnel_display_name,
        _find_personnel,
    )

    request = directorate_request_view(allocation_id, allowed_division_ids)
    event_id = request["eventId"]
    selected, refused = [], []
    for raw in employee_ids or []:
        employee_id = str(raw).strip()
        if not employee_id:
            continue
        division = employee_scope_division(employee_id)
        if allowed_division_ids is not None and (
            division is None or division not in allowed_division_ids
        ):
            employee = _find_personnel(employee_id)
            refused.append(
                {
                    "employeeId": employee_id,
                    "name": personnel_display_name(employee) if employee else employee_id,
                    "code": "PERMISSION_DENIED",
                    "message": "Сотрудник не вашего управления.",
                }
            )
            continue
        try:
            add_allocation_member(event_id, allocation_id, employee_id=employee_id, actor=actor)
        except DomainError as error:
            employee = _find_personnel(employee_id)
            refused.append(
                {
                    "employeeId": employee_id,
                    "name": personnel_display_name(employee) if employee else employee_id,
                    "code": error.code,
                    "message": error.message,
                }
            )
            continue
        selected.append(employee_id)
    return {
        "selected": selected,
        "refused": refused,
        "request": directorate_request_view(allocation_id, allowed_division_ids),
    }
