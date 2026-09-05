"""Экран сбора сил штаба на таблицах Ш-9 (`[СБС-10]`/`[СБС-11]`/`[СБС-12]`,
Plane №426).

Стережём: статус строки по спецификации (Новая → Запросы отправлены → Ответы
получены K из M → Распределено), «Срочно» и новые — вверх списка; карточка —
потребность по объектам, итоги «потребность · выделяют · прислано · недобор»,
колонки департаментов с историей из таблиц `[МД-06]`; «Довыделить недобор» —
НОВАЯ строка (черновик — отказ, ноль — отказ формы); штаб получает уведомление
при каждом ответе департамента.
"""
import datetime as dt
from unittest import mock

import pytest

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_forces import OpsDepartmentRequest
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_forces_gathering import (  # noqa: F401
    allocated_event,
    event_on_demand,
    make_department,
    make_directorate,
    manager,
)

pytestmark = pytest.mark.django_db
LIST = "/api/ops/security-events/forces/collections/"


def _event_id(base):
    return base.rstrip("/").rsplit("/", 1)[-1]


@pytest.fixture
def hq():
    """Штаб: список сборов и карточка — под `forces.command`."""
    api, user = client_for("hq-officer", "HEAD_OPS_UNIT", perms=("forces.command", "event.view"))
    api.user = user
    return api


def _row(hq, base):
    resp = hq.get(LIST)
    assert resp.status_code == 200, resp.content
    rows = resp.json()["results"]
    return next(r for r in rows if r["eventId"] == _event_id(base))


def _free_object_code():
    from organization_management.apps.operations.models_object import OpsSecurityObject

    OpsSecurityObject.objects.filter(code="OBJ-1").update(code=f"OBJ-{OpsSecurityObject.objects.count()}x")


def test_status_follows_the_spec(manager, hq):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    row = _row(hq, base)
    assert row["boardStatus"]["code"] == "NEW" and row["boardStatus"]["label"] == "Новая"
    assert row["isNew"] is True
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    row = _row(hq, base)
    assert row["boardStatus"]["label"] == "Запросы отправлены"
    service.respond_allocation(_event_id(base), allocation_id, allocating=3, comment="", actor="user:dep")
    row = _row(hq, base)
    assert row["boardStatus"]["label"] == "Ответы получены 1 из 1"
    assert (row["need"], row["allocating"], row["sent"]) == (row["need"], 3, 0)
    assert row["shortage"] == row["need"]


def test_urgent_and_new_go_first(manager, hq):  # noqa: F811
    """«Срочно» — вверх, даже если по дате мероприятие позже (🔴 мутация:
    сортировка по одной дате роняет пробу)."""
    department = make_department()
    make_directorate(department, "Управление охраны")
    early_base, early_id = allocated_event(manager, department, business_date="2026-10-01")
    manager.post(f"{early_base}forces/allocation/{early_id}/notify/")
    _free_object_code()
    late_base, late_id = allocated_event(manager, department, business_date="2026-11-01")
    manager.post(f"{late_base}forces/allocation/{late_id}/notify/")
    # Срок сдачи списка у позднего мероприятия просрочен — «Срочно».
    late = service.lock_event(_event_id(late_base))
    late.force_allocation[0]["dueAt"] = (Clock.now() - dt.timedelta(days=1)).isoformat()
    late.save(update_fields=["force_allocation", "updated_at"])
    rows = hq.get(LIST).json()["results"]
    ids = [r["eventId"] for r in rows]
    assert ids.index(_event_id(late_base)) < ids.index(_event_id(early_base))
    late_row = next(r for r in rows if r["eventId"] == _event_id(late_base))
    early_row = next(r for r in rows if r["eventId"] == _event_id(early_base))
    assert late_row["urgent"] is True and early_row["urgent"] is False
    assert late_row["isNew"] is False and early_row["isNew"] is False


