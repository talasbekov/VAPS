"""Этап «Ознакомление»: напоминания и завершение с подтверждением
(Plane №432, `[ОЗН-03]` `[ОЗН-04]`).

Напоминание одному и всем не подтвердившим — адресные уведомления с
отметкой `remindedAt`; подтвердившему напоминать нечего (422); завершение
при неподтвердивших — только с `force` и комментарием, с записью в журнал
мутаций; замена доступна уже на «Ознакомлении»; старший объекта ведёт этап
без `event.manage`.
"""
import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

from .test_ops_acknowledgement_notify import (  # noqa: F401
    event_with_people,
)
from .test_ops_security_events_api import (  # noqa: F401
    URL,
    make_employee,
    manager,
)

pytestmark = pytest.mark.django_db


def _event(base):
    return OpsSecurityEvent.objects.get(pk=base.rstrip("/").split("/")[-1])


@pytest.fixture
def acknowledgement_event(event_with_people):
    """`(base, rows)` поверх фикстуры рассылки: ОМ на «Ознакомлении» с двумя
    назначенными (`a-1` привязан к учётке, `a-2` — нет)."""
    event, _account, _boss, _unlinked = event_with_people
    return f"{URL}{event.pk}/", list(event.placement_assignments)


def test_remind_one_and_all_mark_rows_and_refuse_the_confirmed(manager, acknowledgement_event):  # noqa: F811
    base, rows = acknowledgement_event
    first, second = rows[0]["id"], rows[1]["id"]
    before = OpsNotification.objects.count()

    resp = manager.post(f"{base}acknowledgement/remind/{first}/")
    assert resp.status_code == 200, resp.data
    assert resp.json()["remindedAssignmentIds"] == [first]
    event = _event(base)
    marked = {a["id"]: a.get("remindedAt") for a in event.placement_assignments}
    assert marked[first] is not None and marked[second] is None
    assert OpsNotification.objects.count() > before

    # Подтвердил — напоминать нечего.
    manager.post(f"{base}acknowledge/{first}/")
    resp = manager.post(f"{base}acknowledgement/remind/{first}/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALREADY_ACKNOWLEDGED"

    # «Всем, кто не подтвердил» — только не подтвердившие.
    resp = manager.post(f"{base}acknowledgement/remind-all/")
    assert resp.status_code == 200, resp.data
    assert first not in resp.json()["remindedAssignmentIds"]
    assert second in resp.json()["remindedAssignmentIds"]


def test_complete_needs_force_and_comment_when_someone_did_not_confirm(manager, acknowledgement_event):  # noqa: F811
    base, rows = acknowledgement_event
    resp = manager.post(f"{base}acknowledgement/complete/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ACKNOWLEDGEMENT_INCOMPLETE"
    assert resp.json()["details"]["unconfirmed"] == len(rows)

    resp = manager.post(f"{base}acknowledgement/complete/", {"force": True}, format="json")
    assert resp.status_code == 400
    assert "comment" in resp.json()["details"]

    resp = manager.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Доведено устно на разводе"}, format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.json()["stage"] == "CONDUCT"
    entry = OpsAuditLog.objects.filter(action="SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED").latest("id")
    assert entry.old_value["unconfirmed"] == len(rows)
    assert entry.new_value["comment"] == "Доведено устно на разводе"


def test_replacement_is_allowed_on_acknowledgement_stage(manager, acknowledgement_event):  # noqa: F811
    base, rows = acknowledgement_event
    incoming = make_employee("Сменный", "С")
    resp = manager.post(
        f"{base}conduct/replace/",
        {"assignmentId": rows[0]["id"], "incomingEmployeeId": str(incoming.pk),
         "reasonCode": "Отказ: болезнь"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    # Строки фикстуры заведены без подписи — сравниваем по идентификатору.
    ids = [a["employeeId"] for a in resp.json()["placementAssignments"]]
    assert str(incoming.pk) in ids


def test_object_chief_runs_the_stage_without_event_manage(manager, acknowledgement_event):  # noqa: F811
    base, rows = acknowledgement_event
    chief = make_employee("Старший", "С")
    event = _event(base)
    event.chief_employee_id = chief.pk
    event.save(update_fields=["chief_employee_id"])
    api, user = client_for("chief-user")
    chief.user = user
    chief.save(update_fields=["user"])

    assert api.post(f"{base}acknowledgement/remind-all/").status_code == 200
    resp = api.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Доведено лично"}, format="json",
    )
    assert resp.status_code == 200, resp.data
    # Посторонний без права — 403.
    stranger, _ = client_for("stranger")
    assert stranger.post(f"{base}acknowledgement/remind-all/").status_code == 403
