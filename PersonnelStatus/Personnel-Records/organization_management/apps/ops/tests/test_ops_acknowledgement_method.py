"""Способ подтверждения ознакомления (`[ОЗН-05]`, Plane №447): сотрудник
подтверждает сам — `self`; старший отмечает чужое назначение — `personal` с
его именем в `acknowledgedBy`. Способ читают лист ознакомления и дело.
"""
import pytest

from organization_management.apps.ops import my_assignments
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def test_manager_marks_personally_with_a_name(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]
    resp = manager.post(f"{URL}{event_id}/acknowledge/{row['id']}/")
    assert resp.status_code == 200, resp.content
    marked = next(a for a in resp.json()["placementAssignments"] if a["id"] == row["id"])
    assert marked["acknowledgedVia"] == "personal"
    assert marked["acknowledgedBy"] != ""
    assert marked["acknowledgedAt"] is not None


def test_self_confirmation_is_marked_self(two_objects_on_conduct):  # noqa: F811
    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]
    updated = my_assignments.acknowledge(event_id, row["id"], personal=False, actor="user:1")
    marked = next(a for a in updated.placement_assignments if a["id"] == row["id"])
    assert marked["acknowledgedVia"] == "self" and marked["acknowledgedBy"] == ""


def test_case_sheet_prints_the_method(two_objects_on_conduct):  # noqa: F811
    from organization_management.apps.ops import documents_case

    _, event_id, first, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]
    my_assignments.acknowledge(event_id, row["id"], personal=True, actor_name="Ахметова С.")
    event = service.lock_event(event_id)
    rows = documents_case.acknowledgement_sheet_rows(event, first)
    assert any(r[3] == "лично" for r in rows)


def test_deadline_is_an_hour_before_start(manager, two_objects_on_conduct):  # noqa: F811
    """`[ОЗН-02]`: срок подтверждения — за час до начала (тот же порог, что у
    напоминания руководителям)."""
    import datetime as dt

    from organization_management.apps.ops.acknowledgement_reminders import _start_of

    _, event_id, _, _ = two_objects_on_conduct
    body = manager.get(f"{URL}{event_id}/").json()
    event = service.lock_event(event_id)
    expected = _start_of(event) - dt.timedelta(hours=1)
    assert body["acknowledgementDeadline"] is not None
    assert dt.datetime.fromisoformat(body["acknowledgementDeadline"]) == expected


def test_account_without_a_personnel_link_does_not_claim_personally(
    two_objects_on_conduct,  # noqa: F811
):
    """Учётка без кадровой привязки не утверждает «лично» (Plane №721).

    🔴 ЧТО БЫЛО НЕ ТАК. «Своё или чужое» решалось ТОЛЬКО по связке
    `User → Employee`, а учётка без кадровой привязки — штатный исход
    (докстринг `actor_display_name` говорит это прямо, и сид связь не
    заполняет). Человек подтверждал СВОЮ строку из профиля, а сервер писал
    `acknowledgedVia='personal'` с логином в `acknowledgedBy` — и лист
    ознакомления в деле печатал «лично» вместо «в системе». Документ утверждал
    неправду о способе.

    «Лично» — УТВЕРЖДЕНИЕ о том, как человека довели: старший сказал устно.
    Утверждать его, не зная, чья это строка, нельзя — тот же довод, которым
    раздел отказывается печатать ноль вместо «неизвестно» (№726, №409).
    """
    from organization_management.apps.operations.tests.test_strength_report import (
        client_for,
    )

    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]

    # Учётка с правом вести мероприятие, но БЕЗ кадровой записи за ней — ровно
    # то состояние стенда, про которое предупреждает докстринг
    # `actor_display_name` («сид её не заполняет»).
    api, _user = client_for(
        "ack-unlinked", "ACK_UNLINKED", perms=("event.view", "event.manage")
    )

    resp = api.post(f"{URL}{event_id}/acknowledge/{row['id']}/")

    assert resp.status_code == 200, resp.content
    marked = next(a for a in resp.json()["placementAssignments"] if a["id"] == row["id"])
    assert marked["acknowledgedAt"] is not None, "подтверждение обязано пройти"
    assert marked["acknowledgedVia"] == "self", (
        "без кадровой привязки чья это строка неизвестно — «лично» утверждать нечем"
    )
    assert marked["acknowledgedBy"] == ""


def test_my_assignments_carries_the_method_and_the_author(
    manager, two_objects_on_conduct  # noqa: F811
):
    """Способ и автор отметки доезжают до читателя (Plane №722).

    Без них карточка сотрудника и этап «Проведение» показывали отметку,
    поставленную старшим «лично», ровно так же, как подтверждение самого
    человека, — а это разные факты: одно «я прочитал», другое «мне довели
    устно».
    """
    from organization_management.apps.ops import my_assignments

    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]
    my_assignments.acknowledge(
        event_id, row["id"], personal=True, actor="1", actor_name="Ахметова С."
    )

    rows = my_assignments.assignments_of(row["employeeId"])

    mine_row = next(r for r in rows if r["assignmentId"] == row["id"])
    assert mine_row["acknowledgedVia"] == "personal"
    assert mine_row["acknowledgedBy"] == "Ахметова С."


def test_my_assignments_keeps_the_keys_on_old_rows(
    manager, two_objects_on_conduct  # noqa: F811
):
    """У строк, отмеченных до появления способа, ключи есть и пусты.

    Пустая строка, а не отсутствие ключа: читатель отличает «подтвердил сам»
    от «способ неизвестен» только по значению, и пропавший ключ заставил бы
    каждого читателя проверять его наличие.
    """
    from organization_management.apps.ops import my_assignments

    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    row = event.placement_assignments[0]

    rows = my_assignments.assignments_of(row["employeeId"])

    mine_row = next(r for r in rows if r["assignmentId"] == row["id"])
    assert mine_row["acknowledgedVia"] == ""
    assert mine_row["acknowledgedBy"] == ""
