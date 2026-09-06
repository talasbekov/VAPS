"""Перенос человека между постами — ОДНА операция (Plane №762).

🔴 ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ. Переноса у сервера не было вовсе: клиент выражал его
двумя запросами — снять (`DELETE /placement/<id>/`) и назначить
(`POST /placement/assign/`). Между ними сотрудник не назначен НИКУДА. №744
научила клиент возвращать его на прежний пост, когда назначение не состоялось,
но возврат делает КЛИЕНТ: закрытая вкладка, перезагрузка или обрыв связи ровно
в этот миг — и восстанавливать некому. Человек остаётся снятым с обоих постов
молча, на этапе, после которого расстановку подписывают и печатают документом.

Отсюда предмет проб ниже: ОТКАЗ НЕ МЕНЯЕТ НИЧЕГО. Не «клиент умеет откатить», а
«откатывать нечего» — состояние до отказа и после совпадает побайтово, потому
что снятие и назначение живут в одной транзакции.
"""
import pytest

from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,
    give_chief,
    make_employee,
    make_object,
    manager,  # noqa: F401 — фикстура ведущего мероприятие, одна на раздел
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def event_with_two_posts(manager):  # noqa: F811
    """ОМ на расстановке с ДВУМЯ постами, потребность каждого — 1.

    Два поста, а не один: предмет — перенос, и на одном посту его не выразить.
    Потребность 1 у обоих взята нарочно — она делает второй пост
    укомплектованным ровно одним человеком, и на нём проверяется отказ.
    """
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба переноса",
            "objectId": str(obj.pk),
            "businessDate": "2026-08-26",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    manager.patch(
        f"{URL}{event_id}/bulletin/",
        {"briefDescription": "x", "initialTasks": "—"},
        format="json",
    )
    manager.post(f"{URL}{event_id}/bulletin/complete/")
    give_chief(manager, event_id)
    visit = service.lock_event(event_id).visit_objects.get()
    manager.patch(
        f"{URL}{event_id}/recon/",
        {
            # Чек-лист отмечается, а не стирается (Plane №541, доведено ревью
            # №825): пустой список снимал `[РЕК-07]` целиком, и фикстура
            # опиралась на эту дыру, чтобы закрыть этап.
            "checklist": [
                {**item, "state": "NORMAL"}
                for item in manager.get(f"/api/ops/security-events/{event_id}/").json()["reconChecklist"]
            ],
            "sectorPosts": [
                {
                    "sector": "Сектор A",
                    "post": f"Пост {index}",
                    "task": "",
                    "need": 1,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                    "visitObjectId": str(visit.pk),
                }
                for index in (1, 2)
            ],
        },
        format="json",
    )
    assert manager.post(f"{URL}{event_id}/recon/complete/").status_code == 200
    posts = service.lock_event(event_id).recon_sector_posts
    return event_id, posts[0]["id"], posts[1]["id"]


def assign(api, event_id, post_id, employee, **extra):
    return api.post(
        f"{URL}{event_id}/placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk), **extra},
        format="json",
    )


def move(api, event_id, assignment_id, post_id, **extra):
    return api.post(
        f"{URL}{event_id}/placement/{assignment_id}/move/",
        {"postId": post_id, **extra},
        format="json",
    )


def assignments(event_id):
    return service.lock_event(event_id).placement_assignments


def test_move_puts_the_person_on_the_new_post_in_one_call(
    manager, event_with_two_posts  # noqa: F811
):
    """Один запрос переносит: на новом посту он есть, на старом никого."""
    event_id, first, second = event_with_two_posts
    employee = make_employee("Переносимый", "Иванович")
    assert assign(manager, event_id, first, employee).status_code == 200
    before = assignments(event_id)[0]

    resp = move(manager, event_id, before["id"], second)

    assert resp.status_code == 200, resp.content
    rows = assignments(event_id)
    assert len(rows) == 1, "перенос обязан двигать строку, а не заводить вторую"
    assert rows[0]["postId"] == second
    # ИДЕНТИФИКАТОР ТОТ ЖЕ: это перенос, а не «удалили и завели заново».
    # Ссылка «мои назначения» у самого сотрудника переносом не ломается.
    assert rows[0]["id"] == before["id"]
    assert rows[0]["employeeId"] == str(employee.pk)


