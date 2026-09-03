"""Этап «Согласование» по эталону прототипа (задача заказчика «ОМ-37.3»).

Согласуют не «мероприятие вообще», а КОНКРЕТНУЮ расстановку. Отсюда всё
остальное: отправка фиксирует снимок состава, изменение состава после отправки
сбрасывает согласование, а завершение этапа проверяет пять разных условий — и
каждое отвечает своим кодом, потому что чинятся они по-разному.

Сквозной проход этапа лежит в `test_ops_security_events_api` (жизненный цикл
целиком). Здесь — правила, которые сквозной проход не показывает: устаревший
снимок, отзыв, перестановка маршрута и то, что решения переживают отзыв.
"""
import pytest

from organization_management.apps.ops import security_events as service

from .test_ops_security_events_api import (  # noqa: F401
    approver,
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def event_on_approval(manager):  # noqa: F811
    """ОМ, доведённое до «Согласования» с одним назначением."""
    obj = make_object(with_passport=True)
    employee = make_employee()
    event_id = create_event(manager, obj).json()["id"]
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
    # Завершение рекогносцировки САМО проводит «Потребность» и «Запрос сил» и
    # оставляет ОМ на «Расстановке» (Plane №110); ручного ведения этих стадий
    # больше нет — ручки сняты (Plane №149). Фикстура шла старым путём и
    # держалась только на том, что снятые вызовы молча отбивались.
    manager.post(f"{base}recon/complete/")
    fresh = manager.get(f"{base}").json()
    post_id = fresh["reconSectorPosts"][0]["id"]
    manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}placement/complete/")
    return base, str(employee.pk), post_id


def add_approver(manager, base, name="К. Оразов"):  # noqa: F811
    # Маршрут заводит ВЕДУЩИЙ мероприятие, а не согласующий: это работа
    # исполнителя (Plane №267).
    return manager.post(
        f"{base}approval/route/",
        {"name": name, "unit": "Департамент охраны", "position": "Заместитель"},
        format="json",
    ).json()["approvalRoute"]


# ── Снимок расстановки ───────────────────────────────────────────────────


