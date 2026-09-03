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