def test_refused_move_leaves_the_person_exactly_where_he_was(
    manager, event_with_two_posts  # noqa: F811
):
    """🔴 ГЛАВНАЯ ПРОБА: отказ не меняет НИЧЕГО.

    Пост-приёмник укомплектован (расчёт 1, занят), поэтому перенос без
    обоснования отвечает 409. До №762 то же самое выражалось парой запросов, и
    снятие УЖЕ прошло: человек оставался нигде, а вернуть его мог только
    клиент — если доживал до ответа.

    Красная на мутации «снимать до проверки конфликтов»: строка исчезнет с
    исходного поста, и `rows[0]["postId"] == first` не выполнится.
    """
    event_id, first, second = event_with_two_posts
    mover = make_employee("Переносимый", "Иванович")
    holder = make_employee("Занявший", "Петрович")
    assert assign(manager, event_id, first, mover).status_code == 200
    assert assign(manager, event_id, second, holder).status_code == 200
    before = [dict(row) for row in assignments(event_id)]
    moving = next(row for row in before if row["employeeId"] == str(mover.pk))

    resp = move(manager, event_id, moving["id"], second)

    assert resp.status_code == 409, resp.content
    body = resp.json()
    assert body["error_code"] == "SOFT_CONFLICT_DETECTED"
    codes = [c["conflict_code"] for c in body["details"]["conflicts"]]
    assert "OVER_NEED" in codes, body
    # Состояние ДО и ПОСЛЕ совпадает: отменять нечего.
    assert assignments(event_id) == before


def test_move_with_a_reason_goes_through_and_keeps_it(
    manager, event_with_two_posts  # noqa: F811
):
    """Обоснование доводит перенос и остаётся в строке — как у назначения."""
    event_id, first, second = event_with_two_posts
    mover = make_employee("Переносимый", "Иванович")
    assign(manager, event_id, first, mover)
    assign(manager, event_id, second, make_employee("Занявший", "Петрович"))
    moving = next(
        row for row in assignments(event_id) if row["employeeId"] == str(mover.pk)
    )

    resp = move(
        manager,
        event_id,
        moving["id"],
        second,
        override=True,
        override_reason="усиление по решению командира",
    )

    assert resp.status_code == 200, resp.content
    moved = next(
        row for row in assignments(event_id) if row["id"] == moving["id"]
    )
    assert moved["postId"] == second
    assert moved["needOverrideReason"] == "усиление по решению командира"


def test_role_change_on_the_same_post_needs_no_reason(
    manager, event_with_two_posts  # noqa: F811
):
    """Смена роли В ПРЕДЕЛАХ поста — тот же перенос, и он не «усиление».

    Конфликт `OVER_NEED` считается ИСКЛЮЧАЯ переносимого. Иначе человек
    считался бы занимающим место сам у себя, и любая правка его роли или
    секции (Plane №239, №242) требовала бы обоснования усиления — на посту,
    численность которого не изменилась ни на единицу.
    """
    from organization_management.apps.operations.models import OpsDictionaryEntry

    OpsDictionaryEntry.objects.get_or_create(
        dictionary_code="PLACEMENT_ROLES",
        code="SENIOR",
        defaults={"label": "Старший", "is_active": True},
    )
    event_id, first, _second = event_with_two_posts
    employee = make_employee("Переносимый", "Иванович")
    assign(manager, event_id, first, employee)
    row = assignments(event_id)[0]

    resp = move(manager, event_id, row["id"], first, roleCode="SENIOR")

    assert resp.status_code == 200, resp.content
    moved = assignments(event_id)[0]
    assert moved["postId"] == first
    assert moved["roleCode"] == "SENIOR"
    assert moved["needOverrideReason"] is None, (
        "смена роли на своём посту усилением не является"
    )


def test_move_drops_the_acknowledgement(
    manager, event_with_two_posts  # noqa: F811
):
    """Отметка ознакомления не переезжает: человек знакомился с ПРЕЖНИМ постом.

    Оставить её значило бы расписаться за него о посте, которого он не видел.
    """
    event_id, first, second = event_with_two_posts
    employee = make_employee("Переносимый", "Иванович")
    assign(manager, event_id, first, employee)
    event = service.lock_event(event_id)
    event.placement_assignments = [
        {**row, "acknowledgedAt": "2026-08-26T10:00:00+00:00", "isSectorSenior": True}
        for row in event.placement_assignments
    ]
    event.save(update_fields=["placement_assignments"])
    row = assignments(event_id)[0]

    assert move(manager, event_id, row["id"], second).status_code == 200

    moved = assignments(event_id)[0]
    assert moved["acknowledgedAt"] is None
    # Старшинство относилось к покинутому посту и с человеком не едет.
    assert moved["isSectorSenior"] is False


def test_move_to_an_unknown_post_is_404_and_changes_nothing(
    manager, event_with_two_posts  # noqa: F811
):
    """Опечатка в посте-приёмнике не снимает человека с его поста."""
    event_id, first, _second = event_with_two_posts
    employee = make_employee("Переносимый", "Иванович")
    assign(manager, event_id, first, employee)
    before = [dict(row) for row in assignments(event_id)]

    resp = move(manager, event_id, before[0]["id"], "post-которого-нет")

    assert resp.status_code == 404, resp.content
    assert assignments(event_id) == before


def test_move_of_an_unknown_assignment_is_404(
    manager, event_with_two_posts  # noqa: F811
):
    """Чужой или снятый идентификатор назначения — 404, а не молчание."""
    event_id, _first, second = event_with_two_posts
    assert move(manager, event_id, "assignment-нет", second).status_code == 404
