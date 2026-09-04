"""«Отозвать» доступна, пока никто не подписал (`[СОГ-07]`, Plane №446).

До подписи отзыв возвращает маршрут в «не отправлено»; после первой подписи
сервер отказывает — подпись под составом не стирается отзывом, дальше только
возврат согласующим (`[СОГ-08]`).
"""
import pytest

from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    _add_approver,
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db


def _row(payload, visit):
    return next(v for v in payload["visitObjects"] if v["id"] == str(visit.pk))


def test_withdraw_works_before_any_signature_and_refuses_after(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Первый")
    _add_approver(manager, base, first, name="Второй")
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    assert sent.status_code == 200, sent.content

    withdrawn = manager.post(f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json")
    assert withdrawn.status_code == 200, withdrawn.content
    assert all(a["status"] == "NOT_SENT" for a in _row(withdrawn.json(), first)["approvalRoute"])

    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first_id = _row(sent.json(), first)["approvalRoute"][0]["id"]
    signed = approver.post(
        f"{base}approval/route/{first_id}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)}, format="json",
    )
    assert signed.status_code == 200, signed.content

    refused = manager.post(f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json")
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "APPROVAL_WITHDRAW_AFTER_SIGN"
