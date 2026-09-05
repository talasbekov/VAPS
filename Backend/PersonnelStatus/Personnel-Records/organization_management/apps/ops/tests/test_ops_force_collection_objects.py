"""Собранные → объекты → расстановка (Plane №390, `[СБС-13]`)."""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent

from .test_ops_forces_gathering import (  # noqa: F401
    allocated_event,
    make_assignment_status_type,
    make_department,
    make_directorate,
)
from .test_ops_forces_scope import employee_of, scoped_client  # noqa: F401
from .test_ops_security_events_api import manager  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _accepted_event(manager):  # noqa: F811
    """ОМ с принятым составом из двух человек одного департамента."""
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("fc-dept", "FC_DEPT", own.pk)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    people = [employee_of(directorate, name) for name in ("Первов", "Второв")]
    for person in people:
        manager.post(
            f"{base}forces/allocation/{allocation_id}/members/",
            {"employeeId": str(person.pk)},
            format="json",
        )
    assert dept_lead.post(f"{base}forces/allocation/{allocation_id}/submit/").status_code == 200
    assert manager.post(f"{base}forces/allocation/{allocation_id}/accept/").status_code == 200
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    visit = OpsSecurityEvent.objects.get(pk=event_id).visit_objects.first()
    return base, [str(p.pk) for p in people], str(visit.pk)


def test_the_collection_card_carries_roster_objects_and_capacity(manager):  # noqa: F811
    base, people, visit_id = _accepted_event(manager)

    body = manager.get(f"{base}force-collection/").json()

    assert {r["employeeId"] for r in body["roster"]} == set(people)
    assert body["objects"][0]["visitObjectId"] == visit_id
    assert body["objects"][0]["assigned"] == 0
    assert body["handover"] == {}


def test_people_are_given_to_an_object_and_the_capacity_counts_them(manager):  # noqa: F811
    """Красная на мутации: не пиши `visitObjectId` в строку состава — ёмкость
    объекта останется нулём."""
    base, people, visit_id = _accepted_event(manager)

    resp = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": visit_id}]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["objects"][0]["assigned"] == 1
    by_id = {r["employeeId"]: r for r in body["roster"]}
    assert by_id[people[0]]["visitObjectId"] == visit_id
    assert by_id[people[1]].get("visitObjectId") is None


def test_a_foreign_object_is_refused_by_the_field(manager):  # noqa: F811
    base, people, _visit_id = _accepted_event(manager)

    resp = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": "999999"}]},
        format="json",
    )

    assert resp.status_code == 400
    assert "rows.0.visitObjectId" in resp.json()["details"]


def test_hand_over_refuses_unassigned_and_requires_a_comment_on_shortfall(manager):  # noqa: F811
    """Нераспределённые — отказ; недобор — только с комментарием; с
    комментарием передача записана вместе с недобором по объектам."""
    base, people, visit_id = _accepted_event(manager)
    url = f"{base}force-collection/hand-over/"

    unassigned = manager.post(url, {"comment": "x"}, format="json")
    assert unassigned.status_code == 422
    assert unassigned.json()["error_code"] == "FORCE_ROSTER_UNASSIGNED"

    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": p, "visitObjectId": visit_id} for p in people]},
        format="json",
    )
    silent = manager.post(url, {}, format="json")
    assert silent.status_code == 400
    assert "comment" in silent.json()["details"]

    done = manager.post(url, {"comment": "Двоих хватит, остальных доберём"}, format="json")
    assert done.status_code == 200, done.data
    handover = done.json()["handover"]
    assert handover["comment"] == "Двоих хватит, остальных доберём"
    assert handover["shortfall"][0]["visitObjectId"] == visit_id
    assert handover["shortfall"][0]["short"] > 0

    again = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": None}]},
        format="json",
    )
    assert again.status_code == 422
    assert again.json()["error_code"] == "FORCE_HANDED_OVER"


# ── Ревью a487b7dd: раздача после передачи и ОМ без объектов (№577, №578) ───


def test_a_top_up_after_the_handover_can_still_be_given_to_an_object(manager):  # noqa: F811
    """🔴 Plane №577: довыделенных после передачи можно отдать объекту.

    Отказ `FORCE_HANDED_OVER` закрывал распределение ЦЕЛИКОМ, а состав после
    передачи продолжает пополняться: приёмка довыделения (`[СБС-12]` — явно
    поддержанный ход) дописывает строку в `force_roster`, и приходит она без
    `visitObjectId`. Второй передачи нет, значит отдать нового человека
    объекту становилось нельзя НИКОГДА: он лежал в составе нераспределённым, а
    отказ объяснял это «распределение закрыто».

    Мутация: вернуть отказ на любое распределение после передачи — последний
    запрос ниже отобьётся 422.
    """
    base, people, visit_id = _accepted_event(manager)
    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": p, "visitObjectId": visit_id} for p in people]},
        format="json",
    )
    assert manager.post(
        f"{base}force-collection/hand-over/", {"comment": "Хватит"}, format="json"
    ).status_code == 200

    # Довыделение приехало ПОСЛЕ передачи: строка состава без объекта.
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.force_roster = [
        *event.force_roster,
        {
            "employeeId": "999001",
            "employeeName": "Довыделенов Д.",
            "acceptedAt": None,
            "visitObjectId": None,
        },
    ]
    event.save(update_fields=["force_roster", "updated_at"])

    resp = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": "999001", "visitObjectId": visit_id}]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    by_id = {r["employeeId"]: r for r in resp.json()["roster"]}
    assert by_id["999001"]["visitObjectId"] == visit_id


