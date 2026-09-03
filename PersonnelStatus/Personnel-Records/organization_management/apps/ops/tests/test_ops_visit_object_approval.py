"""Согласование и документ «Расстановка сил» — по объекту посещения.

Plane №411, Ш-5 плана №385. Требование `[МД-04]`: «У объекта свои этапы 1–5 и
свой документ „Расстановка сил“ **с версиями**». До этого шага маршрут,
замечания и снимок состава были полями МЕРОПРИЯТИЯ: у ОМ с двумя объектами
согласующий подписывался под общим списком, где посты двух разных мест лежали
вперемешку, а вернуть на доработку ОДИН объект было нельзя вовсе.

Пробы стерегут ровно то, что на глаз не видно:

1. маршрут ложится в ОБЪЕКТ, а поле мероприятия больше не пишется;
2. у двух объектов маршруты РАЗНЫЕ и не смешиваются, а без адреса сервер
   отказывает, а не выбирает первый попавшийся;
3. снимок расстановки считается по постам ОБЪЕКТА: правка соседнего объекта не
   объявляет чужое согласование устаревшим;
4. номер версии документа растит ОТПРАВКА и не откатывает отзыв;
5. мероприятие уходит на «Ознакомление», только когда согласованы ВСЕ объекты,
   а возврат ОДНОГО возвращает мероприятие;
6. документ собирается по постам объекта, а при нескольких объектах без адреса
   отказывает.
"""
import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.documents_placement import (
    _document_target,
    placement_rows,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _visits(event_id):
    return list(
        OpsSecurityEventVisitObject.objects.filter(
            event_id=event_id
        ).order_by("position", "pk")
    )


@pytest.fixture
def two_objects_on_approval(manager):  # noqa: F811
    """ОМ с ДВУМЯ объектами, доведённое до «Согласования».

    Оба объекта с постами и с назначением: без назначения отправка отбивается
    «расстановка пуста», и проба про снимок оказалась бы вакуумной.
    """
    first_object = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба согласования по объектам",
            "objectId": str(first_object.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"

    second_object = make_object(
        code="OBJ-APPROVAL-2", name="Второй объект", with_passport=True
    )
    added = manager.post(
        f"{base}visit-objects/", {"objectId": str(second_object.pk)}, format="json"
    )
    assert added.status_code in (200, 201), added.content

    first, second = _visits(event_id)
    for visit in (first, second):
        resp = manager.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert resp.status_code == 200, resp.content

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

    posts = manager.get(base).json()["reconSectorPosts"]
    assigned = {}
    # РАЗНЫЕ ФАМИЛИИ у людей двух объектов: посты обоих импортированы из одного
    # паспорта и называются одинаково, и различить документы объектов можно
    # только по тому, кто в них стоит.
    for visit, last_name in ((first, "Первов"), (second, "Второв")):
        post = next(
            p for p in posts if p["visitObjectId"] == str(visit.pk)
        )
        employee = make_employee(last_name=last_name)
        resp = manager.post(
            f"{base}placement/assign/",
            {"postId": post["id"], "employeeId": str(employee.pk)},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        assigned[str(visit.pk)] = post["id"]

    # Все посты обязаны быть укомплектованы — иначе этап не завершается.
    fresh = manager.get(base).json()
    staffed = {a["postId"] for a in fresh["placementAssignments"]}
    for post in fresh["reconSectorPosts"]:
        while (
            sum(1 for a in manager.get(base).json()["placementAssignments"]
                if a["postId"] == post["id"])
            < post["need"]
        ):
            employee = make_employee()
            resp = manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(employee.pk)},
                format="json",
            )
            assert resp.status_code == 200, resp.content
        staffed.add(post["id"])
    # Завершение расстановки — ОПЕРАЦИЯ ОБЪЕКТА (Plane №396, `[РАС-06]`): у
    # каждого объекта своя расстановка, и завершать её нужно по отдельности.
    for visit in (first, second):
        done = manager.post(
            f"{base}placement/complete/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert done.status_code == 200, done.content
    return base, event_id, first, second, assigned


def _add_approver(manager, base, visit, name="К. Оразов"):  # noqa: F811
    resp = manager.post(
        f"{base}approval/route/",
        {
            "name": name,
            "unit": "Департамент охраны",
            "position": "Заместитель",
            "visitObjectId": str(visit.pk),
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    return resp.json()


# ── Маршрут принадлежит объекту ─────────────────────────────────────────────


def test_the_route_lands_in_the_visit_object_and_not_in_the_event(
    manager, two_objects_on_approval  # noqa: F811
):
    """Писатель у поля объекта обязан быть, а поле мероприятия — замереть.

    Ровно этой болезнью болел `visitObjectId` до №408: читатели есть, писателей
    ноль. Проба спрашивает ОБА места, а не одно.
    """
    base, event_id, first, second, _ = two_objects_on_approval

    _add_approver(manager, base, first)

    first.refresh_from_db()
    second.refresh_from_db()
    assert [a["name"] for a in first.approval_route] == ["К. Оразов"]
    assert second.approval_route == [], "маршрут уехал и в чужой объект"
    # Поле `event.approval_route` СНЯТО с мероприятия (Plane №413, Ш-7): у
    # него больше некуда «всё ещё писать» — ассерт на этот счёт стал
    # невозможен вместе с полем, а не только не нужен.


def test_the_route_of_one_object_is_not_the_route_of_the_other(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _, first, second, _ = two_objects_on_approval

    _add_approver(manager, base, first, name="Первый согласующий")
    _add_approver(manager, base, second, name="Второй согласующий")

    first.refresh_from_db()
    second.refresh_from_db()
    assert [a["name"] for a in first.approval_route] == ["Первый согласующий"]
    assert [a["name"] for a in second.approval_route] == ["Второй согласующий"]


def test_the_address_is_required_when_objects_are_many(
    manager, two_objects_on_approval  # noqa: F811
):
    """Угадать адресата хуже, чем попросить выбрать: приписанное чужому объекту
    согласование потом не отличить от названного."""
    base, _, _, _, _ = two_objects_on_approval

    resp = manager.post(
        f"{base}approval/route/",
        {"name": "Без адреса", "unit": "", "position": ""},
        format="json",
    )

    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "VISIT_OBJECT_REQUIRED"


# ── Снимок расстановки — по постам объекта ──────────────────────────────────


def test_changing_the_neighbour_does_not_stale_this_objects_approval(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Подпись объекта считается по ЕГО постам.

    Пока снимок брался со всего мероприятия, снятие человека с поста ВТОРОГО
    объекта объявляло согласование ПЕРВОГО недействительным — ложная тревога,
    после которой баннеру перестают верить.

    Второй объект сначала ВОЗВРАЩАЕТСЯ на расстановку (`[СОГ-04]`, №398): на
    «Согласовании» его состав заморожен, и снять человека нельзя.
    """
    base, _, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    back = approver.post(
        f"{base}approval/return/",
        {"comment": "переделать второй", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content

    # Снимаем человека с поста ВТОРОГО объекта.
    fresh = manager.get(base).json()
    second_posts = {
        p["id"]
        for p in fresh["reconSectorPosts"]
        if p["visitObjectId"] == str(second.pk)
    }
    victim = next(
        a for a in fresh["placementAssignments"] if a["postId"] in second_posts
    )
    removed = manager.delete(f"{base}placement/{victim['id']}/")
    assert removed.status_code == 200, removed.content

    event = service.lock_event(_visits(fresh["id"])[0].event_id)
    first.refresh_from_db()
    second.refresh_from_db()
    assert service.approval_is_stale(event, first) is False
    assert service.approval_is_stale(event, second) is False, (
        "второй объект даже не отправляли — устареть нечему"
    )


def test_changing_this_object_does_stale_its_approval(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Обратная половина: подпись обязана ЛОВИТЬ смену СВОЕГО состава, иначе
    «не менялась» было бы вечнозелёным.

    Путь изменения — единственный разрешённый (`[СОГ-04]`, №398): возврат →
    правка на «Расстановке» → повторное завершение. Пока не отправили заново,
    состав отличается от ушедшего согласующим — расстановка «изменилась».
    """
    base, event_id, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    approver.post(
        f"{base}approval/return/",
        {"comment": "заменить", "visitObjectId": str(first.pk)},
        format="json",
    )

    fresh = manager.get(base).json()
    own_posts = {
        p["id"]
        for p in fresh["reconSectorPosts"]
        if p["visitObjectId"] == str(first.pk)
    }
    victim = next(
        a for a in fresh["placementAssignments"] if a["postId"] in own_posts
    )
    manager.delete(f"{base}placement/{victim['id']}/")
    manager.post(
        f"{base}placement/assign/",
        {"postId": victim["postId"], "employeeId": str(make_employee().pk)},
        format="json",
    )
    done = manager.post(
        f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert done.status_code == 200, done.content

    event = service.lock_event(event_id)
    first.refresh_from_db()
    assert service.approval_is_stale(event, first) is True


# ── Версия документа ────────────────────────────────────────────────────────


def test_the_document_version_grows_with_every_sending(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Номер версии — по `[СОГ-01]`/`[ВОЗ-06]` (Plane №398), а не «+1 на каждую
    отправку»: завершение расстановки заводит черновик v1; ПЕРВАЯ отправка
    делает его «на согласовании», номер тот же; отзыв и повторная отправка того
    же состава номер не трогают; растёт номер только повторной отправкой ПОСЛЕ
    ВОЗВРАТА — это другой состав, под ним подписываются заново.

    Проба переписана при №398: прежнее ожидание «1 → 2 → 3» было моим
    прочтением Ш-5, спецификация читается иначе.
    """
    base, _, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    first.refresh_from_db()
    assert first.document_version == 1, "черновик не заведён завершением расстановки"

    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.document_version == 1, "первая отправка накрутила номер"
    assert second.document_version == 1, "у соседа тоже черновик — своя расстановка"

    # Отзыв и повторная отправка ТОГО ЖЕ состава — тот же номер.
    manager.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    first.refresh_from_db()
    assert first.document_version == 1

    # Возврат → правка → повторная отправка: версия 2.
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "переделать", "visitObjectId": str(first.pk)},
        format="json",
    )
    approver.post(
        f"{base}approval/return/",
        {"comment": "на доработку", "visitObjectId": str(first.pk)},
        format="json",
    )
    manager.post(
        f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json"
    )
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    first.refresh_from_db()
    assert first.document_version == 2


def test_the_version_reaches_the_contract(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )

    rows = manager.get(base).json()["visitObjects"]
    mine = next(row for row in rows if row["id"] == str(first.pk))
    # Черновик v1 → первая отправка — та же v1, «на согласовании» (№398).
    assert mine["documentVersion"] == 1
    assert mine["documentStatus"] == "SUBMITTED"
    assert [a["name"] for a in mine["approvalRoute"]] == ["К. Оразов"]


# ── Стадия мероприятия ──────────────────────────────────────────────────────


def _approve(manager, base, visit):  # noqa: F811
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
    )
    visit.refresh_from_db()
    approver_id = visit.approval_route[0]["id"]
    return manager, approver_id


def test_the_event_waits_for_every_object_before_acknowledgement(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Ознакомление идёт по назначениям, а они у объектов разные: открыть его
    по первому согласованному объекту значило бы позвать людей второго
    знакомиться с расстановкой, которую ещё правят."""
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    _add_approver(manager, base, second)

    for visit in (first, second):
        _, approver_id = _approve(manager, base, visit)
        approver.post(
            f"{base}approval/route/{approver_id}/decide/",
            {
                "decision": "APPROVED",
                "comment": "",
                "visitObjectId": str(visit.pk),
            },
            format="json",
        )

    # Утверждает УТВЕРЖДАЮЩИЙ, а не ведущий мероприятие (Plane №267): у
    # `manager` этого права нет, и проба под ним проверяла бы только 403.
    done = approver.post(
        f"{base}approval/approve/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert done.status_code == 200, done.content
    event = service.lock_event(event_id)
    assert event.stage == "APPROVAL", "мероприятие ушло вперёд по одному объекту"

    approver.post(
        f"{base}approval/approve/", {"visitObjectId": str(second.pk)}, format="json"
    )
    event = service.lock_event(event_id)
    assert event.stage == "ACKNOWLEDGEMENT"
    assert event.approval_status == "APPROVED"


def test_returning_one_object_returns_the_event(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Правило обратное утверждению, и намеренно: согласование ждёт всех, а
    работа находится по одному."""
    base, event_id, first, _, _ = two_objects_on_approval

    resp = approver.post(
        f"{base}approval/return/",
        {"comment": "Переписать наряд на въезде", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content

    first.refresh_from_db()
    event = service.lock_event(event_id)
    assert first.approval_status == "RETURNED"
    assert first.approval_comment == "Переписать наряд на въезде"
    assert event.stage == "PLACEMENT"
    assert event.approval_comment == "Переписать наряд на въезде"


# ── Документ «Расстановка сил» ──────────────────────────────────────────────


def test_the_document_carries_only_the_posts_of_its_object(
    manager, two_objects_on_approval  # noqa: F811
):
    base, event_id, first, second, _ = two_objects_on_approval
    event = service.lock_event(event_id)

    own = placement_rows(event, first)
    theirs = placement_rows(event, second)

    assert own and theirs, "у объекта не оказалось постов — проба вакуумна"
    assert len(own) + len(theirs) == len(event.recon_sector_posts)
    # ИМЕНА ПОСТОВ У ОБОИХ ОБЪЕКТОВ СОВПАДАЮТ: оба импортированы из одного
    # паспорта, и «Пост 1» есть у каждого. Различает их НАЗНАЧЕННЫЙ ЧЕЛОВЕК —
    # сравнивать надо по нему, иначе проба зеленела бы и на документе,
    # собранном по всему мероприятию.
    assert not ({r["assigned"] for r in own} & {r["assigned"] for r in theirs})


def test_the_document_refuses_to_guess_the_object(
    manager, two_objects_on_approval  # noqa: F811
):
    _, event_id, _, _, _ = two_objects_on_approval
    event = service.lock_event(event_id)

    with pytest.raises(DomainError) as failure:
        _document_target(event, None)

    assert failure.value.code == "VISIT_OBJECT_REQUIRED"
