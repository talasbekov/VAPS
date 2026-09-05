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


def test_reminder_reaches_the_person_after_the_stage_already_notified(  # noqa: F811
    manager, acknowledgement_event
):
    """«Напомнить» доходит, даже когда рассылка открытия этапа уже была
    (Plane №611).

    🔴 ПРЕДМЕТ ПРОБЫ — ИМЕННО ПОВТОР. `notify_service.notify` держит договор
    «одно на день» по паре «получатель + вид + дата», и рассылка при ОТКРЫТИИ
    этапа занимает этот ключ первой — тем же видом и той же датой. К моменту,
    когда старший жмёт «Напомнить», строка у каждого уже есть: уведомление не
    создавалось, push не уходил, а ручка отвечала `employees: N` и экран
    рапортовал об отправке, которой не было.

    Поэтому проба сперва ВОСПРОИЗВОДИТ рассылку открытия своими руками (тем
    же вызовом, что и сервер), и только потом жмёт «Напомнить»: без первого
    шага она зеленела бы на пустом ключе — ровно так и жил модульный тест,
    чья фикстура рассылку не гоняла.
    """
    from organization_management.apps.operations import notify_service
    from organization_management.apps.ops.acknowledgement_notify import KIND

    base, rows = acknowledgement_event
    event = _event(base)
    linked = next(
        a for a in event.placement_assignments if str(a["id"]) == str(rows[0]["id"])
    )
    from organization_management.apps.ops.acknowledgement_stage import _employee_users

    user_id = _employee_users([str(linked["employeeId"])]).get(str(linked["employeeId"]))
    assert user_id is not None, "у назначенного нет учётки — проба вакуумна"

    # Рассылка открытия этапа: занимает ключ «одно на день».
    notify_service.notify(user_id, KIND, event.business_date, {"reminder": False})
    after_open = OpsNotification.objects.filter(
        recipient=user_id, kind=KIND, business_date=event.business_date
    ).count()
    assert after_open == 1

    # 🔴 СЧЁТ БЕРЁТСЯ СВЕЖИМ ЗАПРОСОМ, а не повторным `.count()` по одному и
    # тому же `QuerySet`: однажды перебранный набор кэширует результат, и
    # `.count()` после этого возвращает длину КЭША. Первая версия пробы на
    # этом и обманулась — «второе напоминание не создало строки» было
    # свойством пробы, а не кода (проверено прямым вызовом сервиса: 0 → 2 → 4).
    def mine():
        return OpsNotification.objects.filter(
            recipient=user_id, kind=KIND, business_date=event.business_date
        )

    resp = manager.post(f"{base}acknowledgement/remind/{rows[0]['id']}/")

    assert resp.status_code == 200, resp.data
    assert mine().count() == after_open + 1, (
        "напоминание не создало строки — отчёт «отправлено» был про отправку, "
        "которой не было"
    )
    assert any(row.payload.get("reminder") is True for row in mine()), (
        "метка напоминания выброшена вместе с нагрузкой"
    )
    # Второе нажатие — второе напоминание: старший вправе позвонить дважды.
    again = manager.post(f"{base}acknowledgement/remind/{rows[0]['id']}/")
    assert again.status_code == 200, again.data
    assert mine().count() == after_open + 2


def test_reminder_refuses_the_one_who_declined(manager, acknowledgement_event):  # noqa: F811
    """Отказавшемуся напоминать нечего (Plane №616).

    Правило написано в `_pending` прямым текстом — «его заменяют», — и
    «Напомнить всем» его соблюдает; одиночная ручка отбивала только по
    подтверждению. Из интерфейса такой вызов недостижим (кнопка рисуется
    только у ожидающих), но ручка открыта, и правило модуля жило в половине
    путей.
    """
    base, rows = acknowledgement_event
    declined = rows[0]["id"]

    refusal = manager.post(
        f"{base}decline/{declined}/", {"reason": "Командировка по приказу"}, format="json"
    )
    assert refusal.status_code == 200, refusal.data

    resp = manager.post(f"{base}acknowledgement/remind/{declined}/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALREADY_DECLINED"
    # Отметка о напоминании не поставлена — иначе экран показал бы, что
    # отказавшемуся звонили.
    marked = {a["id"]: a.get("remindedAt") for a in _event(base).placement_assignments}
    assert marked[declined] is None