def test_the_already_given_are_not_moved_after_the_handover(manager):  # noqa: F811
    """А переставлять уже розданных после передачи по-прежнему нельзя.

    Расстановка объекта уже считает их своими; без этой пробы №577 можно было
    бы «починить», сняв защиту вовсе.
    """
    base, people, visit_id = _accepted_event(manager)
    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": p, "visitObjectId": visit_id} for p in people]},
        format="json",
    )
    manager.post(f"{base}force-collection/hand-over/", {"comment": "Хватит"}, format="json")

    refused = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": None}]},
        format="json",
    )

    assert refused.status_code == 422
    assert refused.json()["error_code"] == "FORCE_HANDED_OVER"


def test_an_event_without_visit_objects_can_be_handed_over(manager):  # noqa: F811
    """🔴 Plane №578: ОМ без объектов посещения передаётся на расстановку.

    Мероприятия без объектов раздел поддерживает явно, а `visitObjectId` у
    них может быть только `null` — значит «не распределены» всегда равнялось
    размеру состава, и кнопка «Передать на расстановку» была вечно выключена
    с подсказкой «сначала отдайте объектам всех собранных», при пустом списке
    «На объект…». Человеку велели сделать то, чего сделать нечем.

    Мутация: вернуть проверку `if unassigned:` без `and objects` — передача
    отобьётся `FORCE_ROSTER_UNASSIGNED`.
    """
    base, _people, _visit_id = _accepted_event(manager)
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    # Объекты посещения снимаем напрямую: предмет пробы — передача у ОМ БЕЗ
    # них, а не путь, которым он таким стал.
    event.visit_objects.all().delete()
    event.recon_sector_posts = [
        {**post, "visitObjectId": None} for post in (event.recon_sector_posts or [])
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    body = manager.get(f"{base}force-collection/").json()
    assert body["objects"] == [], "у ОМ без объектов список «На объект…» пуст"
    assert all(not r.get("visitObjectId") for r in body["roster"])

    done = manager.post(
        f"{base}force-collection/hand-over/", {"comment": ""}, format="json"
    )

    assert done.status_code == 200, done.data
    assert done.json()["handover"]["at"]


# ── Ревью a487b7dd: раздачу по объектам кто-то ЧИТАЕТ (Plane №579) ─────────


def _two_objects_with_posts(manager):  # noqa: F811
    """ОМ с принятым составом, двумя объектами и постом у каждого."""
    from .test_ops_security_events_api import make_object

    base, people, first_id = _accepted_event(manager)
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    second = event.visit_objects.create(
        security_object=make_object(code="OBJ-FC-2", name="Второй объект"),
        object_name="Второй объект",
        passport_binding=None,
        position=2,
        stage=event.visit_objects.first().stage,
        chief_employee_id=event.visit_objects.first().chief_employee_id,
        chief_name=event.visit_objects.first().chief_name,
    )
    posts = list(event.recon_sector_posts or [])
    assert posts, "фикстуре нужен хотя бы один пост"
    # Второй пост дописывается: паспорт стенда даёт один, а предмет пробы —
    # ДВА объекта с постом у каждого.
    event.recon_sector_posts = [
        {**posts[0], "visitObjectId": first_id},
        {
            **posts[0],
            "id": "post-second-object",
            "post": "Пост второго объекта",
            "visitObjectId": str(second.pk),
        },
        *[{**p, "visitObjectId": first_id} for p in posts[1:]],
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    return base, people, first_id, str(second.pk), event.recon_sector_posts


def test_a_person_given_to_one_object_is_refused_on_a_post_of_another(manager):  # noqa: F811
    """🔴 Plane №579: `visitObjectId` состава наконец кто-то читает.

    Штаб раздаёт состав объектам (`[СБС-13]`), и строка состава несёт, кому
    человек отдан. Записывали это с самого шага, а гард расстановки проверял
    ТОЛЬКО принадлежность к составу — и беда, которую тот шаг объявлял
    починенной («у ОМ с двумя объектами люди одного предлагались на посты
    другого»), воспроизводилась ровно как раньше.

    Мутация: убрать проверку `given_to != owner` из `assign_placement` —
    назначение на чужой пост пройдёт.
    """
    base, people, first_id, second_id, posts = _two_objects_with_posts(manager)
    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": first_id}]},
        format="json",
    )

    refused = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[1]["id"], "employeeId": people[0]},
        format="json",
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "NOT_IN_ROSTER"
    assert "Второй объект" in refused.json()["message"]
    assert refused.json()["details"]["visitObjectId"] == first_id


def test_a_person_given_to_the_object_is_placed_on_its_own_post(manager):  # noqa: F811
    """На пост СВОЕГО объекта тот же человек ставится — правило разрешает, а
    не запрещает вообще."""
    base, people, first_id, _second_id, posts = _two_objects_with_posts(manager)
    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": first_id}]},
        format="json",
    )

    ok = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": people[0]},
        format="json",
    )

    assert ok.status_code in (200, 201), ok.content


def test_an_undistributed_person_is_placed_anywhere(manager):  # noqa: F811
    """Нераспределённый (`null`) ставится куда угодно.

    Это обычное состояние ОМ, где штаб раздачей не пользовался; без этой
    пробы №579 можно было бы «починить» правилом «без раздачи никого никуда»,
    и расстановка встала бы у всех таких мероприятий.
    """
    base, people, _first_id, _second_id, posts = _two_objects_with_posts(manager)

    ok = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[1]["id"], "employeeId": people[1]},
        format="json",
    )

    assert ok.status_code in (200, 201), ok.content
