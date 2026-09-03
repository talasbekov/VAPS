"""Замечание согласования — форма контракта (`[МД-07]`, Plane №386).

Спецификация буквально: «текст, автор, дата, привязка (пост / сектор /
общее), срочно (да/нет), статус (Открыто → Устранено | Не согласен), ответ
старшего + дата, версия документа, в которой поставлено / закрыто».

До этой задачи замечание несло только текст и булеву «устранено»: бинарный
переключатель не мог выразить «не согласен, вот почему», версии документа
не было вовсе (её завела соседняя задача №396), а привязки к посту не было
никогда.

Пробы стерегут:

1. замечание получает привязку к посту, когда согласующий её называет;
2. срочность выставляется автоматически, если до даты ОМ ≤ 1 сутки
   (`[ВОЗ-02]`), и вручную в любой момент;
3. «Устранено» не требует ответа, «Не согласен» требует — иначе замечание
   превращается в отказ без объяснения;
4. закрытая версия документа фиксируется РЕШЕНИЕМ, а не заведением;
5. открытое замечание блокирует завершение этапа, отвеченное («Не согласен»
   с ответом) — не блокирует;
6. замечание можно вернуть в «Открыто» — решение не финально.
"""
import datetime as dt

import pytest

from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _event_on_approval(manager, *, business_date="2026-12-31"):  # noqa: F811
    """ОМ, доведённое до «Согласования» с одним назначением.

    Дата мероприятия — ДАЛЕКО в будущем по умолчанию: тест срочности сам
    решает, когда ей нужна близкая дата, а остальным пробам близость не
    нужна и не должна включать правило `[ВОЗ-02]` неявно.
    """
    obj = make_object(with_passport=True)
    employee = make_employee()
    created = manager.post(
        URL,
        {
            "title": "Проба модели замечания",
            "objectId": str(obj.pk),
            "businessDate": business_date,
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    fresh = manager.get(base).json()
    post_id = fresh["reconSectorPosts"][0]["id"]
    manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}placement/complete/")
    return base, event_id, post_id


def _returned_remark(manager, approver, base, *, post_id=None, urgent=None):  # noqa: F811
    route = manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    ).json()["approvalRoute"]
    manager.post(f"{base}approval/send/")
    body = {"decision": "RETURNED", "comment": "переделать"}
    if post_id is not None:
        body["postId"] = post_id
    if urgent is not None:
        body["urgent"] = urgent
    data = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/", body, format="json"
    ).json()
    return data["approvalRemarks"][0]


def test_the_remark_carries_the_named_post(manager, approver):  # noqa: F811
    base, _, post_id = _event_on_approval(manager)

    remark = _returned_remark(manager, approver, base, post_id=post_id)

    assert remark["postId"] == str(post_id)


def test_the_remark_without_a_post_is_general(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)

    remark = _returned_remark(manager, approver, base)

    assert remark["postId"] is None


def test_urgency_is_automatic_close_to_the_event_date(manager, approver):  # noqa: F811
    """`[ВОЗ-02]`: до даты мероприятия ≤ 1 сутки — срочно автоматически."""
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    base, _, _ = _event_on_approval(manager, business_date=tomorrow)

    remark = _returned_remark(manager, approver, base)

    assert remark["urgent"] is True


def test_urgency_can_be_set_manually_regardless_of_date(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)  # дата далеко в будущем

    remark = _returned_remark(manager, approver, base, urgent=True)

    assert remark["urgent"] is True


def test_urgency_is_false_by_default_far_from_the_date(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)

    remark = _returned_remark(manager, approver, base)

    assert remark["urgent"] is False


def test_resolving_without_a_response_is_allowed(manager, approver):  # noqa: F811
    """«Устранено» — ответ необязателен."""
    base, event_id, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)

    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "RESOLVED"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    row = resp.json()["approvalRemarks"][0]
    assert row["status"] == "RESOLVED"
    assert row["response"] == ""
    assert row["respondedAt"] is not None


def test_disagreeing_without_a_response_is_refused(manager, approver):  # noqa: F811
    """«Не согласен» без ответа неисполнимо для согласующего."""
    base, _, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)

    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "DISAGREED"},
        format="json",
    )

    assert resp.status_code == 400, resp.content
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


def test_disagreeing_with_a_response_is_accepted(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)

    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "DISAGREED", "response": "Пост убрать нельзя — режимный."},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    row = resp.json()["approvalRemarks"][0]
    assert row["status"] == "DISAGREED"
    assert row["response"] == "Пост убрать нельзя — режимный."


def test_disagreeing_does_not_block_completion(manager, approver):  # noqa: F811
    """`[ВОЗ-05]`: «Не согласен» с ответом не хуже «Устранено» — блокирует
    только ОТКРЫТОЕ."""
    base, event_id, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)
    manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "DISAGREED", "response": "Оставляем как есть."},
        format="json",
    )
    manager.post(f"{base}placement/complete/")
    manager.post(f"{base}approval/send/")
    fresh = manager.get(base).json()
    approver_id = fresh["approvalRoute"][0]["id"]
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    resp = approver.post(f"{base}approval/approve/")

    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "ACKNOWLEDGEMENT"


def test_the_resolution_stamps_the_current_document_version(manager, approver):  # noqa: F811
    base, event_id, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)
    created_version = remark["documentVersion"]

    manager.post(f"{base}placement/complete/")
    manager.post(f"{base}approval/send/")  # версия растёт повторной отправкой
    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "RESOLVED"},
        format="json",
    )

    row = resp.json()["approvalRemarks"][0]
    assert row["documentVersion"] == created_version, "версия ПОСТАНОВКИ не меняется задним числом"
    assert row["resolvedInDocumentVersion"] > created_version


def test_a_resolved_remark_can_return_to_open(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)
    manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "RESOLVED"},
        format="json",
    )

    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "OPEN"},
        format="json",
    )

    row = resp.json()["approvalRemarks"][0]
    assert row["status"] == "OPEN"
    assert row["response"] == ""
    assert row["respondedAt"] is None
    assert row["resolvedInDocumentVersion"] is None


def test_an_unknown_decision_is_refused(manager, approver):  # noqa: F811
    base, _, _ = _event_on_approval(manager)
    remark = _returned_remark(manager, approver, base)

    resp = manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"decision": "MAYBE"},
        format="json",
    )

    assert resp.status_code == 400, resp.content