def test_card_carries_objects_totals_and_history(manager, hq):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    card = hq.get(f"{base}force-collection/").json()
    assert card["needByObject"], "потребность по объектам пуста"
    first = card["needByObject"][0]
    assert set(first) >= {"objectName", "need", "statusLabel", "chiefName"}
    assert sum(o["need"] for o in card["needByObject"]) == card["need"]
    assert set(card["totals"]) == {"need", "requested", "allocating", "sent", "shortage"}
    row = card["allocations"][0]
    assert set(row) >= {"sent", "responsibleName", "history", "allocating"}
    assert [h["status"] for h in row["history"]] == ["DRAFT", "NOTIFIED"]


def test_top_up_is_a_new_row_and_draft_is_refused(manager):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    refused = manager.post(f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 2}, format="json")
    assert refused.status_code == 422 and refused.json()["error_code"] == "ALLOCATION_NOT_SENT"
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    zero = manager.post(f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 0}, format="json")
    assert zero.status_code == 400
    resp = manager.post(f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 2}, format="json")
    assert resp.status_code == 200, resp.content
    rows = resp.json()["forceAllocation"]
    assert len(rows) == 2
    original = next(r for r in rows if r["id"] == allocation_id)
    extra = next(r for r in rows if r["id"] != allocation_id)
    assert original["need"] == rows[0]["need"] and extra["need"] == 2
    assert extra["topUpOf"] == allocation_id and extra["status"] == "NOTIFIED"
    # Таблицы `[МД-06]`: у новой строки своя история, старая не тронута.
    assert OpsDepartmentRequest.objects.filter(event_id=_event_id(base), allocation_key=extra["id"]).exists()
    assert OpsDepartmentRequest.objects.filter(event_id=_event_id(base), allocation_key=allocation_id, requested_count=original["need"]).exists()


def test_two_top_ups_get_different_ids_under_a_frozen_clock(manager):  # noqa: F811
    """Два добора по одной заявке различимы, даже когда часы стоят
    (Plane №522, п. 6).

    🔴 ЧТО ЭТО СТЕРЕГЛО БЫ, БУДЬ ОНО РАНЬШЕ. Идентификатор строки добора
    собирался из `Clock.now().isoformat()`, а `Clock` уважает заморозку
    времени — ту самую, на которой стоят пробы и сеяные стенды. Под
    фиксированными часами второй добор получал ТОТ ЖЕ id, что первый:
    `_find_allocation` всегда находит первый, и вторая строка становилась
    недостижима через API — по ней нельзя ни ответить, ни отправить, ни
    принять, хотя в списке она видна.

    Часы здесь замораживаются НАРОЧНО: без заморозки два вызова подряд
    различаются микросекундами и проба зеленеет на сломанном коде — ровно то,
    из-за чего дефект и дожил до ревью.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    frozen = dt.datetime(2026, 9, 5, 12, 0, tzinfo=dt.timezone.utc)
    with mock.patch.object(Clock, "now", staticmethod(lambda: frozen)):
        first = manager.post(
            f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 2}, format="json"
        )
        second = manager.post(
            f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 3}, format="json"
        )
    assert first.status_code == 200, first.content
    assert second.status_code == 200, second.content

    rows = second.json()["forceAllocation"]
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), f"строки запроса делят один id: {ids}"
    extras = [r for r in rows if r.get("topUpOf") == allocation_id]
    assert len(extras) == 2, "второй добор не завёл своей строки"
    assert {r["need"] for r in extras} == {2, 3}

    # И главное: ВТОРАЯ строка достижима по своему id, а не съедена первой.
    answered = manager.post(
        f"{base}forces/allocation/{extras[1]['id']}/respond/",
        {"allocating": 1, "comment": "по второму добору"},
        format="json",
    )
    assert answered.status_code == 200, answered.content
    after = {r["id"]: r for r in answered.json()["forceAllocation"]}
    assert after[extras[1]["id"]].get("allocating") == 1
    assert after[extras[0]["id"]].get("allocating") in (None, 0), (
        "ответ уехал в чужую строку — id не различаются"
    )


def test_editing_the_split_keeps_the_top_up_and_the_original(manager):  # noqa: F811
    """Правка раскладки не уничтожает ни довыделенную строку, ни исходную
    (Plane №675).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Довыделение (`[СБС-12]`) дописывает департаменту
    ВТОРУЮ строку, а редактор раскладки знает про одну на департамент — его
    собственная проверка запрещает прислать две. Пока строки ключились по
    департаменту, в словаре оставалась ПОСЛЕДНЯЯ (довыделенная), и
    пересохранение раскладки ради ЧУЖОГО департамента уничтожало обе:
    довыделенная исчезала, исходная пересобиралась из чужого `kept` и теряла
    id, состав, ответ департамента, момент оповещения и пометку опоздания.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    other = make_department("Департамент связи")
    make_directorate(other, "Управление связи")
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    # Ответ департамента — факт, который правка раскладки обязана сохранить.
    manager.post(
        f"{base}forces/allocation/{allocation_id}/respond/",
        {"allocating": 3, "comment": "выделяем троих"},
        format="json",
    )
    topped = manager.post(
        f"{base}forces/allocation/{allocation_id}/top-up/", {"count": 2}, format="json"
    )
    assert topped.status_code == 200, topped.content
    extra_id = next(
        r["id"] for r in topped.json()["forceAllocation"] if r["id"] != allocation_id
    )
    before = next(
        r for r in topped.json()["forceAllocation"] if r["id"] == allocation_id
    )

    # Штаб пересохраняет раскладку, отдав одного человека ДРУГОМУ департаменту.
    # Своей строки он не касается — меняется только число, а состав, ответ и
    # оповещение обязаны пережить это без единой правки.
    #
    # Единицу приходится ОТНЯТЬ у первого: `allocated_event` раскладывает всю
    # потребность на него, и лишний человек упёрся бы в ALLOCATION_OVER_DEMAND
    # — проба падала бы на чужом правиле, не дойдя до своего предмета.
    saved = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(department.pk), "need": before["need"] - 1},
                {"departmentId": str(other.pk), "need": 1},
            ]
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    rows = {r["id"]: r for r in saved.json()["forceAllocation"]}

    assert extra_id in rows, "довыделенная строка исчезла при правке раскладки"
    assert rows[extra_id]["topUpOf"] == allocation_id
    assert allocation_id in rows, "исходная строка потеряла свой id"
    kept = rows[allocation_id]
    assert kept["need"] == before["need"] - 1, "правка числа не сохранилась"
    assert kept["allocating"] == 3, "ответ департамента стёрт правкой чужой строки"
    assert kept["answerComment"] == "выделяем троих"
    assert kept["notifiedAt"] is not None, "момент оповещения стёрт"


