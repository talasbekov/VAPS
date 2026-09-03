"""Права этапа 3 «Согласование» по ролям (`[СОГ-12]`, Plane №401).

Спецификация: «старший объекта — отправить, отозвать, ответить на замечания;
замещающий — ответить на замечания, не отправляет; `acc_dept_head_d2` —
согласовать / вернуть; `acc_dir_head_d2` — то же, если в маршруте; штаб».

До этой задачи отправка, отзыв и ответ на замечание жили под общим
`event.manage`, которого у старшего объекта нет, а подпись — только у
`EVENT_APPROVER`: у начальника второго департамента «Согласовать» отвечала 403.

Пробы стерегут три вещи, каждая красна на своей мутации:

1. роль каталога `HEAD_OPS_UNIT` решает по маршруту — убери у неё
   `assignment.approve` в `seed_operations`, и проба красна;
2. старший объекта БЕЗ `event.manage` отправляет и отзывает, посторонний с тем
   же набором прав — нет; снять ветку старшего в `_object_lead_override` —
   красно;
3. замещающий закрывает замечание, но отправить не может — расширить
   `_OBJECT_DEPUTY_ACTIONS` до отправки, и вторая половина краснеет.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    _add_approver,
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db


def _persona(employee, username, perms=("event.view",)):
    """Учётка с чтением раздела, привязанная к сотруднику. `event.manage`
    у неё нет намеренно — иначе проба проверяла бы право, а не роль в данных."""
    api, user = client_for(username, f"ROLE_{username.upper()}", perms=perms)
    employee.user = user
    employee.save(update_fields=["user"])
    return api


def _sent(manager, base, visit):  # noqa: F811
    _add_approver(manager, base, visit)
    resp = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
    )
    assert resp.status_code == 200, resp.content
    visit_row = next(
        v for v in resp.json()["visitObjects"] if v["id"] == str(visit.pk)
    )
    return visit_row["approvalRoute"][0]["id"]


# ── Штаб решает по маршруту ─────────────────────────────────────────────────


def test_the_second_department_head_decides_with_the_catalog_role(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _sent(manager, base, first)
    call_command("seed_operations")
    head, _ = client_for("d2-head", "HEAD_OPS_UNIT")

    resp = head.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    row = next(v for v in resp.json()["visitObjects"] if v["id"] == str(first.pk))
    assert row["approvalRoute"][0]["status"] == "APPROVED"


def test_the_second_department_head_returns_with_urgency(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _sent(manager, base, first)
    call_command("seed_operations")
    head, _ = client_for("d2-head", "HEAD_OPS_UNIT")

    resp = head.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Пост без старшего",
            "urgent": True,
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    row = next(v for v in resp.json()["visitObjects"] if v["id"] == str(first.pk))
    assert row["approvalRemarks"][0]["urgent"] is True


# ── Старший объекта — по данным, без права ──────────────────────────────────


def test_the_object_chief_sends_and_withdraws_without_event_manage(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    resp = manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    _add_approver(manager, base, first)
    chief = _persona(chief_employee, "ev-chief")

    sent = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    withdrawn = chief.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert withdrawn.status_code == 200, withdrawn.content

    # Маршрут — настройка процесса, она остаётся у ведущего мероприятие.
    added = chief.post(
        f"{base}approval/route/",
        {"name": "Кто-то", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert added.status_code == 403, added.content


def test_a_stranger_with_the_same_permissions_cannot_send(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    _add_approver(manager, base, first)
    stranger = _persona(make_employee(last_name="Чужов"), "ev-stranger")

    resp = stranger.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resp.status_code == 403, resp.content


def test_the_chief_of_one_object_does_not_lead_the_other(
    manager, two_objects_on_approval  # noqa: F811
):
    """Старший ПЕРВОГО объекта — не старший второго: адрес операции решает."""
    base, _event_id, first, second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    _add_approver(manager, base, second)
    chief = _persona(chief_employee, "ev-chief")

    resp = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(second.pk)}, format="json"
    )
    assert resp.status_code == 403, resp.content


# ── Замещающий: только замечания ────────────────────────────────────────────


def test_the_deputy_answers_a_remark_but_does_not_send(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    deputy_employee = make_employee(last_name="Замов")
    resp = manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(deputy_employee.pk), "canEditPlacement": False},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    approver_id = _sent(manager, base, first)
    returned = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Смените старшего поста",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert returned.status_code == 200, returned.content
    row = next(
        v for v in returned.json()["visitObjects"] if v["id"] == str(first.pk)
    )
    remark_id = row["approvalRemarks"][0]["id"]
    deputy = _persona(deputy_employee, "ev-deputy")

    resolved = deputy.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {
            "decision": "DISAGREED",
            "response": "Старший поста назначен приказом",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert resolved.status_code == 200, resolved.content
    row = next(
        v for v in resolved.json()["visitObjects"] if v["id"] == str(first.pk)
    )
    assert row["approvalRemarks"][0]["status"] == "DISAGREED"

    sent = deputy.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 403, sent.content
