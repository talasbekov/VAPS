"""Версии документа «Расстановка сил» и заморозка (`[СОГ-04]`, Plane №398).

Спецификация: «После согласования версия замораживается: правка невозможна;
любое изменение (замена человека и т.п.) = новая версия → повторное
согласование. Все версии хранятся, видны в „Истории версий“; отменённые
помечены».

Пробы стерегут:

1. завершение расстановки заводит версию 1 «Черновик» СТРОКОЙ истории;
2. первая отправка НЕ меняет номер — черновик становится «На согласовании»
   (`[СОГ-01]`); номер растёт только повторной отправкой после возврата
   (`[ВОЗ-06]`), и прежняя версия помечается отменённой;
3. согласование и возврат ставят статус ТЕКУЩЕЙ версии;
4. заморозка: пока объект не на «Расстановке», назначение, снятие и смена
   старшего сектора отбиваются — иначе подписанный состав менялся бы молча;
5. история отдаётся контрактом целиком, включая отменённые.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsPlacementDocumentVersion,
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


@pytest.fixture
def staffed_event(manager):  # noqa: F811
    """ОМ на «Расстановке» с одним постом и ОДНИМ занятым местом на нём.

    Расстановка НЕ завершена — пробы завершают её сами, чтобы видеть, что
    именно завёл переход.
    """
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба версий документа",
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
            resp = manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(make_employee().pk)},
                format="json",
            )
            assert resp.status_code == 200, resp.content
    return base, event_id, posts


def _versions(event_id):
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    return list(visit.document_versions.order_by("number"))


def _send_and_return(manager, approver, base):  # noqa: F811
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    # Возврат подписанта — ДЕЙСТВИЕ (`[СОГ-08]`, №399): объект уже на
    # «Расстановке», отдельного `approval/return/` не нужно.
    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "переделать"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "PLACEMENT"


# ── Заведение и рост номера ─────────────────────────────────────────────────


def test_completing_placement_opens_version_one_as_a_draft(manager, staffed_event):  # noqa: F811
    base, event_id, _ = staffed_event

    resp = manager.post(f"{base}placement/complete/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "DRAFT")]
    assert rows[0].signature != "", "снимок состава пуст — подписывать нечего"
    assert rows[0].snapshot.get("assignments"), "снимок без назначений"
    visit_row = resp.json()["visitObjects"][0]
    assert visit_row["documentStatus"] == "DRAFT"
    assert visit_row["documentVersions"][0]["number"] == 1


def test_the_first_sending_keeps_the_number_and_submits_the_draft(
    manager, staffed_event  # noqa: F811
):
    """`[СОГ-01]`: Черновик → На согласовании — ТА ЖЕ версия. Номер растёт
    только повторной отправкой после возврата (`[ВОЗ-06]`)."""
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )

    resp = manager.post(f"{base}approval/send/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "SUBMITTED")]
    assert rows[0].sent_at is not None
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert visit.document_version == 1, "первая отправка накрутила номер"


def test_resending_after_a_return_opens_the_next_version(
    manager, approver, staffed_event  # noqa: F811
):
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)
    manager.post(f"{base}placement/complete/")

    resp = manager.post(f"{base}approval/send/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [
        (1, "RETURNED"),
        (2, "SUBMITTED"),
    ]
    # Отменённая помечена, статус её не стёрт — история честная.
    assert rows[0].superseded_at is not None
    assert rows[1].superseded_at is None
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert visit.document_version == 2


def test_approving_marks_the_current_version(manager, approver, staffed_event):  # noqa: F811
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    # Последняя подпись завершает согласование сама (`[СОГ-09]`, №399).
    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "APPROVED")]
    assert rows[0].decided_at is not None
    assert resp.json()["visitObjects"][0]["documentStatus"] == "APPROVED"


# ── Заморозка ───────────────────────────────────────────────────────────────


def test_a_submitted_placement_cannot_be_changed(manager, staffed_event):  # noqa: F811
    """ОТПРАВЛЕННЫЙ документ менять нельзя: под ним подписываются.

    🔴 ПРОБА ПЕРЕВЁРНУТА В ПЕРВОЙ ПОЛОВИНЕ ОСОЗНАННО (Plane №533). Здесь
    заморозка проверялась СРАЗУ после `placement/complete/`, то есть когда
    документ ещё ЧЕРНОВИК и никому не отправлен. Это и был дефект: оператор не
    мог поправить собственную расстановку, а единственный путь разморозки
    требовал, чтобы согласующий вернул документ, которого он не получал.
    Спецификация `[СОГ-04]` говорит о ДОКУМЕНТЕ, а не об этапе: черновик
    правится, отправленный и согласованный — нет.

    Поэтому проба теперь проверяет ОБЕ границы: до отправки правка проходит,
    после отправки — отбивается. Одной второй половины мало: мутация
    «замораживать всегда» оставила бы её зелёной.
    """
    base, event_id, posts = staffed_event
    manager.post(f"{base}placement/complete/")

    # Предпосылка пробы названа ЯВНО: объект уже на «Согласовании», а документ
    # ещё черновик — именно это сочетание и запирало оператора.
    shown = manager.get(base).json()["visitObjects"][0]
    assert shown["documentStatus"] == "DRAFT", shown
    assert shown["stage"] == "APPROVAL", shown

    # Документ — черновик: правка своей же расстановки идёт.
    draft_edit = manager.post(
        f"{base}placement/assign/",
        {
            "postId": posts[0]["id"],
            "employeeId": str(make_employee().pk),
            "override": True,
            "override_reason": "усиление поста на время проверки",
        },
        format="json",
    )
    assert draft_edit.status_code == 200, draft_edit.content

    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    sent = manager.post(f"{base}approval/send/")
    assert sent.status_code == 200, sent.content
    assignment = manager.get(base).json()["placementAssignments"][0]

    assign = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": str(make_employee().pk)},
        format="json",
    )
    unassign = manager.delete(f"{base}placement/{assignment['id']}/")
    senior = manager.post(
        f"{base}placement/{assignment['id']}/senior/",
        {"senior": True},
        format="json",
    )

    for resp in (assign, unassign, senior):
        assert resp.status_code == 422, resp.content
        assert resp.json()["error_code"] == "PLACEMENT_FROZEN"


def test_a_returned_placement_is_editable_again(manager, approver, staffed_event):  # noqa: F811
    """Возврат размораживает: объект снова на «Расстановке», правка = будущая
    новая версия (`[СОГ-04]`)."""
    base, event_id, posts = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)

    # Пост расписан фикстурой полностью, и добавка сверх расчёта — усиление
    # (Plane №414). Пробу интересует РАЗМОРОЗКА правки после возврата, а не
    # правило усиления, поэтому обоснование даётся сразу: иначе проба
    # проверяла бы 409 вместо того, ради чего написана.
    resp = manager.post(
        f"{base}placement/assign/",
        {
            "postId": posts[0]["id"],
            "employeeId": str(make_employee().pk),
            "override": True,
            "override_reason": "Усиление поста: проба правит расстановку после возврата",
        },
        format="json",
    )

    assert resp.status_code == 200, resp.content


def test_the_history_is_served_whole_including_superseded(
    manager, approver, staffed_event  # noqa: F811
):
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)
    manager.post(f"{base}placement/complete/")
    manager.post(f"{base}approval/send/")

    rows = manager.get(base).json()["visitObjects"][0]["documentVersions"]

    assert [(r["number"], r["status"]) for r in rows] == [
        (1, "RETURNED"),
        (2, "SUBMITTED"),
    ]
    assert rows[0]["supersededAt"] is not None
    assert rows[1]["supersededAt"] is None