def test_changing_the_placement_after_sending_invalidates_approval(manager, approver):  # noqa: F811
    """Подпись под одним составом ничего не говорит о другом.

    Проба меняет ИМЕННО состав (снимает назначение), а не что-нибудь ещё в
    карточке: «расстановка изменилась» обязано ловить перестановку людей, а не
    любое касание мероприятия.
    """
    base, employee_id, post_id = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")
    data = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    ).json()
    assert data["approvalStale"] is False

    # Расстановку правят после согласования.
    assignment_id = data["placementAssignments"][0]["id"]
    data = manager.delete(f"{base}placement/{assignment_id}/").json()

    assert data["approvalStale"] is True
    resp = approver.post(f"{base}approval/approve/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "APPROVAL_STALE"


class _VisitStub:
    """Объект посещения «на бумаге».

    СНИМОК РАССТАНОВКИ ЖИВЁТ У ОБЪЕКТА, а не у мероприятия (Plane №411, Ш-5
    плана №385): согласуют объект, и его подпись считается по ЕГО постам.
    Поэтому бумажная модель переехала сюда вместе с полем — иначе проба
    сторожила бы столбец, в который больше никто не пишет.
    """

    pk = 1

    def __init__(self, snapshot=""):
        self.approval_snapshot = snapshot


class _VisitManagerStub:
    """Ровно то, что спрашивает `visit_object_posts`: сколько их всего."""

    def __init__(self, total):
        self._total = total

    def count(self):
        return self._total


class _Stub:
    """Мероприятие «на бумаге»: подпись расстановки — чистая функция от
    назначений, и гонять ради неё всю цепочку стадий незачем."""

    def __init__(self, assignments, snapshot=""):
        self.placement_assignments = assignments
        # Посты нужны разрезу по объекту: чьи назначения входят в подпись,
        # решается по постам объекта. Объект здесь ОДИН — значит его все.
        self.recon_sector_posts = [
            {"id": row["postId"], "visitObjectId": None} for row in assignments
        ]
        self.visit_objects = _VisitManagerStub(1)
        self.visit = _VisitStub(snapshot)


def test_the_snapshot_is_blind_to_the_order_of_assignments():
    """Порядок назначений в списке — деталь хранения, а не факт о составе.

    Без сортировки в подписи перестановка тех же людей по тем же постам
    объявляла бы согласование недействительным — ложная тревога, после которой
    баннеру перестают верить.

    ТРИ назначения, а не одно: на списке из одного элемента перестановка не
    меняет ничего, и проба была бы зелена и без сортировки.
    """
    rows = [
        {"postId": "p-1", "employeeId": "7"},
        {"postId": "p-2", "employeeId": "3"},
        {"postId": "p-3", "employeeId": "5"},
    ]
    signature = service.placement_signature(_Stub(rows))

    shuffled = _Stub([rows[2], rows[0], rows[1]], snapshot=signature)

    assert service.placement_signature(shuffled) == signature
    assert service.approval_is_stale(shuffled, shuffled.visit) is False


def test_a_different_person_on_the_same_post_changes_the_signature():
    """Обратная половина: подпись обязана ЛОВИТЬ смену состава, иначе
    «расстановка не менялась» было бы вечнозелёным."""
    rows = [
        {"postId": "p-1", "employeeId": "7"},
        {"postId": "p-2", "employeeId": "3"},
        {"postId": "p-3", "employeeId": "5"},
    ]
    signature = service.placement_signature(_Stub(rows))

    replaced = _Stub(
        [rows[0], {"postId": "p-2", "employeeId": "9"}, rows[2]],
        snapshot=signature,
    )

    assert service.placement_signature(replaced) != signature
    assert service.approval_is_stale(replaced, replaced.visit) is True


def test_an_event_never_sent_is_not_stale(manager):  # noqa: F811
    """Пустой снимок — «не отправляли», а не «не изменилась»: сравнивать не с
    чем, и баннер о повторном согласовании там был бы шумом."""
    base, _, _ = event_on_approval(manager)
    add_approver(manager, base)

    data = manager.get(f"{base}").json()

    assert data["approvalStale"] is False


# ── Отправка и отзыв ─────────────────────────────────────────────────────


def test_sending_requires_a_route_and_a_placement(manager):  # noqa: F811
    base, _, _ = event_on_approval(manager)

    resp = manager.post(f"{base}approval/send/")
    assert resp.json()["error_code"] == "APPROVAL_ROUTE_EMPTY"


def test_withdrawing_keeps_decisions_already_taken(manager, approver):  # noqa: F811
    """Согласовавший согласовал: стирать чужое решение отзывом значило бы
    переписывать историю. Отзыв снимает только НЕРЕШЁННОЕ."""
    base, _, _ = event_on_approval(manager)
    route = add_approver(manager, base)
    route = add_approver(manager, base, name="А. Жанибеков")
    manager.post(f"{base}approval/send/")
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    data = manager.post(f"{base}approval/withdraw/").json()

    by_id = {item["id"]: item for item in data["approvalRoute"]}
    assert by_id[route[0]["id"]]["status"] == "APPROVED"
    assert by_id[route[1]["id"]]["status"] == "NOT_SENT"


def test_resending_keeps_the_return_reason_and_clears_the_rest(manager, approver):  # noqa: F811
    """Причина возврата объясняет, что чинили, и нужна тому же согласующему
    при повторном решении; «Без замечаний» от прошлого состава — нет."""
    base, _, _ = event_on_approval(manager)
    route = add_approver(manager, base)
    route = add_approver(manager, base, name="А. Жанибеков")
    manager.post(f"{base}approval/send/")
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )
    approver.post(
        f"{base}approval/route/{route[1]['id']}/decide/",
        {"decision": "RETURNED", "comment": "поменять старшего"},
        format="json",
    )

    data = manager.post(f"{base}approval/send/").json()

    by_id = {item["id"]: item for item in data["approvalRoute"]}
    assert by_id[route[0]["id"]]["comment"] == ""
    assert by_id[route[1]["id"]]["comment"] == "поменять старшего"
    assert {item["status"] for item in data["approvalRoute"]} == {"PENDING"}


# ── Маршрут ──────────────────────────────────────────────────────────────


def test_approvers_can_be_reordered(manager, approver):  # noqa: F811
    """Порядок в маршруте — позиция в списке, и он значим: по нему читают,
    кто согласует первым."""
    base, _, _ = event_on_approval(manager)
    add_approver(manager, base, name="Первый")
    route = add_approver(manager, base, name="Второй")

    data = manager.post(
        f"{base}approval/route/{route[1]['id']}/move/",
        {"direction": "UP"},
        format="json",
    ).json()

    assert [item["name"] for item in data["approvalRoute"]] == ["Второй", "Первый"]