def test_headquarters_is_notified_on_every_answer(manager, hq):  # noqa: F811
    hq_user = hq.user
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    service.respond_allocation(_event_id(base), allocation_id, allocating=2, comment="", actor="user:dep")
    note = OpsNotification.objects.filter(kind="FORCES_RESPONSE", recipient=str(hq_user.pk)).first()
    assert note is not None
    assert note.payload["allocating"] == 2 and note.payload["allocationId"] == allocation_id


def test_every_department_answer_reaches_headquarters(manager, hq):  # noqa: F811
    """КАЖДЫЙ ответ — своё уведомление, а не только первый за день (Plane №677).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `notify_service.notify` идемпотентен по
    (получатель, вид, деловая дата), и до правки штаб на ОМ с двумя
    департаментами получал ОДНО уведомление — с именем ответившего первым.
    Второй ответ и все последующие правки «Выделяют» проглатывались без следа,
    хотя докстринг `notify_headquarters_response` обещал обратное, а прежняя
    проба гоняла ровно один ответ и потому молчала.

    Мутация, на которой проба обязана краснеть: убрать `dedupe_key=None` из
    `notify_headquarters_response` — уведомление останется одно, про первый
    департамент.
    """
    hq_user = hq.user
    first_department = make_department()
    make_directorate(first_department, "Управление охраны")
    base, first_id = allocated_event(manager, first_department)

    # Второй департамент в ТОЙ ЖЕ раскладке того же мероприятия: два ответа за
    # один деловой день — ровно тот случай, что схлопывался.
    second_department = make_department("Департамент связи")
    make_directorate(second_department, "Управление связи")
    event_id = _event_id(base)
    # Разложено не больше потребности: первая строка отдаёт часть второй —
    # редактор отбивает сумму сверх расчёта (`ALLOCATION_OVER_DEMAND`).
    need = int(service.lock_event(event_id).force_allocation[0]["need"])
    assert need >= 2, "потребность меньше двух — делить между департаментами нечего"
    split = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first_department.pk), "need": need - 1},
                {"departmentId": str(second_department.pk), "need": 1},
            ]
        },
        format="json",
    )
    assert split.status_code == 200, split.content
    second_id = next(
        row["id"]
        for row in service.lock_event(event_id).force_allocation
        if str(row["departmentId"]) == str(second_department.pk)
    )

    service.respond_allocation(event_id, first_id, allocating=2, comment="", actor="user:dep-1")
    service.respond_allocation(event_id, second_id, allocating=1, comment="", actor="user:dep-2")
    # И правка собственного ответа — тоже ответ: «уведомление при КАЖДОМ
    # изменении «Выделяют»» из докстринга ручки.
    service.respond_allocation(event_id, first_id, allocating=3, comment="", actor="user:dep-1")

    notes = list(
        OpsNotification.objects.filter(
            kind="FORCES_RESPONSE", recipient=str(hq_user.pk)
        ).order_by("id")
    )
    assert len(notes) == 3, [n.payload for n in notes]
    assert [n.payload["allocating"] for n in notes] == [2, 1, 3]
    assert {n.payload["departmentName"] for n in notes} == {
        first_department.name,
        second_department.name,
    }


