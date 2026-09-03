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
