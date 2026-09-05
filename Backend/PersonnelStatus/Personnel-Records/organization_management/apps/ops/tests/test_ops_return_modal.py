"""Возврат на доработку: список замечаний, авто-«Срочно» по порогу, diff версий
(`[ВОЗ-01]`, `[ВОЗ-02]`, `[ВОЗ-06]`, Plane №431).

Пробы стерегут:
1. возврат со СПИСКОМ замечаний заводит каждое с привязкой и срочностью, а
   общая причина остаётся в строке согласующего; старый вызов без списка даёт
   одно замечание из причины;
2. порог автосрочности читается из настройки `APPROVAL.RETURN_URGENT_DAYS`
   (мутация значения меняет исход при той же дате ОМ);
3. повторная отправка даёт версию N+1, и у неё есть diff с предыдущей:
   снятый пост, добавленный пост, замена человека.
"""
import datetime as dt

import pytest
from django.core.management import call_command

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_settings import OpsPolicySetting
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    _add_approver,
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db


def _send(manager, base, visit):  # noqa: F811
    _add_approver(manager, base, visit)
    resp = manager.post(f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json")
    assert resp.status_code == 200, resp.content
    row = next(v for v in resp.json()["visitObjects"] if v["id"] == str(visit.pk))
    return row["approvalRoute"][0]["id"]


def _visit_row(payload, visit):
    return next(v for v in payload["visitObjects"] if v["id"] == str(visit.pk))


def test_a_return_with_a_list_of_remarks_creates_each_with_its_binding(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, assigned = two_objects_on_approval
    post_id = assigned[str(first.pk)]
    approver_id = _send(manager, base, first)

    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Состав не соответствует расчёту",
            "visitObjectId": str(first.pk),
            "remarks": [
                {"text": "Пост без старшего", "postId": post_id, "urgent": True},
                {"text": "Нет резерва", "postId": None, "urgent": False},
            ],
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    row = _visit_row(resp.json(), first)
    remarks = row["approvalRemarks"]
    assert [r["text"] for r in remarks] == ["Пост без старшего", "Нет резерва"]
    assert remarks[0]["postId"] == post_id and remarks[0]["urgent"] is True
    assert remarks[1]["postId"] is None
    assert row["approvalRoute"][0]["comment"] == "Состав не соответствует расчёту"
    assert row["approvalStatus"] == "RETURNED"


def test_a_return_without_a_list_keeps_the_old_single_remark_contract(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _send(manager, base, first)
    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "Одно замечание", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    remarks = _visit_row(resp.json(), first)["approvalRemarks"]
    assert [r["text"] for r in remarks] == ["Одно замечание"]


def test_the_urgency_threshold_comes_from_the_settings(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    call_command("seed_operations")
    base, event_id, first, _second, _ = two_objects_on_approval
    # Дата ОМ — через 3 дня от «сегодня» стенда: при пороге 1 — не срочно,
    # при пороге 5 — срочно.
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    OpsSecurityEvent.objects.filter(pk=event_id).update(
        business_date=Clock.today_local() + dt.timedelta(days=3)
    )
    approver_id = _send(manager, base, first)

    OpsPolicySetting.objects.filter(setting_code="APPROVAL.RETURN_URGENT_DAYS").update(value=1)
    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "Первый круг", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert _visit_row(resp.json(), first)["approvalRemarks"][-1]["urgent"] is False

    # Второй круг: закрыть замечание, отправить заново, вернуть при пороге 5.
    remark_id = _visit_row(resp.json(), first)["approvalRemarks"][-1]["id"]
    manager.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {"decision": "RESOLVED", "visitObjectId": str(first.pk)}, format="json",
    )
    manager.post(f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json")
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    assert sent.status_code == 200, sent.content
    approver_id = _visit_row(sent.json(), first)["approvalRoute"][0]["id"]
    OpsPolicySetting.objects.filter(setting_code="APPROVAL.RETURN_URGENT_DAYS").update(value=5)
    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "Второй круг", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert _visit_row(resp.json(), first)["approvalRemarks"][-1]["urgent"] is True


def test_the_next_version_carries_a_diff_with_the_previous_one(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, assigned = two_objects_on_approval
    post_id = assigned[str(first.pk)]
    approver_id = _send(manager, base, first)
    returned = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "Заменить человека", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert returned.status_code == 200, returned.content
    remark_id = _visit_row(returned.json(), first)["approvalRemarks"][-1]["id"]
    manager.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {"decision": "RESOLVED", "visitObjectId": str(first.pk)}, format="json",
    )

    # Замена человека на посте первого объекта.
    state = manager.get(base).json()
    assignment = next(a for a in state["placementAssignments"] if a["postId"] == post_id)
    assert manager.delete(f"{base}placement/{assignment['id']}/").status_code == 200
    newcomer = make_employee(last_name="Новиков")
    assert manager.post(
        f"{base}placement/assign/", {"postId": post_id, "employeeId": str(newcomer.pk)}, format="json",
    ).status_code == 200
    manager.post(f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json")
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    assert sent.status_code == 200, sent.content
    versions = _visit_row(sent.json(), first)["documentVersions"]
    assert [v["number"] for v in versions] == [1, 2]
    assert versions[0]["diff"] is None
    diff = versions[1]["diff"]
    assert diff["addedPosts"] == [] and diff["removedPosts"] == []
    assert len(diff["replacedPeople"]) == 1
    change = diff["replacedPeople"][0]
    assert any("Новиков" in name for name in change["now"])
    assert change["was"] != change["now"]


@pytest.mark.parametrize(
    "sent, where",
    [
        # Целое: `5 or []` даёт `5`, перебор поднимал необработанный TypeError
        # и отдавал 500 вместо конверта с именем поля.
        (5, "remarks"),
        ("Пост без старшего", "remarks"),
        # Объект JSON: перебор давал КЛЮЧИ, каждый не `dict`, все отсеивались,
        # и возврат уходил БЕЗ присланных замечаний с ответом 200 — тихая
        # потеря, которая хуже отказа.
        ({"text": "Пост без старшего"}, "remarks"),
        # Список не из объектов: адрес ошибки называет строку.
        ([5], "remarks.0"),
        (["Пост без старшего"], "remarks.0"),
    ],
)
def test_a_malformed_remarks_field_is_refused_by_field_and_not_by_500(
    manager, approver, two_objects_on_approval, sent, where  # noqa: F811
):
    """`remarks` проверяется по типу (Plane №668).

    Поле приходит прямо из тела запроса. До проверки его перебирали как есть,
    и оба неверных вида давали НЕ отказ: целое — 500 необработанным
    TypeError, объект JSON — 200 с потерянными замечаниями. Возвращающий при
    этом уверен, что замечания ушли.
    """
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _send(manager, base, first)

    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Состав не соответствует расчёту",
            "visitObjectId": str(first.pk),
            "remarks": sent,
        },
        format="json",
    )

    assert resp.status_code == 400, resp.content
    body = resp.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert where in body["details"], body
    # И главное: ничего не записалось — ни замечаний, ни возврата.
    first.refresh_from_db()
    assert (first.approval_remarks or []) == []
    assert first.stage == "APPROVAL"
