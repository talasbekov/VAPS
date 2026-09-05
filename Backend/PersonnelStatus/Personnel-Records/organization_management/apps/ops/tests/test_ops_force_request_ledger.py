"""Заявка на сбор сил таблицами (`[МД-06]`, Plane №425).

Стережём: проекция JSON → таблицы идёт сигналом при сохранении мероприятия и
идемпотентна; довыделение/новый срок — НОВАЯ строка; исключение из состава —
`removed_at`; правка старой строки запрещена (🔴 красная проверка карточки);
бэкфилл считает перенесённые строки.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.models_forces import (
    AppendOnlyError,
    OpsDepartmentRequest,
    OpsForceRequest,
    OpsForceRequestMember,
    OpsUnitRequest,
)
from organization_management.apps.ops import forces_ledger
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _allocation(key, *, need, members=(), directorates=(), status="NOTIFIED", allocating=None, due="2026-09-08T13:00:00+00:00"):
    return {
        "id": key, "departmentId": "631", "departmentName": "Департамент", "need": need,
        "dueAt": due, "status": status, "comment": "", "allocating": allocating,
        "directorates": [
            {"id": f"{key}-d{d}", "divisionId": str(d), "name": f"Управление {d}", "need": n}
            for d, n in directorates
        ],
        "members": [
            {"employeeId": str(e.pk), "name": "Сотрудник", "divisionId": "632",
             "divisionName": "Управление", "statusId": "1", "addedAt": "2026-09-03T08:08:11+00:00"}
            for e in members
        ],
    }


@pytest.fixture
def event_with_json(manager):  # noqa: F811
    event_id = create_event(manager, make_object(with_passport=True)).json()["id"]
    event = service.lock_event(event_id)
    e1, e2 = make_employee(last_name="Первый"), make_employee(last_name="Второй")
    event.force_requests = [{"id": "force-request-1", "group": "По расчёту", "status": "SENT",
                             "comment": "", "allocatedCount": 0, "requestedCount": 5}]
    event.force_allocation = [_allocation("alloc-1", need=5, members=[e1, e2], directorates=[(632, 3), (635, 2)])]
    event.save(update_fields=["force_requests", "force_allocation", "updated_at"])
    return event, e1, e2


def test_empty_json_does_not_touch_the_ledger_at_all(manager, django_assert_num_queries):  # noqa: F811
    """Пока заявок и раскладки нет, проекция не делает НИ ОДНОГО запроса
    (Plane №522, п. 5).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Ранний выход сигнала срабатывал ТОЛЬКО когда
    `event.save()` передал `update_fields`. А сохранений без него в цепочке
    большинство — писателей в `security_events` около дюжины, — и всякое
    СОЗДАНИЕ мероприятия тоже: проекция проходила в четыре таблицы ради
    заведомо пустого результата.

    Проверяется ЧИСЛОМ ЗАПРОСОВ, а не флагом: флаг сказал бы «функция не
    звалась», а вопрос был в цене. Одно ожидаемое обращение — само
    `UPDATE` мероприятия; всё сверх него делала бы проекция.
    """
    event_id = create_event(manager, make_object(with_passport=True)).json()["id"]
    event = service.lock_event(event_id)
    assert not event.force_requests and not event.force_allocation

    # Сохранение БЕЗ `update_fields` — тот самый путь, который проекция
    # проходила целиком.
    with django_assert_num_queries(1):
        event.save()

    assert OpsForceRequest.objects.filter(event=event).count() == 0
    assert OpsDepartmentRequest.objects.filter(event=event).count() == 0

    # А появилась первая строка — проекция снова работает: ранний выход
    # смотрит на СОДЕРЖИМОЕ, а не выключает сигнал навсегда.
    event.force_requests = [{"id": "force-request-1", "group": "По расчёту", "status": "SENT",
                             "comment": "", "allocatedCount": 0, "requestedCount": 5}]
    event.save()
    assert OpsForceRequest.objects.filter(event=event).count() == 1


def test_saving_json_projects_the_hierarchy(event_with_json):
    event, e1, e2 = event_with_json
    assert OpsForceRequest.objects.filter(event=event).count() == 1
    dep = OpsDepartmentRequest.objects.get(event=event)
    assert (dep.requested_count, dep.status, dep.sequence) == (5, "NOTIFIED", 1)
    assert dep.force_request.requested_count == 5
    assert OpsUnitRequest.objects.filter(event=event).count() == 2
    assert {m.employee_id for m in OpsForceRequestMember.objects.filter(event=event)} == {e1.pk, e2.pk}


def test_projection_is_idempotent(event_with_json):
    event, _, _ = event_with_json
    before = (
        OpsForceRequest.objects.count(), OpsDepartmentRequest.objects.count(),
        OpsUnitRequest.objects.count(), OpsForceRequestMember.objects.count(),
    )
    event.save(update_fields=["force_allocation", "updated_at"])
    forces_ledger.project(event)
    after = (
        OpsForceRequest.objects.count(), OpsDepartmentRequest.objects.count(),
        OpsUnitRequest.objects.count(), OpsForceRequestMember.objects.count(),
    )
    assert before == after


def test_more_people_is_a_new_row_not_an_edit(event_with_json):
    event, e1, e2 = event_with_json
    row = event.force_allocation[0]
    row["need"] = 7
    row["allocating"] = 6
    row["directorates"][0]["need"] = 5
    event.save(update_fields=["force_allocation", "updated_at"])
    deps = list(OpsDepartmentRequest.objects.filter(event=event).order_by("sequence"))
    assert [(d.sequence, d.requested_count, d.allocating_count) for d in deps] == [(1, 5, None), (2, 7, 6)]
    units = OpsUnitRequest.objects.filter(event=event, directorate_key="alloc-1-d632").order_by("sequence")
    assert [u.requested_count for u in units] == [3, 5]
    # Состав не задвоился: те же двое, строк ровно две.
    assert OpsForceRequestMember.objects.filter(event=event).count() == 2


def test_live_composition_is_readable_from_the_current_request_row(event_with_json):
    """Живой состав читается с ЛЮБОЙ серии запроса департаменту (Plane №672).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Строка запроса департаменту живёт сериями: департамент
    ответил «выделяем 6» — появилась новая серия. Состав и разбивка по
    управлениям к серии не относятся и заново не переписываются (соседний пин
    «состав не задвоился» это прямо запрещает), поэтому у ТЕКУЩЕЙ серии
    `related_name` пуст: `dep.members` и `dep.unit_requests` отвечают на вопрос
    «что записано под этой серией», а не «кто в составе сейчас».

    Пока правило не было названо, читатель, идущий по объявленной в шапке
    модуля цепочке «заявка → департамент → управление → сотрудник», видел у
    текущей строки пустой состав и пустую разбивку — и никак не мог узнать,
    что смотрит не туда.
    """
    event, e1, e2 = event_with_json
    row = event.force_allocation[0]
    # Департамент отвечает: меняется ТОЛЬКО департаментская строка.
    row["allocating"] = 6
    row["status"] = "ANSWERED"
    event.save(update_fields=["force_allocation", "updated_at"])

    current = OpsDepartmentRequest.objects.filter(event=event).order_by("-sequence").first()
    assert current.sequence == 2, "новая серия запроса не появилась — фикстура не про то"

    # Провенанс текущей серии пуст, и это ВЕРНО: под ней ничего не записывали.
    assert current.members.count() == 0
    assert current.unit_requests.count() == 0

    # А живое состояние читается — с той же самой строки.
    assert {m.employee_id for m in current.live_members} == {e1.pk, e2.pk}
    assert sorted(u.requested_count for u in current.live_unit_requests) == [2, 3]

    # И с ПЕРВОЙ серии — тоже: живое состояние одно на заявку, а не на серию.
    first = OpsDepartmentRequest.objects.filter(event=event).order_by("sequence").first()
    assert {m.employee_id for m in first.live_members} == {e1.pk, e2.pk}

    # Исключённый из состава в живом чтении не остаётся.
    row["members"] = [m for m in row["members"] if m["employeeId"] != str(e2.pk)]
    event.save(update_fields=["force_allocation", "updated_at"])
    assert {m.employee_id for m in current.live_members} == {e1.pk}


def test_removing_a_member_stamps_removed_at(event_with_json):
    event, e1, e2 = event_with_json
    event.force_allocation[0]["members"] = [
        m for m in event.force_allocation[0]["members"] if m["employeeId"] != str(e2.pk)
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    gone = OpsForceRequestMember.objects.get(event=event, employee_id=e2.pk)
    assert gone.removed_at is not None
    assert OpsForceRequestMember.objects.get(event=event, employee_id=e1.pk).removed_at is None
    # Вернули — новая строка состава, старая со штампом остаётся.
    event.force_allocation[0]["members"].append(
        {"employeeId": str(e2.pk), "name": "Второй", "divisionId": "632", "addedAt": "2026-09-04T00:00:00+00:00"}
    )
    event.save(update_fields=["force_allocation", "updated_at"])
    assert OpsForceRequestMember.objects.filter(event=event, employee_id=e2.pk).count() == 2


def test_old_rows_cannot_be_edited(event_with_json):
    """🔴 Красная проверка карточки: правка старой строки запрещена."""
    event, _, _ = event_with_json
    dep = OpsDepartmentRequest.objects.get(event=event)
    dep.requested_count = 99
    with pytest.raises(AppendOnlyError):
        dep.save()
    with pytest.raises(AppendOnlyError):
        dep.save(update_fields=["requested_count"])
    member = OpsForceRequestMember.objects.filter(event=event).first()
    member.removed_at = dt.datetime.now(dt.timezone.utc)
    member.save(update_fields=["removed_at"])  # единственное изменяемое поле


def test_backfill_counts_what_it_moved(manager):  # noqa: F811
    event_id = create_event(manager, make_object(with_passport=True)).json()["id"]
    event = service.lock_event(event_id)
    e1 = make_employee(last_name="Третий")
    # Сигнал обходим: имитируем данные, записанные ДО таблиц.
    event._skip_forces_ledger = True
    event.force_requests = [{"id": "force-request-1", "requestedCount": 2, "allocatedCount": 0, "status": "SENT", "group": "", "comment": ""}]
    event.force_allocation = [_allocation("alloc-b", need=2, members=[e1], directorates=[(632, 2)])]
    event.save(update_fields=["force_requests", "force_allocation", "updated_at"])
    assert not OpsForceRequest.objects.filter(event=event).exists()
    lines = []
    totals = forces_ledger.backfill([event], log=lines.append)
    assert totals == {"requests": 1, "departments": 1, "units": 1, "members": 1, "removed": 0}
    assert lines and "перенесено строк" in lines[0]
    # Повтор бэкфилла ничего не плодит.
    assert forces_ledger.backfill([event], log=lambda _: None)["departments"] == 0


# ── Многострочная заявка «по группам» (Plane №673, №674) ────────────────────


def _request(row_id, count):
    """Строка заявки; `row_id=None` — старая запись БЕЗ идентификатора."""
    row = {"group": "Группа", "status": "SENT", "comment": "",
           "allocatedCount": 0, "requestedCount": count}
    return row if row_id is None else {**row, "id": row_id}


def test_two_id_less_request_rows_do_not_grow_the_ledger_forever(event_with_json):
    """Строки БЕЗ идентификатора не схлопываются в один источник.

    Ключ проекции брался как `row["id"] or "force-request-1"`, и две такие
    строки делили один источник: проход писал seq1=A, seq2=B; следующее
    сохранение сравнивало A с ПОСЛЕДНЕЙ строкой ключа (B), видело разницу и
    дописывало seq3=A, затем seq4=B. Две новые строки на КАЖДОЕ сохранение, в
    append-only таблицу, которую история заявки показывает человеку.

    Красная проверка — вернуть общий запасной ключ: второй `project` добавит
    ещё две строки, и счёт станет 4.
    """
    event, _, _ = event_with_json
    event.force_requests = [_request(None, 5), _request(None, 7)]
    event.save(update_fields=["force_requests", "updated_at"])

    forces_ledger.project(event)
    after_first = OpsForceRequest.objects.filter(event_id=event.pk).count()
    forces_ledger.project(event)
    after_second = OpsForceRequest.objects.filter(event_id=event.pk).count()

    assert after_first == 2, "две строки заявки дали не две строки реестра"
    assert after_second == after_first, (
        "повторное сохранение дописало строки в append-only реестр — "
        "проекция не идемпотентна"
    )
    # Числа сохранены как есть, а не перепутаны между строками.
    assert sorted(
        row.requested_count
        for row in OpsForceRequest.objects.filter(event_id=event.pk)
    ) == [5, 7]


def test_department_requests_are_not_hung_on_a_guessed_request_row(event_with_json):
    """При нескольких заявках связь запроса департамента НЕ выдумывается.

    `latest_request` держал последнюю строку массива, и каждый запрос
    департамента приписывался ей. У мероприятий с многострочной заявкой «по
    группам» вся перенесённая история уходила под ту группу, которая
    случайно оказалась последней в JSON, — а таблица append-only, исправить
    потом нечем.

    Строка раскладки ссылки на заявку не несёт вовсе, поэтому `None` —
    единственный честный ответ: пустую связь видно, неверная выглядит фактом.

    Красная проверка — вернуть `latest_request`: связь станет непустой и
    укажет на строку с requestedCount=7.
    """
    event, e1, _ = event_with_json
    # Заявок становится ДВЕ, и запрос департамента меняется — иначе проекция
    # новой строки не заведёт, и проба смотрела бы на строку, созданную
    # фикстурой ещё при ОДНОЙ заявке (так она и падала в первой редакции).
    event.force_requests = [_request("force-request-1", 5), _request("force-request-2", 7)]
    event.force_allocation = [_allocation("alloc-1", need=9, members=[e1])]
    event.save(update_fields=["force_requests", "force_allocation", "updated_at"])

    forces_ledger.project(event)

    fresh = (
        OpsDepartmentRequest.objects
        .filter(event_id=event.pk, allocation_key="alloc-1")
        .order_by("-sequence").first()
    )
    assert fresh is not None, "проба вакуумна — запрос департамента не спроецировался"
    assert fresh.requested_count == 9, (
        "новая строка не завелась — проба смотрит на состояние до двух заявок"
    )
    assert fresh.force_request_id is None, (
        "запрос департамента приписан заявке, которую никто не называл"
    )


def test_a_single_request_row_still_carries_the_link(event_with_json):
    """Когда заявка ОДНА, связь однозначна — и она остаётся.

    Без этой пробы починка №673 могла бы обнулить связь всегда: у обычного
    мероприятия заявка одна, и терять её незачем.
    """
    event, e1, _ = event_with_json
    event.force_allocation = [_allocation("alloc-1", need=5, members=[e1])]
    event.save(update_fields=["force_allocation", "updated_at"])

    forces_ledger.project(event)

    request = OpsForceRequest.objects.filter(event_id=event.pk).get()
    rows = list(OpsDepartmentRequest.objects.filter(event_id=event.pk))
    assert rows, "проба вакуумна — запрос департамента не спроецировался"
    assert {row.force_request_id for row in rows} == {request.pk}
