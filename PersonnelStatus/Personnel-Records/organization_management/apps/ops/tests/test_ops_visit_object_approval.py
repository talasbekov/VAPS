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
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    give_chief,  # noqa: F401
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
    give_chief(manager, event_id)

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
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
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


def test_resending_an_approved_object_supersedes_it_instead_of_overwriting(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Отправка поверх СОГЛАСОВАННОЙ версии открывает N+1, а не правит её
    (Plane №534).

    До правки `_submit_document_version` ветвился только на `RETURNED`, и
    повторная отправка согласованного объекта переписывала его строку НА
    МЕСТЕ: «Согласовано» затиралось на «На согласовании», а `decided_at`
    оставался от прежнего решения — момент согласования, которого больше нет.
    История схлопывалась в одну строку `(1, SUBMITTED, superseded_at=None)`,
    то есть запись о согласовании УНИЧТОЖАЛАСЬ — ровно противоположное тому,
    что обещает `[СОГ-04]`: «Все версии хранятся… отменённые помечены».

    🔴 ПОЧЕМУ ДВА ОБЪЕКТА, А НЕ ОДИН. Проба писалась, когда отправку сторожил
    этап МЕРОПРИЯТИЯ: на одном объекте согласование уводило мероприятие с
    «Согласования» и ручка отбивалась раньше, чем доходила до версии, а второй
    объект держал этап и открывал путь. С №475 гвард спрашивает этап ОБЪЕКТА и
    пропускает согласованный сам (`[СОГ-04]`: новая версия уходит на повторное
    согласование), так что подпорка больше не нужна — но два объекта оставлены
    намеренно: это и есть боевой случай, у ОМ с несколькими объектами каждый
    согласуется отдельно.
    """
    base, event_id, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert decided.status_code == 200, decided.content
    rows = list(first.document_versions.order_by("number"))
    assert [(r.number, r.status) for r in rows] == [(1, "APPROVED")]
    approved_at = rows[0].decided_at
    assert approved_at is not None

    resp = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )

    assert resp.status_code == 200, resp.content
    rows = list(first.document_versions.order_by("number"))
    assert [(r.number, r.status) for r in rows] == [
        (1, "APPROVED"),
        (2, "SUBMITTED"),
    ], "согласованная версия переписана вместо того, чтобы быть перекрытой"
    # Согласованная остаётся согласованной и помечена отменённой; момент её
    # решения — прежний, а не протухший рядом с новым статусом.
    assert rows[0].superseded_at is not None
    assert rows[0].decided_at == approved_at
    assert rows[1].superseded_at is None
    assert rows[1].decided_at is None
    first.refresh_from_db()
    assert first.document_version == 2
    # 🔴 И ОБЪЕКТ СНОВА НА «СОГЛАСОВАНИИ», А НЕ В ТУПИКЕ (Plane №534 + №568;
    #    найдено ревью, задача №825). Отправка принимает объект и с
    #    «Ознакомления», но этап его не меняла — а после того как №568 закрыла
    #    решение согласующего гвардом «только на этапе „Согласование“»,
    #    повторно отправленный объект становился ТУПИКОМ: версия `SUBMITTED`,
    #    маршрут `PENDING`, и все четыре ручки (решить, вернуть, отозвать,
    #    завершить расстановку) отвечали 422 по этапу. Выйти можно было только
    #    админским `override_stage`.
    assert first.stage == "APPROVAL", (
        f"объект ждёт решения, но стоит на этапе {first.stage}: решать его некому"
    )
    # И решение действительно принимается — то есть цикл `[СОГ-04]` замкнут.
    again = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert again.status_code == 200, (
        f"повторно отправленную версию некому согласовать: {again.content}"
    )
    rows = list(first.document_versions.order_by("number"))
    assert [(r.number, r.status) for r in rows] == [(1, "APPROVED"), (2, "APPROVED")]


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
    # Отзыв возвращает объект на «Расстановку» (Plane №536, доведена ревью
    # №825): чтобы отправить снова, расстановку надо завершить — тем же
    # шагом, что и после возврата согласующим. Пин пробы от этого не
    # меняется: её предмет — номер версии, а не путь.
    manager.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    manager.post(
        f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json"
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

    # Подпись единственного согласующего завершает согласование ОБЪЕКТА сама
    # (`[СОГ-09]`, Plane №399); мероприятие ждёт второго объекта.
    _, approver_id = _approve(manager, base, first)
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    first.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT"
    event = service.lock_event(event_id)
    assert event.stage == "APPROVAL", "мероприятие ушло вперёд по одному объекту"

    _, approver_id = _approve(manager, base, second)
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(second.pk)},
        format="json",
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


# ── Гварды этапа спрашивают стадию ОБЪЕКТА, а не мероприятия ────────────────


def test_returning_one_object_does_not_lock_approval_of_its_neighbour(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ВОЗВРАТ ОДНОГО ОБЪЕКТА ЗАПИРАЛ СОГЛАСОВАНИЕ СОСЕДНЕГО (Plane №475).

    Стадия МЕРОПРИЯТИЯ — наименьшая среди объектов, и это задумано: карточка
    показывает, докуда дошло самое отстающее место. Но операции НАД ОБЪЕКТОМ
    охранялись стадией мероприятия, а не своей. Возврат объекта А на доработку
    ронял стадию ОМ на «Расстановку» — и у объекта Б переставали работать ВСЕ
    действия согласования разом: 422 на отправке, отзыве, согласовании,
    возврате. Карточка при этом рисовала Б согласуемым (цепочка этапов берёт
    стадию ВЫБРАННОГО объекта), то есть на экране жили кнопки, каждая из
    которых отвечала ошибкой.

    Выхода из этого через интерфейс не было: последняя подпись по Б тоже не
    закрыла бы этап — автозавершение выходило по тому же условию, а ручной
    кнопки «Завершить этап» у согласующего больше нет (`[СОГ-11]`, №446).
    Оставался только админский обход этапа.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    _add_approver(manager, base, second, name="Согласующий второго")

    # Возврат второго объекта — штатный ход, а не редкость.
    back = approver.post(
        f"{base}approval/return/",
        {"comment": "переделать расстановку", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content

    second.refresh_from_db()
    event = service.lock_event(event_id)
    assert second.stage == "PLACEMENT", "возврат не вернул объект на расстановку"
    assert event.stage == "PLACEMENT", (
        "стадия мероприятия не упала до минимума — проба потеряла свой смысл"
    )

    # 🔴 И ВОТ ЗДЕСЬ ЛОМАЛОСЬ. Первый объект как стоял на «Согласовании», так и
    # стоит; ни одно действие над ним от судьбы соседа зависеть не должно.
    first.refresh_from_db()
    assert first.stage == "APPROVAL"
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content

    withdrawn = manager.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert withdrawn.status_code == 200, withdrawn.content
    # Отзыв возвращает объект на «Расстановку» (Plane №536, доведена ревью
    # №825): чтобы отправить снова, расстановку надо завершить — тем же
    # шагом, что и после возврата согласующим. Пин пробы от этого не
    # меняется: её предмет — независимость объекта от судьбы соседа, а не путь.
    assert (
        manager.post(
            f"{base}placement/complete/", {"visitObjectId": str(first.pk)},
            format="json",
        ).status_code
        == 200
    )
    resent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resent.status_code == 200, resent.content

    # Подпись закрывает этап объекта САМА (`[СОГ-09]`) — и это второй конец
    # ямы: автозавершение тоже спрашивало стадию мероприятия.
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert decided.status_code == 200, decided.content
    first.refresh_from_db()
    assert first.approval_status == "APPROVED", (
        "последняя подпись не закрыла этап объекта — из интерфейса не выбраться"
    )
    assert first.stage == "ACKNOWLEDGEMENT"


def test_returning_one_object_does_not_lock_manual_approval_of_its_neighbour(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Та же яма у ручного завершения (`approval/approve/`) и у возврата.

    Ручка админская, но она и есть последнее средство, когда всё встало, —
    отказывать ей по стадии СОСЕДА особенно некстати.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    _add_approver(manager, base, second, name="Согласующий второго")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")

    back = approver.post(
        f"{base}approval/return/",
        {"comment": "переделать расстановку", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content
    event = service.lock_event(event_id)
    assert event.stage == "PLACEMENT"

    returned = approver.post(
        f"{base}approval/return/",
        {"comment": "и первый тоже", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert returned.status_code == 200, returned.content
    first.refresh_from_db()
    assert first.stage == "PLACEMENT"


def test_an_object_that_has_not_reached_approval_is_still_refused(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Гвард ослаблен ровно на объект, а не снят (Plane №475).

    Проба заведена потому, что мутация «пусть гвард ничего не проверяет»
    оставалась ЗЕЛЁНОЙ: направление «не пускать того, кто до этапа не дошёл»
    не стерёг никто, и правку гварда нечем было отличить от его удаления.
    """
    base, _, _, second, _ = two_objects_on_approval
    _add_approver(manager, base, second, name="Согласующий второго")
    back = approver.post(
        f"{base}approval/return/",
        {"comment": "переделать", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content
    second.refresh_from_db()
    assert second.stage == "PLACEMENT"

    # Клиент у каждой ручки СВОЙ: «согласовать» и «вернуть» закрыты правом
    # согласующего, и от менеджера они дали бы 403 — отказ по правам, а не по
    # этапу, то есть проба стерегла бы не то.
    cases = (
        (manager, "approval/send/", {}),
        (manager, "approval/withdraw/", {}),
        (approver, "approval/approve/", {}),
        (approver, "approval/return/", {"comment": "нельзя"}),
    )
    for client, path, extra in cases:
        refused = client.post(
            f"{base}{path}",
            {"visitObjectId": str(second.pk), **extra},
            format="json",
        )
        assert refused.status_code == 422, (path, refused.content)
        body = refused.json()
        assert body["error_code"] == "INVALID_STAGE_TRANSITION", (path, body)
        # Отказ называет ОБЪЕКТ: на карточке с двумя объектами «можно только
        # на этапе …» без адреса не говорит, о котором из них речь.
        assert body["details"]["visitObjectId"] == str(second.pk), (path, body)
        assert body["details"]["stage"] == "PLACEMENT", (path, body)


def test_unattributed_posts_are_named_instead_of_calling_placement_empty(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 ОТКАЗ НАЗЫВАЕТ НАСТОЯЩУЮ БЕДУ (Plane №477).

    У ОМ с несколькими объектами, посты которых не размечены `visitObjectId`,
    подпись расстановки пуста при ПОЛНОСТЬЮ УКОМПЛЕКТОВАННОЙ расстановке:
    неразмеченная строка не принадлежит никому. Сервер отвечал «Расстановка
    пуста — согласовывать нечего» и уводил разбор в расстановку, где всё на
    месте. При этом на «Согласование» такое ОМ провёл он же сам.

    Состояние не выдумано: неразмеченные посты остаются после миграции 0069 —
    единственному объекту она посты приписала, а у нескольких приписывать было
    не к чему. Здесь оно воспроизводится тем же способом: разметка снимается.
    """
    base, event_id, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)

    event = service.lock_event(event_id)
    posts = [dict(p) for p in event.recon_sector_posts]
    assert any(p.get("visitObjectId") for p in posts), "разметки не было — проба вакуумна"
    for post in posts:
        post["visitObjectId"] = ""
    event.recon_sector_posts = posts
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    # Расстановка при этом УКОМПЛЕКТОВАНА — люди на постах остались.
    assert event.placement_assignments, "назначений нет — проба стерегла бы не то"

    refused = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert refused.status_code == 422, refused.content
    body = refused.json()
    assert body["error_code"] == "RECON_POSTS_UNASSIGNED", body
    assert body["details"]["unattributedPosts"] == len(posts)
    # Сообщение обязано вести туда, где чинят: на рекогносцировку, а не в
    # расстановку.
    assert "рекогносцировк" in body["message"], body["message"]


def test_placement_empty_still_means_placement_empty(
    manager, two_objects_on_approval  # noqa: F811
):
    """Обратная сторона №477: разметка на месте, людей нет — прежний отказ.

    Без этой пробы правку нельзя отличить от «всегда отвечать новым кодом»:
    мутация, отдающая `RECON_POSTS_UNASSIGNED` безусловно, осталась бы зелёной.
    """
    base, event_id, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)

    # Назначения снимаются ПРЯМО В МОДЕЛИ, а не ручкой: снятие последнего
    # человека с укомплектованного поста ручка отбивает своей проверкой, и
    # проба не дошла бы до своего вопроса. Разметка постов при этом НЕ
    # трогается — в ней и разница с соседней пробой.
    #
    # 🔴 ЗДЕСЬ СТОЯЛО «на „Согласовании“ расстановка заморожена, и ручка
    # ответила бы 422», и это перестало быть правдой в тот же день (Plane
    # №533): фикстура расстановку ЗАВЕРШАЕТ, но не ОТПРАВЛЯЕТ, документ
    # остаётся черновиком, и заморозки на нём нет. Обоснование обхода было
    # неверным, сам обход — нет.
    event = service.lock_event(event_id)
    assert all(p.get("visitObjectId") for p in event.recon_sector_posts)
    event.placement_assignments = []
    event.save(update_fields=["placement_assignments", "updated_at"])

    refused = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "PLACEMENT_EMPTY", refused.json()


# ── Подпись живёт ровно столько, сколько статус (Plane №583/№513) ───────────


def test_returning_clears_the_signature_of_the_one_who_signed(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Возврат снимает реквизиты подписи, а не только статус (Plane №583).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `_return_visit` объявляет в комментарии «все подписи
    сняты» и сбрасывает `status`/`decidedAt`, но `item["signature"]` не трогал
    НИКТО: ни возврат, ни повторная отправка, ни что-либо ещё (грепом по
    разделу — только места записи). Экран рисует реквизиты по
    `signature != null`, без оглядки на статус, — и строка, которая ЖДЁТ
    решения, показывала «Согласовано» с ФИО, должностью, временем и номером
    СТАРОЙ версии документа.

    Подпись — факт под КОНКРЕТНЫМ составом: под следующим она врёт по
    определению. История подписей при этом не теряется — она в журнале
    (`SECURITY_EVENT_APPROVAL_SIGNED`) и в версиях документа.

    Мутация, на которой проба обязана краснеть: убрать `item.pop("signature")`
    из `_return_visit`.
    """
    base, _, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Первый С.")
    _add_approver(manager, base, first, name="Второй В.")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    signer_id = first.approval_route[0]["id"]
    returner_id = first.approval_route[1]["id"]

    signed = approver.post(
        f"{base}approval/route/{signer_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert signed.status_code == 200, signed.content
    first.refresh_from_db()
    assert first.approval_route[0].get("signature"), "предусловие: подпись записана"

    returned = approver.post(
        f"{base}approval/route/{returner_id}/decide/",
        {"decision": "RETURNED", "comment": "Поправьте пост 2",
         "visitObjectId": str(first.pk)},
        format="json",
    )
    assert returned.status_code == 200, returned.content

    first.refresh_from_db()
    signer = first.approval_route[0]
    assert signer["status"] == "NOT_SENT", "статус подписавшего не сброшен"
    assert signer.get("signature") is None, (
        "реквизиты подписи пережили возврат — строка ждёт решения и "
        "показывает «Согласовано»"
    )


def test_resending_clears_signatures_from_the_previous_round(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Повторная отправка не тащит подписи прошлого круга (Plane №513).

    Второй путь того же дефекта: возврат бывает без повторной отправки, а
    повторная отправка — без возврата (после отзыва). Чистка нужна на обоих.

    Мутация, на которой проба обязана краснеть: убрать `item.pop("signature")`
    из `send_for_approval`.
    """
    base, _, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Единственный Е.")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    first.refresh_from_db()
    assert first.approval_route[0].get("signature"), "предусловие: подпись записана"

    resent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resent.status_code == 200, resent.content

    first.refresh_from_db()
    row = first.approval_route[0]
    assert row["status"] == "PENDING"
    assert row.get("signature") is None, (
        "подпись прошлого круга осталась у строки, которая снова ждёт решения"
    )


def test_resending_takes_the_object_out_of_returned(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Повторная отправка снимает с объекта «Возвращено» (Plane №584).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `approval_status` присваивался в трёх местах —
    `PENDING` при заведении, `APPROVED` и `RETURNED` при решении, — а
    повторная отправка его не трогала. Объект честно уходил на согласование
    заново, но поле оставалось `RETURNED`, и бейдж реестра «Возвращено · N
    замечаний» горел до следующего решения согласующего: читатель видел
    «вернули, чините» там, где чинить уже нечего.

    Мутация, на которой проба обязана краснеть: убрать
    `visit.approval_status = "PENDING"` из `send_for_approval`.
    """
    base, event_id, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "RETURNED", "comment": "Поправьте", "visitObjectId": str(first.pk)},
        format="json",
    )
    first.refresh_from_db()
    assert first.approval_status == "RETURNED", "предусловие: объект возвращён"

    # Возврат уводит объект обратно на «Расстановку» — путь заказчика такой:
    # поправить, завершить расстановку, отправить заново.
    done = manager.post(
        f"{base}placement/complete/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert done.status_code == 200, done.content
    resent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resent.status_code == 200, resent.content

    first.refresh_from_db()
    assert first.approval_status == "PENDING", (
        "объект отправлен заново, а в реестре по-прежнему «Возвращено»"
    )
    # Сводное поле мероприятия идёт следом: пока второй объект не возвращён,
    # у мероприятия тоже нечему гореть.
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    assert OpsSecurityEvent.objects.get(pk=event_id).approval_status == "PENDING"


# ── Замечания старой формы (Plane №502) ─────────────────────────────────────


def test_a_remark_without_status_still_holds_the_stage(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Замечание, записанное ДО №386, держит этап (Plane №502).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Тот коммит заменил булево `resolved` на тройственный
    `status`, но миграции с бэкфиллом не завёл: строки старой формы лежат как
    `{"text": …, "resolved": false}` и переехали дословно. Читатели сравнивают
    `status == "OPEN"`, а у них ключа нет вовсе — `None == "OPEN"` ложно, и
    неотвеченное замечание переставало держать этап: согласование
    завершалось мимо него.

    Мутация, на которой проба обязана краснеть: вернуть в `remark_is_open`
    сравнение `item.get("status") == "OPEN"`.
    """
    base, _, first, _, _ = two_objects_on_approval
    _add_approver(manager, base, first)
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()

    # Строка СТАРОЙ формы — ровно та, что лежит в базах до №386.
    first.approval_remarks = [
        {"text": "Замечание старой формы", "resolved": False, "resolvedAt": None}
    ]
    first.save(update_fields=["approval_remarks"])
    first.refresh_from_db()

    approver_id = first.approval_route[0]["id"]
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )

    # Подпись проходит, а вот ЗАВЕРШИТЬ этап с открытым замечанием нельзя.
    assert decided.status_code == 200, decided.content
    first.refresh_from_db()
    assert first.stage == "APPROVAL", (
        "этап завершился мимо неотвеченного замечания старой формы"
    )


def test_the_backfill_gives_old_remarks_the_new_shape():
    """Миграция 0095 дописывает старой строке ключи контракта (Plane №502).

    Проверяется САМА функция бэкфилла, а не факт применения миграции: в
    тестовой базе миграции уже прогнаны, и «данные починены» там истинно по
    построению. Предмет — правило переноса, и его надо уметь прочитать.
    """
    # Имя модуля начинается с цифры — обычным `import` его не взять.
    from importlib import import_module

    backfill = import_module(
        "organization_management.apps.operations.migrations"
        ".0095_backfill_approval_remark_status"
    )

    old_open = {"text": "Не устранено", "resolved": False, "resolvedAt": None}
    old_done = {"text": "Устранено", "resolved": True, "resolvedAt": "2026-01-01T00:00:00"}
    new_row = {"id": "r1", "status": "OPEN", "text": "Новая форма"}

    filled_open = backfill._fill(old_open)
    assert filled_open["status"] == "OPEN"
    # Ничего не выдумано: автора и версию у старой строки взять неоткуда.
    assert filled_open["author"] == "" and filled_open["documentVersion"] is None
    assert filled_open["urgent"] is False and filled_open["response"] == ""
    # Прежний ключ остаётся на месте — откат опирается на него.
    assert filled_open["resolved"] is False

    assert backfill._fill(old_done)["status"] == "RESOLVED"
    assert backfill._fill(old_done)["respondedAt"] == "2026-01-01T00:00:00"
    # Строку новой формы бэкфилл не трогает вовсе.
    assert backfill._fill(new_row) is None


def test_the_event_carries_the_latest_return_reason_not_the_lowest_object(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 «ПОСЛЕДНИЙ ВОЗВРАЩЁННЫЙ» — ПО ВРЕМЕНИ, А НЕ ПО ПОРЯДКУ (Plane №491).

    Поле мероприятия несло причину того из возвращённых объектов, кто стоит
    НИЖЕ в списке, — то есть «последний» означало «нижний», вопреки собственной
    докстроке. Человек мог читать причину, которая СТАРШЕ той, что он только
    что получил.

    Здесь возвращается сначала ВТОРОЙ объект, потом ПЕРВЫЙ: порядок объектов и
    порядок возвратов расходятся, и проба различает их. Красная на мутации
    «вернуть `returned[-1]`».
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    _add_approver(manager, base, second, name="Согласующий второго")

    older = approver.post(
        f"{base}approval/return/",
        {"comment": "СТАРАЯ причина второго", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert older.status_code == 200, older.content
    newer = approver.post(
        f"{base}approval/return/",
        {"comment": "СВЕЖАЯ причина первого", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert newer.status_code == 200, newer.content

    event = service.lock_event(event_id)
    assert event.approval_status == "RETURNED"
    assert event.approval_comment == "СВЕЖАЯ причина первого", (
        "мероприятие несёт причину нижнего объекта, а не последнего по времени"
    )


def test_completing_placement_twice_does_not_drag_an_approved_object_back(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ПОВТОР «ЗАВЕРШИТЬ РАССТАНОВКУ» ОТКАТЫВАЛ СОГЛАСОВАННЫЙ ОБЪЕКТ (№508).

    Завершение расстановки МЕНЯЕТ этап объекта, а сторожило только этап ОМ — а
    он держится минимумом по объектам. У ОМ, где объект А уже согласован и ушёл
    на «Ознакомление», а объект Б ещё расставляется, `event.stage` остаётся
    «Расстановкой», и повтор по объекту А проходил гвард: его этап писался
    безусловно. Согласованный объект откатывался назад, а его статус
    согласования оставался «Согласовано» — состояние, из которого система себя
    не выведет.

    Достижимо не только по API: выборщик объекта на экране перечисляет ВСЕ
    объекты независимо от их этапа.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert decided.status_code == 200, decided.content
    first.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT", "фикстура не довела объект до согласования"

    # Второй объект возвращаем на расстановку — он и держит этап мероприятия
    # внизу, ради чего проба и заведена.
    _add_approver(manager, base, second, name="Согласующий второго")
    back = approver.post(
        f"{base}approval/return/",
        {"comment": "переделать", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content
    event = service.lock_event(event_id)
    assert event.stage == "PLACEMENT", "минимум по объектам — иначе проба не о том"

    repeated = manager.post(
        f"{base}placement/complete/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )

    assert repeated.status_code == 422, repeated.content
    body = repeated.json()
    assert body["error_code"] == "INVALID_STAGE_TRANSITION", body
    assert body["details"]["visitObjectId"] == str(first.pk), body
    first.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT", "согласованный объект откатили назад"
    assert first.approval_status == "APPROVED"


def test_removing_a_post_does_not_lock_approval_with_an_invisible_remark(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ЗАМЕЧАНИЕ К СНЯТОМУ ПОСТУ ЗАПИРАЛО СОГЛАСОВАНИЕ НАВСЕГДА (Plane №510).

    Согласующий вернул расстановку с замечанием к посту, старший объекта снял
    этот пост с расчёта — и замечание осталось «Открыто» со ссылкой на пост,
    которого больше нет. Метка «!N» пропадала вместе с постом, на экране
    замечание не показывалось, а `_approval_ready` держал согласование ровно по
    нему: этап не завершался НИКОГДА, и причина была невидима.

    Замечание теперь становится ОБЩИМ по объекту (штатная форма `[МД-07]`), а
    имя снятого поста сохраняется в `detachedPost` — слова согласующего не
    переписываются, но и контекст не теряется. Закрывать чужое замечание за
    согласующего система не имеет права: это его суждение, и её дело —
    оставить его видимым и отвечаемым.
    """
    base, event_id, first, _second, assigned = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]

    # Возврат с замечанием К ПОСТУ первого объекта. Пост освобождается ПОСЛЕ
    # возврата: на «Согласовании» расстановка заморожена, а возврат как раз
    # возвращает объект на «Расстановку» — это и есть боевая
    # последовательность из карточки.
    event = service.lock_event(event_id)
    own_posts = service.visit_object_posts(event, first)
    assert own_posts, "у объекта нет постов — проба стерегла бы не то"
    victim = own_posts[0]
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "переделать",
            "visitObjectId": str(first.pk),
            "remarks": [
                {"text": "Пост лишний", "postId": str(victim["id"]), "urgent": False}
            ],
        },
        format="json",
    )
    assert decided.status_code == 200, decided.content
    first.refresh_from_db()
    assert any(
        r.get("postId") == str(victim["id"]) for r in (first.approval_remarks or [])
    ), "замечание к посту не завелось — проба стерегла бы не то"

    # Освобождаем пост: занятый снять нельзя — сервер отбивает по правилу
    # заказчика «пост с людьми не удаляют».
    fresh = manager.get(base).json()
    for row in fresh["placementAssignments"]:
        if str(row["postId"]) == str(victim["id"]):
            dropped = manager.delete(f"{base}placement/{row['id']}/")
            assert dropped.status_code == 200, dropped.content

    removed = manager.delete(f"{base}placement/posts/{victim['id']}/")
    assert removed.status_code == 200, removed.content

    first.refresh_from_db()
    detached = [
        r for r in (first.approval_remarks or []) if r.get("text") == "Пост лишний"
    ]
    assert detached, "замечание исчезло вместе с постом"
    assert detached[0]["postId"] is None, (
        "замечание всё ещё ссылается на пост, которого нет"
    )
    assert detached[0]["detachedPost"] != "", (
        "имя снятого поста потеряно — согласующий не узнает, о чём писал"
    )
    assert str(victim["post"]) in detached[0]["detachedPost"]
    # Статус НЕ трогаем: закрыть замечание может только согласующий.
    assert detached[0]["status"] == "OPEN"


def test_adding_a_second_object_does_not_lock_the_first_one_forever(
    manager,  # noqa: F811
):
    """🔴 ДОБАВЛЕНИЕ ВТОРОГО ОБЪЕКТА ЗАПИРАЛО ОМ НАВСЕГДА (Plane №490).

    Пока объект ОДИН, неразмеченный пост принадлежит ему — это правило
    `visit_object_posts`, а не допущение. Как только объектов становится двое,
    то же правило отвечает «никому», и смысл существующих данных меняется В
    МОМЕНТ ДОБАВЛЕНИЯ, без единой правки расчёта.

    Сценарий из карточки: ОМ с одним объектом и неразмеченными постами
    отправлен на согласование — снимок записан по ВСЕМ постам. Добавляют
    второй объект, и подпись расстановки первого становится ПУСТОЙ:
    `approval_is_stale` навсегда истинна (`_approve_visit` отбивает
    `APPROVAL_STALE`), а повторная отправка отбивается `PLACEMENT_EMPTY`.
    Объект нельзя ни согласовать, ни переотправить, а мероприятие ждёт
    согласования ВСЕХ объектов — то есть не уйдёт с этапа никогда.

    Разметка теперь проставляется явно ПЕРЕД добавлением второго объекта — тем
    объектом, которому посты и так принадлежали.
    """
    first_object = make_object(code="OBJ-LOCK-1", with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба запирания вторым объектом",
            "objectId": str(first_object.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    give_chief(manager, event_id)
    imported = manager.post(f"{base}recon/import-from-passport/")
    assert imported.status_code == 200, imported.content

    # Расчёт БЕЗ разметки по объектам — ровно то, что оставляет после себя
    # переезд данных и что прямо разрешает правка рекогносцировки.
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        {**p, "visitObjectId": ""} for p in event.recon_sector_posts
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    only = list(event.visit_objects.all())[0]
    signature_before = service.placement_signature(event, only)

    second_object = make_object(code="OBJ-LOCK-2", with_passport=True)
    added = manager.post(
        f"{base}visit-objects/", {"objectId": str(second_object.pk)}, format="json"
    )
    assert added.status_code in (200, 201), added.content

    event = service.lock_event(event_id)
    only.refresh_from_db()
    assert service.placement_signature(event, only) == signature_before, (
        "подпись расстановки первого объекта изменилась от появления соседа — "
        "его согласование объявлено устаревшим, а расстановку никто не трогал"
    )
    assert service.visit_object_posts(event, only), (
        "первый объект остался без постов: документ печатался бы пустым"
    )
    assert all(
        str(p.get("visitObjectId") or "") != "" for p in event.recon_sector_posts
    ), "остались неразмеченные посты — они снова ничьи"


def test_a_remark_cannot_be_pinned_to_a_post_of_another_object(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ЗАМЕЧАНИЕ К ЧУЖОМУ ПОСТУ ПРИНИМАЛОСЬ БЕЗ ПРОВЕРКИ (Plane №506).

    `postId` приходил прямо из тела запроса и превращался в строку чем угодно:
    принадлежность посту объекта не проверял никто. Замечание к посту ЧУЖОГО
    объекта уезжало в список первого, и дальше его показывали как «пост <сырой
    id>» — и на экране, и в деле, которое подписывают.

    Проверка обязана стоять на СЕРВЕРЕ: окно с выбором постов — удобство, а
    второй источник правды о принадлежности поста завёл бы расхождение ровно
    там, где его труднее всего заметить.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]

    event = service.lock_event(event_id)
    theirs = service.visit_object_posts(event, second)
    assert theirs, "у соседнего объекта нет постов — проба вакуумна"

    refused = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "переделать",
            "visitObjectId": str(first.pk),
            "remarks": [
                {"text": "Чужой пост", "postId": str(theirs[0]["id"]), "urgent": False}
            ],
        },
        format="json",
    )

    assert refused.status_code == 400, refused.content
    body = refused.json()
    assert body["error_code"] == "VALIDATION_ERROR", body
    # 🔴 АДРЕС ОШИБКИ — СО СТРОКОЙ, А ID В ТЕКСТ НЕ ПОПАДАЕТ (найдено ревью
    # №825). Поле называлось `remarks` — именем КОЛЛЕКЦИИ, — и окно возврата
    # не могло подсветить строку, а в текст уезжал сырой `post-…`, ровно тот,
    # из-за которого карточка №506 и заведена.
    assert "remarks.0" in body["details"], body
    assert str(theirs[0]["id"]) not in str(body), (
        "сырой id поста уехал человеку на экран"
    )
    first.refresh_from_db()
    assert not (first.approval_remarks or []), "замечание к чужому посту всё же завелось"
    # Возврат НЕ состоялся: отказ по нагрузке не должен наполовину применить
    # решение согласующего.
    assert first.approval_status != "RETURNED"


def test_a_general_remark_and_an_own_post_are_still_accepted(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Обратная сторона №506: проверка не должна запретить законное.

    Без этой пробы мутация «отбивать любую привязку» осталась бы зелёной.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    event = service.lock_event(event_id)
    mine = service.visit_object_posts(event, first)
    assert mine

    accepted = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "переделать",
            "visitObjectId": str(first.pk),
            "remarks": [
                {"text": "Свой пост", "postId": str(mine[0]["id"]), "urgent": False},
                {"text": "Общее замечание", "postId": None, "urgent": False},
            ],
        },
        format="json",
    )

    assert accepted.status_code == 200, accepted.content
    first.refresh_from_db()
    pinned = {r["text"]: r["postId"] for r in first.approval_remarks}
    assert pinned["Свой пост"] == str(mine[0]["id"])
    assert pinned["Общее замечание"] is None


def test_a_repeated_return_after_the_stage_closed_is_refused(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ПОВТОРНЫЙ ВОЗВРАТ ОТКАТЫВАЛ ОМ С «ОЗНАКОМЛЕНИЯ» (Plane №568).

    У решения согласующего не было гварда этапа вовсе, и это АСИММЕТРИЯ:
    соседи (`return_placement`, `approve_placement`, `withdraw_from_approval`)
    этап спрашивают. Ветка «Согласовано» защищена случайно — автозавершение
    выходит само; ветка «Вернуть» не защищена ничем.

    Повтор — не редкость: двойной клик, ретрай сети, вторая вкладка. И он
    откатывал объект с «Ознакомления» назад на «Расстановку», а с ним и
    мероприятие: его стадия наименьшая. Люди уже получили уведомления о
    заступлении, документ согласован — а карточка снова просит расставлять.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    first.refresh_from_db()
    approver_id = first.approval_route[0]["id"]
    approved = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert approved.status_code == 200, approved.content
    first.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT", "фикстура не закрыла этап — проба вакуумна"

    late = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "передумал",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )

    assert late.status_code == 422, late.content
    assert late.json()["error_code"] == "INVALID_STAGE_TRANSITION", late.json()
    first.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT", "объект укатился назад с «Ознакомления»"
    assert first.approval_status == "APPROVED"


def test_withdrawing_unfreezes_the_placement_and_the_document(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 «ОТОЗВАТЬ С СОГЛАСОВАНИЯ» БЫЛ ФУНКЦИОНАЛЬНО МЁРТВ (Plane №536).

    Отзыв сбрасывал ТОЛЬКО статусы маршрута: документ оставался «На
    согласовании», расстановка — замороженной. Править нельзя, а вернуть
    документ некому: весь маршрут уже в «Не отправлено». Отозвавший упирался в
    стену, которую сам же и поставил. `test_ops_withdraw_rule` этого не видел,
    потому что стерёг одни статусы маршрута.

    Отзыв означает «не отправляли»: документ снова черновик, отметка отправки
    снята, снимок состава стёрт — сравнивать «устарела ли расстановка» после
    отзыва не с чем. Номер версии при этом НЕ откатывается: отзыв возможен
    только пока никто не подписал, и закреплять там нечего.

    🔴 И ОБЪЕКТ ВОЗВРАЩАЕТСЯ НА «РАССТАНОВКУ» (найдено ревью №825). Иначе
    разморозка была правдой для API и неправдой для человека: карточка ОМ
    рисует панель по этапу объекта, а на «Согласовании» операций расстановки
    нет вовсе, и без права `event.stage_override` уйти на нужный шаг нельзя.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    first.refresh_from_db()
    version_before = first.document_version
    assert service.placement_frozen(first), "после отправки заморозка обязана быть"

    withdrawn = manager.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert withdrawn.status_code == 200, withdrawn.content

    first.refresh_from_db()
    assert service.document_status_of(first) == "DRAFT", (
        "документ остался «на согласовании» — расстановка не разморозится"
    )
    assert not service.placement_frozen(first), (
        "после отзыва править по-прежнему нельзя, а возвращать документ некому"
    )
    assert first.approval_snapshot == "", "снимок отправки пережил отзыв"
    assert first.document_version == version_before, "номер версии откатили"
    assert first.stage == "PLACEMENT", (
        "объект остался на «Согласовании» — панели расстановки там нет, и "
        "человек без права обхода этапов до правки не дойдёт"
    )

    # И правка действительно проходит — то, ради чего отзыв и нажимают.
    event = service.lock_event(event_id)
    mine = service.visit_object_posts(event, first)
    moved = manager.post(
        f"{base}placement/assign/",
        {
            "postId": str(mine[0]["id"]),
            "employeeId": str(make_employee(last_name="Отзывов").pk),
            "override": True,
            "override_reason": "усиление после отзыва",
        },
        format="json",
    )
    assert moved.status_code == 200, moved.content


def test_recon_edit_cannot_strip_a_post_of_a_frozen_object(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 ПРАВКА РЕКОГНОСЦИРОВКИ ОБХОДИЛА ЗАМОРОЗКУ (Plane №535).

    `update_recon` переписывает расчёт постов ЦЕЛИКОМ, минуя проверку, которой
    закрыты точечные операции расстановки. Через неё пост отправленного (и
    даже согласованного) объекта удалялся ответом 200: пост исчезал,
    назначение на него оставалось сиротой, документ по-прежнему числился
    отправленным, новой версии не появлялось. Согласованный документ расходился
    с фактом, и расхождение нигде не отмечалось.

    Проверяется и обратное — что заморозка одного объекта НЕ запирает правку
    чужих постов: иначе вернулась бы болезнь №634, где один объект делал
    несохраняемой рекогносцировку всего мероприятия.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    first.refresh_from_db()
    assert service.placement_frozen(first), "фикстура не заморозила объект"

    card = manager.get(base).json()
    posts = card["reconSectorPosts"]
    victim = next(p for p in posts if p["visitObjectId"] == str(first.pk))

    refused = manager.patch(
        f"{base}recon/",
        {
            "checklist": card["reconChecklist"],
            "sectorPosts": [p for p in posts if p["id"] != victim["id"]],
        },
        format="json",
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "PLACEMENT_FROZEN", refused.json()
    event = service.lock_event(event_id)
    assert any(
        str(p.get("id")) == str(victim["id"]) for p in event.recon_sector_posts
    ), "пост замороженного объекта всё же снят"

    # А правка постов СОСЕДНЕГО объекта (он не заморожен) проходит — иначе
    # один замороженный объект запирал бы рекогносцировку всего мероприятия.
    theirs = next(p for p in posts if p["visitObjectId"] == str(second.pk))
    allowed = manager.patch(
        f"{base}recon/",
        {
            "checklist": card["reconChecklist"],
            "sectorPosts": [
                {**p, "task": "уточнено"} if p["id"] == theirs["id"] else p
                for p in posts
            ],
        },
        format="json",
    )
    assert allowed.status_code == 200, allowed.content


@pytest.fixture
def one_object_with_unmarked_posts(manager):  # noqa: F811
    """ОМ с ЕДИНСТВЕННЫМ объектом, чьи посты НЕ размечены `visitObjectId`.

    🔴 ЭТО ОБЫЧНОЕ СОСТОЯНИЕ, А НЕ КРАЕВОЕ (Plane №535, найдено ревью №825).
    Пост, заведённый на рекогносцировке, разметки не несёт, а
    `_pin_unmarked_posts_to_the_only_visit` закрепляет неразмеченные строки
    только ПЕРЕД добавлением ВТОРОГО объекта. Значит у ОМ с одним объектом
    неразмеченный расчёт живёт сколько угодно долго — и именно так устроены
    фикстуры стенда (`seed_smoke_fixtures`).

    Фикстура `two_objects_on_approval` до этой ветки НЕ ДОХОДИТ: она заводит
    посты импортом из паспорта, а импорт всегда пишет `visitObjectId`.
    """
    obj = make_object(code="OBJ-ONE-UNMARKED", name="Единственный объект")
    created = manager.post(
        URL,
        {
            "title": "ОМ с одним объектом и неразмеченным расчётом",
            "objectId": str(obj.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    give_chief(manager, event_id)
    (visit,) = _visits(event_id)

    card = manager.get(base).json()
    saved = manager.patch(
        f"{base}recon/",
        {
            "checklist": [
                {**i, "state": "NORMAL"} for i in card["reconChecklist"]
            ],
            # Ни у одной строки нет `visitObjectId` — так их заводит экран.
            "sectorPosts": [
                {
                    "id": "unmarked-1",
                    "sector": "Сектор А",
                    "post": "Пост 1",
                    "task": "Наблюдение",
                    "need": 1,
                    "requirements": "",
                    "comment": "",
                    "minRating": None,
                }
            ],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    post = manager.get(base).json()["reconSectorPosts"][0]
    assert post["visitObjectId"] is None, "фикстура разметила пост — проба вакуумна"

    assert manager.post(f"{base}recon/complete/").status_code == 200
    employee = make_employee(last_name="Единственный")
    assigned = manager.post(
        f"{base}placement/assign/",
        {"postId": post["id"], "employeeId": str(employee.pk)},
        format="json",
    )
    assert assigned.status_code == 200, assigned.content
    done = manager.post(
        f"{base}placement/complete/",
        {"visitObjectId": str(visit.pk)},
        format="json",
    )
    assert done.status_code == 200, done.content
    return base, event_id, visit, post


def test_recon_edit_cannot_strip_an_unmarked_post_of_the_only_object(
    manager, one_object_with_unmarked_posts  # noqa: F811
):
    """🔴 ЗАМОРОЗКА НЕ ВИДЕЛА НЕРАЗМЕЧЕННЫХ ПОСТОВ (Plane №535, ревью №825).

    Гард ключился на `_posts_by_visit`, который строки без `visitObjectId`
    выбрасывает («они ничьи»). Но у ОМ с ЕДИНСТВЕННЫМ объектом неразмеченный
    пост — ЕГО пост: так считает `visit_object_posts`, так считает
    `_visit_of_post`, и по `visit_object_posts` собирается подписываемый
    снимок. Получалось расхождение внутри одного согласованного документа:
    `placement/assign/` по этому посту отвечал `PLACEMENT_FROZEN`, а
    `PATCH /recon/`, снимающий тот же пост, отвечал 200 — то есть репро
    карточки №535 воспроизводилось дальше.
    """
    base, event_id, visit, post = one_object_with_unmarked_posts
    _add_approver(manager, base, visit, name="Согласующий единственного")
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    visit.refresh_from_db()
    assert service.placement_frozen(visit), "фикстура не заморозила объект"

    card = manager.get(base).json()
    refused = manager.patch(
        f"{base}recon/",
        {"checklist": card["reconChecklist"], "sectorPosts": []},
        format="json",
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "PLACEMENT_FROZEN", refused.json()
    event = service.lock_event(event_id)
    assert event.recon_sector_posts, "неразмеченный пост замороженного объекта снят"


def test_recon_edit_cannot_change_a_field_outside_the_old_fingerprint(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 ОТПЕРАТОК ИЗ ВОСЬМИ ПОЛЕЙ БЫЛ ДЫРОЙ (Plane №535, ревью №825).

    `_POST_FINGERPRINT_FIELDS` перечисляет восемь полей, а строка поста несёт
    семнадцать, и `_document_snapshot` кладёт строки ЦЕЛИКОМ. Значит у
    согласованного объекта минимальный балл поста (он правится на этом же
    экране рекогносцировки) менялся ответом 200, а `document_version_diff`
    сравнивает только «сектор · пост» и «кто на посту» — расхождение
    подписанного документа с фактом не отмечалось нигде.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    assert (
        manager.post(
            f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
        ).status_code
        == 200
    )

    card = manager.get(base).json()
    posts = card["reconSectorPosts"]
    victim = next(p for p in posts if p["visitObjectId"] == str(first.pk))

    refused = manager.patch(
        f"{base}recon/",
        {
            "checklist": card["reconChecklist"],
            "sectorPosts": [
                {**p, "minRating": 5} if p["id"] == victim["id"] else p
                for p in posts
            ],
        },
        format="json",
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "PLACEMENT_FROZEN", refused.json()
    event = service.lock_event(event_id)
    changed = next(
        p for p in event.recon_sector_posts if str(p.get("id")) == str(victim["id"])
    )
    assert changed.get("minRating") != 5, "балл поста замороженного объекта изменён"

    # Сохранение БЕЗ изменений замороженного объекта проходит: иначе один
    # замороженный объект запер бы весь экран рекогносцировки (болезнь №634).
    allowed = manager.patch(
        f"{base}recon/",
        {"checklist": card["reconChecklist"], "sectorPosts": posts},
        format="json",
    )
    assert allowed.status_code == 200, allowed.content


def test_resending_after_a_withdrawal_keeps_the_number_and_takes_the_new_line_up(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 «ОТОЗВАЛ → ПОМЕНЯЛ СОСТАВ → ОТПРАВИЛ СНОВА» НЕ СТЕРЁГ НИКТО (ревью
    №825 по задаче №536).

    До №536 сценарий был недостижим: после отзыва документ оставался
    `SUBMITTED`, а расстановка — замороженной. С №536 он стал обычным, и
    поведение надо назвать вслух, а не оставить на догадку: номер версии тот
    же (закреплять нечего — подписи не было, отзыв после подписи запрещён
    отдельно), а подпись и снимок строки версии перезаписываются НОВЫМ
    составом. Прежняя проба этого не видела: она отправляла повторно ТОТ ЖЕ
    состав, и подпись совпадала сама собой.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    _add_approver(manager, base, first, name="Согласующий первого")
    assert (
        manager.post(
            f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
        ).status_code
        == 200
    )
    first.refresh_from_db()
    number_before = first.document_version
    signature_before = service._current_document_version(first).signature
    assert signature_before, "фикстура отправила пустой состав — проба вакуумна"

    assert (
        manager.post(
            f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)},
            format="json",
        ).status_code
        == 200
    )

    # Состав МЕНЯЕТСЯ — ради этого отзыв и нажимают.
    event = service.lock_event(event_id)
    mine = service.visit_object_posts(event, first)
    added = manager.post(
        f"{base}placement/assign/",
        {
            "postId": str(mine[0]["id"]),
            "employeeId": str(make_employee(last_name="Довесков").pk),
            "override": True,
            "override_reason": "усиление после отзыва",
        },
        format="json",
    )
    assert added.status_code == 200, added.content

    assert (
        manager.post(
            f"{base}placement/complete/", {"visitObjectId": str(first.pk)},
            format="json",
        ).status_code
        == 200
    )
    resent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resent.status_code == 200, resent.content

    first.refresh_from_db()
    current = service._current_document_version(first)
    assert first.document_version == number_before, (
        "номер вырос: отозванная версия ничьим решением не закреплена"
    )
    assert current.status == "SUBMITTED"
    assert current.signature != signature_before, (
        "строка версии несёт подпись ПРЕЖНЕГО состава — согласующие подпишут "
        "не то, что видят"
    )
    assert first.approval_snapshot == current.signature, (
        "снимок отправки разошёлся с подписью версии"
    )


def test_every_frozen_status_has_its_own_words():
    """🔴 ОТКАЗ ЗАМОРОЗКИ ГОВОРИТ, ЧТО ДЕЛАТЬ, — И ДЛЯ КАЖДОГО СТАТУСА СВОЁ
    (Plane №533, найдено ревью №825).

    Прежний текст был один на оба статуса: «документ на согласовании ИЛИ
    согласован… через возврат на доработку». Для СОГЛАСОВАННОГО объекта совет
    неисполним — `return_placement` требует стадии «Согласование», а
    согласованный объект уже на «Ознакомлении».

    Проба сторожит не формулировки, а ПОЛНОТУ таблицы: статус, попавший в
    заморозку без своей строки, дал бы `KeyError` — то есть 500 вместо отказа.
    """
    assert set(service._FROZEN_MESSAGE) == set(service._FROZEN_DOCUMENT_STATUSES)
    for status, words in service._FROZEN_MESSAGE.items():
        assert words.strip(), status


def test_a_closed_object_refuses_placement_even_with_a_draft_document(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 ЗАКРЫТЫЙ ОБЪЕКТ СНОВА СТАЛ ПРАВИМЫМ (Plane №533, найдено ревью №825).

    Ключ заморозки переехал со стадии объекта на статус документа — и в одну
    сторону стал слабее прежнего: объект с документом-ЧЕРНОВИКОМ пропускался
    независимо от того, как далеко он уехал по этапам. Других гвардов у
    `placement/assign|unassign|senior` нет, поэтому закрытый объект с
    черновиком снова принимал правки — против `[ЗАК-05]` «после закрытия
    изменения невозможны».

    Состояние заводится ПРЯМО В МОДЕЛИ, а не боевым путём: боевое закрытие
    требует «Проведения» и по дороге доводит документ до согласованного, то
    есть замораживает его и без нового правила — проба стала бы вакуумной и
    зеленела бы даже с откаченным гвардом.
    """
    base, event_id, first, _second, assigned = two_objects_on_approval
    first.refresh_from_db()
    assert service.document_status_of(first) == "DRAFT", (
        "фикстура отправила документ — проба проверяла бы старое правило"
    )
    assert not service.placement_frozen(first), "фикстура заморозила объект заранее"

    first.stage = "CLOSED"
    first.save(update_fields=["stage", "updated_at"])

    refused = manager.post(
        f"{base}placement/assign/",
        {
            "postId": str(assigned[str(first.pk)]),
            "employeeId": str(make_employee(last_name="Позднев").pk),
            "override": True,
            "override_reason": "проверка гарда",
        },
        format="json",
    )
    assert refused.status_code == 422, refused.content
    payload = refused.json()
    assert payload["error_code"] == "PLACEMENT_FROZEN", payload
    assert payload["details"]["closed"] is True, payload
    assert "закрыт" in payload["message"], payload["message"]
    # А соседний объект, который не закрыт, правится как раньше.
    allowed = manager.post(
        f"{base}placement/assign/",
        {
            "postId": str(assigned[str(_second.pk)]),
            "employeeId": str(make_employee(last_name="Соседов").pk),
            "override": True,
            "override_reason": "усиление",
        },
        format="json",
    )
    assert allowed.status_code == 200, allowed.content


def test_a_remark_on_an_unmarked_post_of_the_only_object_is_accepted(
    manager, approver, one_object_with_unmarked_posts  # noqa: F811
):
    """🔴 ПРАВИЛО «ЧЕЙ ЭТО ПОСТ» НЕ ЗАПРЕЩАЕТ ЗАКОННОГО (Plane №506, найдено
    ревью №825).

    Проверка принадлежности делегирована общему `visit_object_posts`, и это
    верно: у ЕДИНСТВЕННОГО объекта его посты — ВСЕ, включая неразмеченные. Но
    ни одна проба до этой в сломанную ветку не заходила — все они идут на
    фикстуре с импортом из паспорта, а импорт всегда пишет `visitObjectId`.
    То есть «упрощение» до `p["visitObjectId"] == visit.pk` (дословная форма
    дефекта №451) оставило бы весь набор зелёным, а живьём запретило бы
    законное замечание на любом ОМ без разметки.
    """
    base, event_id, visit, post = one_object_with_unmarked_posts
    _add_approver(manager, base, visit, name="Согласующий единственного")
    assert (
        manager.post(
            f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
        ).status_code
        == 200
    )
    visit.refresh_from_db()
    approver_id = visit.approval_route[0]["id"]

    event = service.lock_event(event_id)
    unmarked = [
        p for p in event.recon_sector_posts if not (p.get("visitObjectId") or "")
    ]
    assert unmarked, "разметка появилась — проба вакуумна"

    accepted = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "переделать",
            "visitObjectId": str(visit.pk),
            "remarks": [
                {"text": "Свой пост", "postId": str(unmarked[0]["id"]), "urgent": False}
            ],
        },
        format="json",
    )

    assert accepted.status_code == 200, accepted.content
    visit.refresh_from_db()
    assert [str(r.get("postId")) for r in (visit.approval_remarks or [])] == [
        str(unmarked[0]["id"])
    ]
