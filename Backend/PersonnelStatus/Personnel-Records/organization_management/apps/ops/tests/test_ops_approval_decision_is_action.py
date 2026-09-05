"""Решение согласующего — действие (`[СОГ-08]`/`[СОГ-09]`, Plane №399).

Спецификация: «Действия согласующего (по очереди маршрута): панель
[Согласовать] [Вернуть на доработку]. Правки расстановки и „Перевести ОМ сюда“
у согласующего нет» и «Этап завершается автоматически последней подписью:
статус „Согласовано“, этап 4 открывается... Кнопки „Завершить этап“ нет».

До этого шага подпись в маршруте только записывалась, а завершал этап
ОТДЕЛЬНЫЙ клик — «Завершить этап и перейти далее»; возврат подписанта тоже
ничего не двигал, пока не нажимали большую «Вернуть на доработку». Одно
решение принималось в двух местах.

Пробы стерегут:

1. последняя подпись переводит объект на «Ознакомление» без отдельного шага;
2. НЕ последняя — нет: мероприятие ждёт остальных подписантов;
3. подпись при открытом замечании не завершает; ответ на ЭТО замечание —
   завершает (последним действием может быть и ответ старшего);
4. «Вернуть» подписанта возвращает объект на «Расстановку» сразу, документ —
   «Возвращено», замечание заведено;
5. устаревшая расстановка автозавершение не проходит и подпись не срывает;
6. ручка `approve/` жива под админа и API — когда автозавершение не
   сработало, ею можно закончить руками.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _event_sent(manager, *, approvers=("К. Оразов",)):  # noqa: F811
    """ОМ на «Согласовании», маршрут заведён и отправлен."""
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба решения-действия",
            "objectId": str(obj.pk),
            "businessDate": "2026-12-31",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
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
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    posts = manager.get(base).json()["reconSectorPosts"]
    for post in posts:
        for _ in range(post["need"]):
            manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(make_employee().pk)},
                format="json",
            )
    manager.post(f"{base}placement/complete/")
    for name in approvers:
        manager.post(
            f"{base}approval/route/",
            {"name": name, "unit": "Департамент охраны", "position": "Зам."},
            format="json",
        )
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    return base, event_id, route


def _decide(approver, base, approver_id, decision, comment=""):  # noqa: F811
    resp = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": decision, "comment": comment},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    return resp.json()


def test_the_last_signature_completes_the_stage_by_itself(manager, approver):  # noqa: F811
    base, event_id, route = _event_sent(manager)

    data = _decide(approver, base, route[0]["id"], "APPROVED")

    assert data["stage"] == "ACKNOWLEDGEMENT"
    assert data["approvalStatus"] == "APPROVED"
    assert data["visitObjects"][0]["documentStatus"] == "APPROVED"


def test_a_signature_that_is_not_the_last_waits(manager, approver):  # noqa: F811
    base, event_id, route = _event_sent(manager, approvers=("Первый", "Второй"))

    data = _decide(approver, base, route[0]["id"], "APPROVED")

    assert data["stage"] == "APPROVAL", "этап ушёл по первой подписи из двух"
    data = _decide(approver, base, route[1]["id"], "APPROVED")
    assert data["stage"] == "ACKNOWLEDGEMENT"


def test_an_open_remark_holds_the_stage_and_its_answer_releases_it(
    manager, approver  # noqa: F811
):
    """Держит только открытое замечание (`[ВОЗ-05]`); ответ на него — тоже
    «последняя подпись»."""
    base, event_id, route = _event_sent(manager, approvers=("Первый", "Второй"))
    # Первый вернул с замечанием — объект уехал на «Расстановку»; завершаем
    # расстановку и отправляем снова: маршрут проходится заново.
    _decide(approver, base, route[0]["id"], "RETURNED", "уточнить пост")
    manager.post(f"{base}placement/complete/")
    manager.post(f"{base}approval/send/")
    fresh = manager.get(base).json()["visitObjects"][0]
    route = fresh["approvalRoute"]
    remark_id = fresh["approvalRemarks"][0]["id"]

    _decide(approver, base, route[0]["id"], "APPROVED")
    data = _decide(approver, base, route[1]["id"], "APPROVED")
    assert data["stage"] == "APPROVAL", "открытое замечание не удержало этап"

    resp = manager.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {"decision": "RESOLVED"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "ACKNOWLEDGEMENT"


def test_a_return_decision_returns_the_object_at_once(manager, approver):  # noqa: F811
    base, event_id, route = _event_sent(manager)

    data = _decide(approver, base, route[0]["id"], "RETURNED", "заменить старшего")

    assert data["stage"] == "PLACEMENT"
    visit_row = data["visitObjects"][0]
    assert visit_row["approvalStatus"] == "RETURNED"
    assert visit_row["approvalComment"] == "заменить старшего"
    assert visit_row["documentStatus"] == "RETURNED"
    assert [r["text"] for r in visit_row["approvalRemarks"]] == ["заменить старшего"]


def test_a_stale_placement_does_not_autocomplete_but_the_signature_stands(
    manager, approver  # noqa: F811
):
    """Автозавершение — побочный эффект подписи и не имеет права её срывать:
    подпись записана, этап ждёт повторной отправки."""
    base, event_id, route = _event_sent(manager)
    # Расстановку меняют ЧЕРЕЗ возврат (иначе заморозка) и завершают заново,
    # но НЕ отправляют — снимок устарел.
    _decide(approver, base, route[0]["id"], "RETURNED", "переделать")
    fresh = manager.get(base).json()
    victim = fresh["placementAssignments"][0]
    manager.delete(f"{base}placement/{victim['id']}/")
    manager.post(
        f"{base}placement/assign/",
        {"postId": victim["postId"], "employeeId": str(make_employee().pk)},
        format="json",
    )
    manager.post(f"{base}placement/complete/")
    # Отправляем, потом снова меняем через возврат/завершение без отправки.
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    _decide(approver, base, route[0]["id"], "RETURNED", "ещё раз")
    fresh = manager.get(base).json()
    victim = fresh["placementAssignments"][0]
    manager.delete(f"{base}placement/{victim['id']}/")
    manager.post(
        f"{base}placement/assign/",
        {"postId": victim["postId"], "employeeId": str(make_employee().pk)},
        format="json",
    )
    manager.post(f"{base}placement/complete/")
    # Маршрут после возврата помечен RETURNED — «подписать» его без отправки
    # нельзя (APPROVAL_NOT_SENT ловит только NOT_SENT). Отправляем, а затем
    # ещё раз ломаем снимок — теперь напрямую нельзя (заморозка), поэтому
    # проверяем через сервис: подпись при устаревшем снимке не завершает.
    manager.post(f"{base}approval/send/")
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    visit.approval_snapshot = "устаревший"
    visit.save(update_fields=["approval_snapshot"])
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    data = _decide(approver, base, route[0]["id"], "APPROVED")

    assert data["stage"] == "APPROVAL", "устаревшая расстановка завершила этап"
    assert data["visitObjects"][0]["approvalRoute"][0]["status"] == "APPROVED", (
        "отказ автозавершения сорвал саму подпись"
    )
    assert data["visitObjects"][0]["approvalStale"] is True


def test_the_manual_approve_endpoint_still_works(manager, approver):  # noqa: F811
    """Ручка `approve/` остаётся под админа и API: когда автозавершение не
    сработало (например, устаревший снимок отправили заново), ею можно
    закончить руками — без второй копии правил."""
    base, event_id, route = _event_sent(manager)
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    visit.approval_snapshot = "устаревший"
    visit.save(update_fields=["approval_snapshot"])
    _decide(approver, base, route[0]["id"], "APPROVED")  # не завершило
    assert manager.get(base).json()["stage"] == "APPROVAL"
    # Возвращаем снимок в актуальный — как сделала бы повторная отправка.
    manager.post(f"{base}approval/withdraw/")
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    visit.refresh_from_db()
    visit.approval_snapshot = "устаревший"
    visit.save(update_fields=["approval_snapshot"])
    _decide(approver, base, route[0]["id"], "APPROVED")
    visit.refresh_from_db()
    from organization_management.apps.ops import security_events as service
    from organization_management.apps.ops.security_events import placement_signature
    event = service.lock_event(event_id)
    visit.approval_snapshot = placement_signature(event, visit)
    visit.save(update_fields=["approval_snapshot"])

    resp = approver.post(f"{base}approval/approve/")

    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "ACKNOWLEDGEMENT"
