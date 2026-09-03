"""Завершение расстановки с недобором (`[РАС-06]`, Plane №396).

Спецификация буквально: «Завершить расстановку»: активна при полной
укомплектованности; иначе подтверждение «K постов без людей. Завершить с
недобором?» + комментарий. После завершения → этап 3, документ «Расстановка
сил» версия 1 в статусе «Черновик»».

Пробы стерегут:

1. полная укомплектованность завершает БЕЗ подтверждения;
2. недобор без `override` — мягкий конфликт 409 с числом пустых постов,
   объект остаётся на «Расстановке»;
3. `override` без комментария — отбит: «завершили без объяснения» неисполнимо;
4. `override` с комментарием — завершает, пишет именной след в журнал;
5. документ получает версию 1 РОВНО ЗДЕСЬ, а не при первой отправке;
6. завершение — операция ОБЪЕКТА: у ОМ с двумя объектами одно завершение не
   трогает соседний.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def event_ready_for_placement(manager):  # noqa: F811
    """ОМ на «Расстановке», посты завезены, ни один не занят."""
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба недобора",
            "objectId": str(obj.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    manager.post(f"{base}recon/import-from-passport/")
    data = manager.get(base).json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    return base, event_id


def _visit(event_id):
    return OpsSecurityEventVisitObject.objects.get(event_id=event_id)


def test_fully_staffed_completes_without_confirmation(
    manager, event_ready_for_placement  # noqa: F811
):
    base, event_id = event_ready_for_placement
    posts = manager.get(base).json()["reconSectorPosts"]
    for post in posts:
        for _ in range(post["need"]):
            employee = make_employee()
            resp = manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(employee.pk)},
                format="json",
            )
            assert resp.status_code == 200, resp.content

    resp = manager.post(f"{base}placement/complete/")

    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "APPROVAL"
    assert _visit(event_id).document_version == 1


def test_shortage_without_override_is_a_soft_conflict(
    manager, event_ready_for_placement  # noqa: F811
):
    base, event_id = event_ready_for_placement

    resp = manager.post(f"{base}placement/complete/")

    assert resp.status_code == 409, resp.content
    body = resp.json()
    assert body["error_code"] == "PLACEMENT_UNDERSTAFFED"
    posts = manager.get(base).json()["reconSectorPosts"]
    assert body["details"]["unfilledCount"] == len(posts)
    assert "Завершить с недобором" in body["message"]
    event = service.lock_event(event_id)
    assert event.stage == "PLACEMENT", "объект уехал вперёд без подтверждения"
    assert _visit(event_id).document_version == 0, "версия выдана без завершения"


def test_override_without_a_comment_is_refused(
    manager, event_ready_for_placement  # noqa: F811
):
    """«Завершили с недобором без объяснения» неисполнимо для штаба, который
    потом ищет недостающих людей — комментарий обязателен, как и у обхода
    предупреждения по рейтингу при назначении."""
    base, event_id = event_ready_for_placement

    resp = manager.post(
        f"{base}placement/complete/", {"override": True}, format="json"
    )

    assert resp.status_code == 409, resp.content
    assert resp.json()["error_code"] == "PLACEMENT_UNDERSTAFFED"
    assert service.lock_event(event_id).stage == "PLACEMENT"


def test_override_with_a_comment_completes_and_leaves_a_named_trail(
    manager, event_ready_for_placement  # noqa: F811
):
    base, event_id = event_ready_for_placement

    resp = manager.post(
        f"{base}placement/complete/",
        {"override": True, "override_reason": "Второй кандидат заболел."},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "APPROVAL"
    entry = OpsAuditLog.objects.filter(
        action=audit_service.PLACEMENT_COMPLETED_WITH_SHORTAGE
    ).latest("created_at")
    assert entry.new_value["comment"] == "Второй кандидат заболел."
    assert entry.new_value["visitObjectId"] == str(_visit(event_id).pk)


def test_the_document_gets_version_one_here_not_at_first_send(
    manager, event_ready_for_placement  # noqa: F811
):
    """`[РАС-06]`: «версия 1 в статусе Черновик» — СРАЗУ после завершения
    расстановки, до какой-либо отправки согласующим."""
    base, event_id = event_ready_for_placement

    manager.post(
        f"{base}placement/complete/",
        {"override": True, "override_reason": "Недобор ради пробы."},
        format="json",
    )

    visit_row = manager.get(base).json()["visitObjects"][0]
    assert visit_row["documentVersion"] == 1
    assert visit_row["approvalRoute"] == [], "маршрут ещё не заводили"


def test_completing_one_object_does_not_touch_the_other(manager):  # noqa: F811
    """Завершение — операция ОБЪЕКТА, а не мероприятия целиком: у второго
    объекта своя расстановка, и она не должна получить чужую версию."""
    first_object = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба недобора: два объекта",
            "objectId": str(first_object.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    second_object = make_object(
        code="OBJ-SHORTAGE-2", name="Второй объект", with_passport=True
    )
    manager.post(f"{base}visit-objects/", {"objectId": str(second_object.pk)}, format="json")
    first, second = OpsSecurityEventVisitObject.objects.filter(
        event_id=event_id
    ).order_by("position", "pk")
    manager.post(
        f"{base}recon/import-from-passport/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )
    data = manager.get(base).json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")

    resp = manager.post(
        f"{base}placement/complete/",
        {
            "visitObjectId": str(first.pk),
            "override": True,
            "override_reason": "Недобор у первого объекта.",
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.stage == "APPROVAL"
    assert first.document_version == 1
    assert second.stage == "PLACEMENT", "соседний объект уехал вперёд"
    assert second.document_version == 0, "соседний объект получил чужую версию"
    event = service.lock_event(event_id)
    assert event.stage == "PLACEMENT", "мероприятие взяло наибольшую, а не наименьшую"