def test_a_database_failure_in_the_notification_does_not_lose_the_answer(
    manager, hq, monkeypatch  # noqa: F811
):
    """Отказ побочного канала не уносит деловую операцию (Plane №682).

    Свои отказы `notify_service.notify` глотает сам — наружу отсюда долетает
    ровно одно: ошибка БАЗЫ из чтения ролей штаба. До правки её глотал голый
    `except` ВНУТРИ `@transaction.atomic`, и блок оставался сломанным:
    следующий же оператор (`audit_service.record`) поднимал
    `TransactionManagementError`. Ответ департамента терялся целиком, а
    сообщение об ошибке показывало на журнал аудита — на невиновного.

    Проба ломает ровно то место, что ломается в бою, и проверяет, что ответ
    сохранился, аудит записан, а операция не упала.
    """
    from django.db import connection

    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog
    from organization_management.apps.ops import forces_notify

    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    event_id = _event_id(base)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    # 🔴 ОТКАЗ ДОЛЖЕН БЫТЬ НАСТОЯЩИМ ЗАПРОСОМ, А НЕ `raise DatabaseError`.
    # Проверено запуском: поднятое вручную исключение проходит и БЕЗ точки
    # сохранения — транзакцию ломает не тип исключения, а сама СУБД, помечая
    # соединение `needs_rollback` при неудачном запросе. Подделка давала
    # зелёную пробу на сломанном коде, то есть стерегла бы пустоту.
    def broken(*args, **kwargs):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM таблицы_которой_нет")

    monkeypatch.setattr(forces_notify, "_headquarters_users", broken)

    service.respond_allocation(
        event_id, allocation_id, allocating=4, comment="", actor="user:dep"
    )

    row = _row(hq, base)
    assert row["allocating"] == 4, "ответ департамента потерян отказом уведомления"
    assert OpsAuditLog.objects.filter(
        action=audit_service.FORCE_ALLOCATION_SPLIT, entity_id=int(event_id)
    ).exists(), "аудит ответа не записан — транзакция осталась сломанной"


