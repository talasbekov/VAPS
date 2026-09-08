"""«Отправить запросы» штаба и всё, что из этого следует (`[СБС-12]`,
`[СБС-13]`, `[СБС-22]`; Plane №944 — задача заказчика «привести сбор сил к
документации»).

Спецификация (`RAW/README.md`, раздел 7) описывает шаг штаба, которого в
системе НЕ БЫЛО: «После „Отправить запросы“ цифры фиксируются; изменения —
только через „Довыделить недобор“». До этой правки «Сохранить раскладку»
клало черновик, который департамент видел сразу, а цифру «Запрошено» штаб
мог править и после того, как департамент разложил её по управлениям.

ЧЕМ ДЕРЖИТСЯ «ОТПРАВЛЕНО» — МОМЕНТОМ `sentAt` У СТРОКИ РАСКЛАДКИ, а не новым
статусом. Статусная машина строки (`DRAFT → NOTIFIED → SUBMITTED → …`)
читается в семи местах (`force_collection_board`, `top_up`,
`split_force_demand`, ленты, проекция реестра); момент ни одного читателя не
ломает, а «отправлено ли» — вопрос отдельный от «что с заявкой сделал
департамент». Так же устроено «оповещено» у управления (`notifiedAt`).

🔴 ОТПРАВКА — УМОЛЧАНИЕ РАСКЛАДКИ, ЧЕРНОВИК — ЯВНЫЙ ФЛАГ (`draft: true`).
`POST forces/allocation/` без флага = «Отправить запросы»: сохраняет строки и
ставит `sentAt` всем неотправленным. Так все прежние вызывающие (пробы,
помощники e2e, сеяние стенда), для которых «сохранил» и означало «департамент
видит», работают без правки, а новый экран штаба различает две кнопки.

МОДУЛЬ ОТДЕЛЬНЫЙ ОТ `security_events.py` по той же причине, что и
`force_collection.py`: тот файл под семь тысяч строк и прямо сейчас держит
незакоммиченный хунк соседняя сессия (№878). Здесь — обёртки над его
функциями, а не их правка.
"""
import datetime as dt
import logging

from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import security_events as events

logger = logging.getLogger(__name__)


def _now_iso():
    return Clock.now().astimezone(dt.timezone.utc).isoformat()


def is_sent(row):
    """Строка раскладки отправлена департаменту.

    Единственный источник ответа на этот вопрос — момент `sentAt`. Строки
    старше правила получили его бэкфиллом (миграция 0103): до неё «сохранил»
    и означало «отправил», и прятать такие заявки от департаментов, которые
    их уже видели, нельзя.
    """
    return bool(row.get("sentAt"))


def sent_rows(allocations):
    return [row for row in allocations if is_sent(row)]