def test_moving_past_the_edge_changes_nothing(manager, approver):  # noqa: F811
    """Край списка — не ошибка, а «дальше некуда»: отказ заставлял бы клиента
    считать границы, которые сервер и так знает."""
    base, _, _ = event_on_approval(manager)
    route = add_approver(manager, base, name="Первый")
    add_approver(manager, base, name="Второй")

    data = manager.post(
        f"{base}approval/route/{route[0]['id']}/move/",
        {"direction": "UP"},
        format="json",
    ).json()

    assert [item["name"] for item in data["approvalRoute"]] == ["Первый", "Второй"]


# ── Замечания ────────────────────────────────────────────────────────────


def test_two_returns_by_the_same_approver_give_two_remarks(manager, approver):  # noqa: F811
    """Замечания — отдельный список, а не поле у согласующего: один и тот же
    человек возвращает дважды по разным поводам, и вторая причина затёрла бы
    первую, хотя закрывают их по одной."""
    base, _, _ = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "первое замечание"},
        format="json",
    )
    manager.post(f"{base}approval/send/")
    data = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "второе замечание"},
        format="json",
    ).json()

    assert [item["text"] for item in data["approvalRemarks"]] == [
        "первое замечание",
        "второе замечание",
    ]


def test_a_remark_can_be_reopened(manager, approver):  # noqa: F811
    """«Устранено» — не финальное состояние: замечание закрывают ошибочно, и
    вернуть его в работу должно быть можно, иначе этап завершат по недосмотру.

    Возврат к «Открыто» — той же ручкой (`decision="OPEN"`), а не отдельным
    путём: снятое решение симметрично отзыву согласования."""
    base, _, _ = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")
    data = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "замечание"},
        format="json",
    ).json()
    remark_id = data["approvalRemarks"][0]["id"]

    manager.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {"decision": "RESOLVED"},
        format="json",
    )
    data = manager.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {"decision": "OPEN"},
        format="json",
    ).json()

    assert data["approvalRemarks"][0]["status"] == "OPEN"
    assert data["approvalRemarks"][0]["respondedAt"] is None


# ── Разграничение: утверждающий решает, но не правит (Plane №267) ───────────


def test_the_approver_decides_without_the_right_to_lead_the_event(manager, approver):  # noqa: F811
    """Утверждающий подписывает БЕЗ права вести мероприятие.

    Решение заказчика 28.08.2026: «утверждающий только видит всю расстановку,
    но изменять не может, только согласовать или отклонить с комментарием».
    До этого подпись и правка охранялись одним `event.manage`.

    Красная на мутации: верни `approval_route_decide` и `approval_approve`
    под `event.manage` — обе строки ниже ответят 403.
    """
    base, _employee_id, _post_id = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")

    decided = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": "Согласовано."},
        format="json",
    )
    approved = approver.post(f"{base}approval/approve/")

    assert decided.status_code == 200, decided.data
    assert approved.status_code == 200, approved.data
    assert approved.json()["approvalStatus"] == "APPROVED"


def test_the_approver_cannot_touch_the_placement_he_signs(manager, approver):  # noqa: F811
    """И НЕ МОЖЕТ ПРАВИТЬ то, что подписывает.

    Вторая половина того же решения, и без неё первая ничего не значит: право
    решать, выданное вместе с правом переписывать, — это по-прежнему одно
    полномочие.
    """
    base, employee_id, post_id = event_on_approval(manager)

    assigning = approver.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": employee_id},
        format="json",
    )
    routing = approver.post(
        f"{base}approval/route/",
        {"name": "Свой человек", "unit": "Отдел", "position": "Заместитель"},
        format="json",
    )
    sending = approver.post(f"{base}approval/send/")

    assert assigning.status_code == 403
    assert routing.status_code == 403
    assert sending.status_code == 403


def test_the_event_lead_no_longer_decides_for_the_approver(manager):  # noqa: F811
    """А ВЕДУЩИЙ мероприятие больше не решает за согласующего.

    Обратная сторона разграничения: пока подпись открывалась `event.manage`,
    исполнитель мог подписать собственную расстановку сам.
    """
    base, _employee_id, _post_id = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")

    decided = manager.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": "Сам себе."},
        format="json",
    )

    assert decided.status_code == 403