def test_a_past_event_is_not_urgent_by_its_date_alone(manager, hq):  # noqa: F811
    """Прошедшая дата — не срочность, а залежавшаяся запись (Plane №681).

    Условие автосрочности было односторонним («до даты осталось не больше
    порога») и потому истинным для ВСЕХ прошедших дат: у вчерашней разница
    −1, у прошлогодней −365, обе «не больше суток». Написано это было для
    замечаний согласования, где прошедшая дата возникнуть не может; доска же
    зовёт ту же проверку по каждой строке листинга, а листинг исключает
    только закрытые. В итоге незакрытый сбор прошлого месяца получал красный
    бейдж и по `sort_key` вставал ВЫШЕ сегодняшних действительно срочных.

    🔴 ЗАЯВКА ЗДЕСЬ ОТПРАВЛЕНА (`SUBMITTED`) — и это не деталь фикстуры, а
    единственный способ спросить про ДАТУ. Первая редакция пробы брала
    сорокадневный сбор с неотвеченной заявкой и падала на правильном коде:
    у такой заявки вышел свой срок, и доска зовёт её срочной по `overdue` —
    раньше и независимо от даты. То есть проба спрашивала не про то, что
    чинится. Отправленная заявка просроченной не считается вовсе, и остаётся
    ровно один повод для срочности — дата.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    today = Clock.today_local()
    stale_base, stale_id = allocated_event(
        manager, department, business_date=(today - dt.timedelta(days=40)).isoformat()
    )
    manager.post(f"{stale_base}forces/allocation/{stale_id}/notify/")
    stale = service.lock_event(_event_id(stale_base))
    stale.force_allocation[0]["status"] = "SUBMITTED"
    stale.save(update_fields=["force_allocation", "updated_at"])
    _free_object_code()
    soon_base, soon_id = allocated_event(
        manager, department, business_date=today.isoformat()
    )
    manager.post(f"{soon_base}forces/allocation/{soon_id}/notify/")

    rows = hq.get(LIST).json()["results"]
    stale_row = next(r for r in rows if r["eventId"] == _event_id(stale_base))
    soon_row = next(r for r in rows if r["eventId"] == _event_id(soon_base))

    assert stale_row["urgent"] is False, "сбор сорокадневной давности объявлен срочным"
    assert soon_row["urgent"] is True, "сегодняшний сбор перестал быть срочным"
    ids = [r["eventId"] for r in rows]
    assert ids.index(_event_id(soon_base)) < ids.index(_event_id(stale_base)), (
        "залежавшийся сбор стоит выше сегодняшнего срочного"
    )


def test_a_past_event_with_an_overdue_request_is_still_urgent(manager, hq):  # noqa: F811
    """Опоздание считается СВОИМ признаком и границей окна не снимается.

    Иначе починка №681 увела бы с глаз ровно те сборы, по которым департамент
    просрочил срок: у доски для них есть `overdue`, и он проверяется раньше
    даты.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    today = Clock.today_local()
    base, allocation_id = allocated_event(
        manager, department, business_date=(today - dt.timedelta(days=40)).isoformat()
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    event = service.lock_event(_event_id(base))
    event.force_allocation[0]["dueAt"] = (Clock.now() - dt.timedelta(days=1)).isoformat()
    event.save(update_fields=["force_allocation", "updated_at"])

    row = _row(hq, base)

    assert row["urgent"] is True, "просроченная заявка перестала быть срочной"


# ── Ответственный за сбор сил департамента (Plane №680) ─────────────────────


def test_responsible_is_the_account_that_can_answer_the_request(manager, hq):  # noqa: F811
    """Колонка «Ответственный» называет того, кто МОЖЕТ ответить по заявке.

    Отбор шёл только по `is_active` и области, поэтому победить могла любая
    активная роль на этом департаменте — читатель, оператор, кто угодно.
    Колонка называла человека, к заявке отношения не имеющего.

    Красная проверка — снять фильтр `role_code_id__in=allowed_roles`: имя
    станет «Наблюдатель» либо «Ответственный» через раз, потому что без
    `order_by` порядок строк не определён.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    # Наблюдатель заводится ПЕРВЫМ: без фильтра по праву он и побеждал бы —
    # `setdefault` берёт первую строку, а вставленная раньше обычно и идёт
    # первой. Проба, где он второй, была бы вечнозелёной.
    client_for("dep-watcher", "OPS_READER", perms=("event.view",), scope_division_id=department.pk)
    _, answering = client_for(
        "dep-officer",
        "DEPARTMENT_EXPENSE_OFFICER",
        perms=("forces.allocate",),
        scope_division_id=department.pk,
    )

    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    row = hq.get(f"{base}force-collection/").json()["allocations"][0]

    assert row["responsibleName"] == answering.get_username(), (
        "ответственным назван не тот, кто отвечает по заявке"
    )


def test_the_responsible_name_does_not_change_between_identical_requests(manager, hq):  # noqa: F811
    """Одинаковые запросы дают ОДНО И ТО ЖЕ имя.

    Без `order_by` Postgres вправе отдать строки в любом порядке, а
    `setdefault` берёт первую, — имя в колонке могло меняться между двумя
    одинаковыми запросами. Такое не находят по жалобе: человек видит разное
    и считает, что ответственного переназначили.

    Красная проверка — снять `.order_by("id")`: проба перестаёт быть
    доказательством (на маленькой таблице порядок может совпасть), поэтому
    рядом с ней стоит проба по праву выше — вдвоём они держат оба конца.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    for index in range(3):
        client_for(
            f"dep-officer-{index}",
            "DEPARTMENT_EXPENSE_OFFICER",
            perms=("forces.allocate",),
            scope_division_id=department.pk,
        )

    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    names = {
        hq.get(f"{base}force-collection/").json()["allocations"][0]["responsibleName"]
        for _ in range(5)
    }

    assert len(names) == 1, f"имя ответственного меняется между запросами: {names}"


# ── «Итого» сходится со строками, напечатанными рядом (Plane №678) ──────────


def test_posts_without_an_object_get_their_own_row(manager, hq):  # noqa: F811
    """Пост, не отнесённый ни к одному объекту, ВИДЕН в потребности.

    Разрез `visit_object_posts` отдаёт неразмеченный пост единственному
    объекту и НИКОМУ, как только объектов стало двое. Для потребности объекта
    это верно, но на экране такие посты исчезали совсем: строки объектов не
    покрывали расчёт, а «Итого» рядом бралось из другого, замороженного
    источника — человек читал «„Мейрам“ — 8 · „Рахат“ — 3 · Итого 12» и не мог
    свести.

    Красная проверка — убрать добавочную строку в `need_by_object`: сумма
    строк перестанет сходиться с расчётом постов.
    """
    from organization_management.apps.operations.models_event import (
        OpsSecurityEventVisitObject,
    )
    from organization_management.apps.ops.tests.test_ops_security_events_api import (
        make_object,
    )

    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    event_id = _event_id(base)
    event = service.lock_event(event_id)

    # Второй объект посещения: с ним неразмеченный пост перестаёт принадлежать
    # первому — ровно то состояние, в котором он и пропадал с экрана.
    second = make_object(code="OBJ-СБС-678", name="Второй объект")
    OpsSecurityEventVisitObject.objects.create(
        event=event, security_object=second, object_name=second.name, position=2,
    )
    event.recon_sector_posts = [
        {"id": "post-marked", "sector": "С1", "post": "Размеченный", "need": 4,
         "visitObjectId": str(event.visit_objects.order_by("position", "pk").first().pk)},
        {"id": "post-loose", "sector": "С2", "post": "Ничей", "need": 7},
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    rows = hq.get(f"{base}force-collection/").json()["needByObject"]

    loose = [row for row in rows if row["visitObjectId"] == ""]
    assert loose, "посты без объекта не показаны вовсе — их наряд просят молча"
    assert loose[0]["need"] == 7
    assert sum(row["need"] for row in rows) == 11, (
        "строки потребности не покрывают расчёт постов"
    )


def test_a_single_object_does_not_get_a_second_row(manager, hq):  # noqa: F811
    """У единственного объекта неразмеченные посты УЖЕ в его числе.

    Без этой пробы починка №678 удвоила бы потребность обычного мероприятия:
    добавочная строка сложилась бы с теми же постами внутри объекта.
    """
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    event = service.lock_event(_event_id(base))
    event.recon_sector_posts = [
        {"id": "post-loose", "sector": "С1", "post": "Ничей", "need": 6},
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    rows = hq.get(f"{base}force-collection/").json()["needByObject"]

    assert [row["visitObjectId"] == "" for row in rows] == [False] * len(rows), (
        "у единственного объекта заведена лишняя строка «без объекта» — двойной счёт"
    )
    assert sum(row["need"] for row in rows) == 6