def require_sent(event_id, allocation_id):
    """Действие ДЕПАРТАМЕНТА по строке возможно только после отправки штабом.

    Ответ «Выделяем», разбивка по управлениям, их оповещение и отправка списка
    — всё это ответы на запрос, а запроса до «Отправить запросы» нет: есть
    черновик штаба, который тот ещё правит. 422 с кодом, который экран
    называет словами.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = OpsSecurityEvent.objects.filter(pk=event_id).first()
    if event is None:
        raise events._not_found("Мероприятие не найдено.", event_id)
    target = events._find_allocation(event, allocation_id)
    if not is_sent(target):
        raise DomainError(
            "ALLOCATION_NOT_SENT",
            422,
            message="Штаб ещё не отправил запрос этому департаменту — отвечать не на что.",
        )
    return target


def _frozen_rows_changed(event, rows):
    """Отправленные строки не правятся и не снимаются (`[СБС-12]`).

    Возвращает ошибки формы построчно — так же, как их отдаёт
    `split_force_demand`: человек видит их у той строки, которую тронул.
    Довыделенные строки (`topUpOf`) редактор и раньше не принимал, их здесь
    нет. Срок сдачи списка (`dueAt`) НЕ заперт: спецификация говорит о цифрах,
    а перенос срока — решение штаба, которое он вправе менять.
    """
    previous = {
        str(item.get("departmentId")): item
        for item in (event.force_allocation or [])
        if not item.get("topUpOf")
    }
    incoming = {}
    errors = {}
    for index, row in enumerate(rows or []):
        key = str(row.get("departmentId", "")).strip()
        incoming[key] = (index, row)
    for key, item in previous.items():
        if not is_sent(item):
            continue
        if key not in incoming:
            # Снять отправленную строку нельзя ни на каком статусе: у
            # `split_force_demand` это правило стоит только для строк не в
            # черновике, а отправленный черновик (департамент ещё не ответил)
            # оно пропускало.
            raise DomainError(
                "ALLOCATION_LOCKED",
                422,
                message=(
                    f"Запрос департаменту «{item.get('departmentName') or key}» уже "
                    "отправлен — снять его из раскладки нельзя."
                ),
            )
        index, row = incoming[key]
        try:
            need = events._whole_number(row.get("need", 0), "need")
        except DomainError:
            continue  # ошибку формы назовёт сам `split_force_demand`
        if need != int(item.get("need") or 0):
            errors[f"rows.{index}.need"] = [
                "Запрос уже отправлен — цифра заперта. Недобор довыделяется "
                "отдельной строкой («Довыделить недобор →»)."
            ]
    return errors


@transaction.atomic
def split_and_send(event_id, *, rows, draft=False, actor):
    """Раскладка потребности по департаментам + «Отправить запросы».

    `draft=True` — «Сохранить черновик»: строки сохраняются без `sentAt`,
    департамент их не видит, цифры правятся. Без флага — «Отправить запросы»:
    после сохранения все неотправленные строки получают момент отправки, а
    ответственные за сбор сил в этих департаментах — уведомление со ссылкой в
    карточку заявки.
    """
    from organization_management.apps.operations import audit_service
    from organization_management.apps.ops import forces_notify

    current = events.lock_event(event_id)
    errors = _frozen_rows_changed(current, rows)
    if errors:
        raise events._validation(errors)
    # 🔴 МОМЕНТ ОТПРАВКИ ПЕРЕЖИВАЕТ ПЕРЕСОХРАНЕНИЕ. `split_force_demand`
    # пересобирает строку ЯВНЫМ перечнем ключей (и правильно: спред тащил бы
    # ключи прежних форм), а `sentAt` в этом перечне нет — файл общий, и
    # перечень остаётся его. Момент восстанавливается здесь по id строки:
    # иначе каждое сохранение ради соседа переписывало бы «отправлено» и
    # слало ответственному письмо заново.
    remembered = {
        str(item.get("id")): item.get("sentAt")
        for item in (current.force_allocation or [])
        if item.get("sentAt")
    }
    event = events.split_force_demand(event_id, rows=rows)
    now = _now_iso()
    fresh = []
    updated = []
    changed = False
    for row in event.force_allocation or []:
        kept = remembered.get(str(row.get("id")))
        if kept and not row.get("sentAt"):
            row = {**row, "sentAt": kept}
            changed = True
        if is_sent(row) or row.get("topUpOf") or draft:
            updated.append(row)
            continue
        sent = {**row, "sentAt": now}
        fresh.append(sent)
        updated.append(sent)
        changed = True
    if changed:
        event.force_allocation = updated
        event.save(update_fields=["force_allocation", "updated_at"])
    if not fresh:
        return event
    report = forces_notify.notify_department_officers(event, fresh)
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_SPLIT,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "sent": [
                {
                    "departmentName": row.get("departmentName", ""),
                    "need": int(row.get("need") or 0),
                }
                for row in fresh
            ],
            "sentAt": now,
            **report,
        },
    )
    return event


# ── Состав мероприятия появляется с присланным списком (`[СБС-13]`) ─────────


def _merge_into_roster(event, target, now):
    """Люди присланного списка — в состав мероприятия, без задвоения.

    Тот же перенос, что делает `accept_allocation`; вынесен сюда, потому что
    по спецификации блок 3 «появляется с первым ПРИСЛАННЫМ списком», а не с
    принятым: отдельного шага «Принять в мероприятие» в ней нет.
    """
    known = {str(row.get("employeeId")) for row in (event.force_roster or [])}
    incoming = [
        {
            "employeeId": str(member.get("employeeId")),
            "name": member.get("name", ""),
            "divisionId": member.get("divisionId"),
            "divisionName": member.get("divisionName", ""),
            "departmentId": target.get("departmentId"),
            "departmentName": target.get("departmentName", ""),
            "acceptedAt": now,
        }
        for member in target.get("members", [])
        if str(member.get("employeeId")) not in known
    ]
    if not incoming:
        return event
    event.force_roster = [*(event.force_roster or []), *incoming]
    events._sync_auto_force_request(event)
    event.save(update_fields=["force_roster", "force_requests", "updated_at"])
    return event


def _drop_from_roster(event, target):
    """Список ушёл обратно департаменту — его люди уходят из состава.

    🔴 После передачи на расстановку человека, уже отданного объекту, из
    состава не забирают: расстановка объекта считает его своим, и отзыв
    списка задним числом менял бы условия старшему объекта. Такой отзыв —
    отказ словами, а не тихая потеря.
    """
    members = {str(member.get("employeeId")) for member in target.get("members", [])}
    if not members:
        return event
    roster = event.force_roster or []
    if event.force_handover:
        stuck = [
            row.get("name") or str(row.get("employeeId"))
            for row in roster
            if str(row.get("employeeId")) in members and row.get("visitObjectId")
        ]
        if stuck:
            raise DomainError(
                "FORCE_HANDED_OVER",
                422,
                message=(
                    "Состав уже передан на расстановку, и эти люди отданы объектам: "
                    + ", ".join(stuck)
                    + ". Отозвать список нельзя."
                ),
            )
    event.force_roster = [
        row for row in roster if str(row.get("employeeId")) not in members
    ]
    events._sync_auto_force_request(event)
    event.save(update_fields=["force_roster", "force_requests", "updated_at"])
    return event


@transaction.atomic
def submit_allocation(event_id, allocation_id, *, actor):
    """Департамент отправляет список — и люди сразу в составе мероприятия."""
    event = events.submit_allocation(event_id, allocation_id, actor=actor)
    target = events._find_allocation(event, allocation_id)
    return _merge_into_roster(event, target, _now_iso())


@transaction.atomic
def withdraw_allocation(event_id, allocation_id, *, actor):
    current = events.lock_event(event_id)
    target = events._find_allocation(current, allocation_id)
    if target.get("status") == "SUBMITTED":
        _drop_from_roster(current, target)
    event = events.withdraw_allocation(event_id, allocation_id, actor=actor)
    # Штаб узнаёт об отзыве (`[СБС-12]`; ревью №825 по №944): своей точкой
    # сохранения, как у ответа «Выделяем» в `respond_allocation`, — отказ
    # вставки уведомления не должен откатить сам отзыв.
    from organization_management.apps.ops import forces_notify

    try:
        with transaction.atomic():
            report = forces_notify.notify_headquarters_withdrawal(event, target)
        if report["undelivered"]:
            logger.warning(
                "уведомление штабу об отзыве списка не легло: ОМ=%r заявка=%r не дошло=%s",
                event.code, allocation_id, report["undelivered"],
            )
    except Exception:  # noqa: BLE001 — рассылка не роняет отзыв
        logger.exception("рассылка штабу об отзыве списка упала: ОМ=%r", event.code)
    return event


@transaction.atomic
def return_allocation(event_id, allocation_id, *, reason, actor):
    current = events.lock_event(event_id)
    target = events._find_allocation(current, allocation_id)
    if target.get("status") == "SUBMITTED":
        _drop_from_roster(current, target)
    return events.return_allocation(
        event_id, allocation_id, reason=reason, actor=actor
    )


# ── «В строю» по управлениям (`[СБС-22]`) ───────────────────────────────────


def in_service_by_directorate(business_date, directorate_ids):
    """{divisionId: сколько людей управления в строю на деловую дату ОМ}.

    «В строю» считается ТЕМ ЖЕ правилом, что и разрез сбора на экране
    (`use-forces-gathering.ts`, `isInService`): действующего статуса нет —
    в строю; статус есть — в строю, если справочник относит его к колонке
    «В строю» расхода и это не участие в ОМ (его справочник кладёт в ту же
    колонку, и не вычесть его значило бы посчитать привлечённого дважды).
    Человек относится к управлению по ПОДДЕРЕВУ — он числится в отделе.
    """
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.operations.selectors import DivisionTreeSelector
    from organization_management.apps.operations.status_types import StatusType

    ids = [int(pk) for pk in directorate_ids if str(pk).isdigit()]
    result = {str(pk): 0 for pk in ids}
    if not ids:
        return result
    children_map = DivisionTreeSelector.children_map()
    subtree_of = {
        pk: DivisionTreeSelector.subtree_ids(pk, children_map=children_map) for pk in ids
    }
    every = set().union(*subtree_of.values())
    people = list(
        Employee.objects.filter(is_active=True, staff_unit__division_id__in=every)
        .values_list("pk", "staff_unit__division_id")
    )
    if not people:
        return result
    statuses = events.day_status_map([str(pk) for pk, _ in people], business_date)
    column_of = dict(StatusType.objects.values_list("code", "report_column_code"))
    participation = set(events._PARTICIPATION_KIND_BY_STATUS)

    def in_service(employee_id):
        code, _label = statuses.get(str(employee_id), (None, None))
        if code is None:
            return True
        if code in participation:
            return False
        return column_of.get(code) == "IN_SERVICE"

    for employee_id, division_id in people:
        if not in_service(employee_id):
            continue
        for pk, subtree in subtree_of.items():
            if division_id in subtree:
                result[str(pk)] += 1
                break
    return result


def with_in_service(detail):
    """Дописать карточке департамента «В строю» по КАЖДОМУ действующему
    управлению департамента — картой `{divisionId: n}` рядом с заявкой.

    Картой, а не полем строки `allocation.directorates[]`: те строки заводит
    ПЕРВОЕ действие цепочки (разбивка или оповещение), и до него список пуст,
    а таблица экрана собирается из дерева оргструктуры (см.
    `useDepartmentDirectorates`). Колонка обязана стоять и у управления, по
    которому ещё ничего не решено, — иначе «В строю» появлялось бы только
    после того, как решение уже принято.
    """
    from organization_management.apps.divisions.models import Division

    allocation = detail.get("allocation") or {}
    department_id = allocation.get("departmentId")
    if not str(department_id or "").isdigit():
        return {**detail, "inServiceByDirectorate": {}}
    directorate_ids = list(
        Division.objects.filter(
            parent_id=int(department_id),
            division_type=Division.DivisionType.DIRECTORATE,
            is_active=True,
        ).values_list("pk", flat=True)
    )
    for row in allocation.get("directorates") or []:
        if str(row.get("divisionId") or "").isdigit():
            directorate_ids.append(int(row["divisionId"]))
    business_date = dt.date.fromisoformat(detail["businessDate"])
    return {
        **detail,
        "inServiceByDirectorate": in_service_by_directorate(
            business_date, sorted(set(directorate_ids))
        ),
        # `[СБС-23]`: список выделенных — ГРУППАМИ по управлениям. Человек
        # числится в отделе, и управление у него считается по поддереву тем же
        # правилом, что и «выделено N из M» (`_with_directorate_progress`);
        # клиент своего дерева не держит и группирует по этой карте.
        "memberDirectorateById": _member_directorates(
            allocation.get("members") or [], sorted(set(directorate_ids))
        ),
    }


def _member_directorates(members, directorate_ids):
    """{employeeId: divisionId управления | null} по живому подразделению
    штатной единицы, запасной путь — `divisionId` строки выделения."""
    from organization_management.apps.operations.selectors import (
        DivisionTreeSelector,
        StaffUnitSelector,
    )

    if not members or not directorate_ids:
        return {}
    children_map = DivisionTreeSelector.children_map()
    subtree_of = {
        pk: DivisionTreeSelector.subtree_ids(pk, children_map=children_map)
        for pk in directorate_ids
    }
    numeric = [int(m["employeeId"]) for m in members if str(m.get("employeeId") or "").isdigit()]
    live = StaffUnitSelector.divisions_of(numeric) if numeric else {}
    result = {}
    for member in members:
        key = str(member.get("employeeId"))
        division_id = live.get(int(key)) if key.isdigit() else None
        if division_id is None and str(member.get("divisionId") or "").isdigit():
            division_id = int(member["divisionId"])
        result[key] = None
        if division_id is None:
            continue
        for pk, subtree in subtree_of.items():
            if division_id in subtree:
                result[key] = str(pk)
                break
    return result
