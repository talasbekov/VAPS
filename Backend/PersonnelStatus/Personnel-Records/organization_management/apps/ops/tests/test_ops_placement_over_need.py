"""Назначение сверх расчёта поста — МЯГКИЙ конфликт (Plane №414).

Решение заказчика 04.09.2026 из трёх вариантов («жёсткий запрет», «мягкое
предупреждение с обоснованием», «оставить как есть»): выбран второй. Поставить
на пост больше людей, чем в расчёте, МОЖНО — командир усиливает пост осознанно,
— но сервер спрашивает почему, и обоснование остаётся в строке назначения.

Форма ответа — та же, что у требования рейтинга: 409 `SOFT_CONFLICT_DETECTED`,
`overridable`, повтор с `override` + `override_reason`. Своего диалога экрану не
заводили: `ConflictDialog` в `PlacementStage` уже разбирает любой мягкий
конфликт и печатает сообщение сервера.

До этой правки пост с потребностью 1 принимал сколько угодно людей молча —
проверено прогоном 04.09.2026: принято 5 назначений из 5.
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


@pytest.fixture
def event_on_placement(manager):
    """ОМ на расстановке с ОДНИМ постом, потребность которого равна 1."""
    obj = make_object(with_passport=True)
    created = manager.post(
        "/api/ops/security-events/",
        {
            "title": "Проба усиления поста",
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
        f"/api/ops/security-events/{event_id}/bulletin/",
        {"briefDescription": "x", "initialTasks": "—"},
        format="json",
    )
    manager.post(f"/api/ops/security-events/{event_id}/bulletin/complete/")
    give_chief(manager, event_id)
    visit = service.lock_event(event_id).visit_objects.get()
    manager.patch(
        f"/api/ops/security-events/{event_id}/recon/",
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
                    "post": "Пост 1",
                    "task": "",
                    "need": 1,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                    "visitObjectId": str(visit.pk),
                }
            ],
        },
        format="json",
    )
    completed = manager.post(
        f"/api/ops/security-events/{event_id}/recon/complete/"
    )
    assert completed.status_code == 200, completed.content
    post_id = service.lock_event(event_id).recon_sector_posts[0]["id"]
    return event_id, post_id


def assign(api, event_id, post_id, employee, **extra):
    return api.post(
        f"/api/ops/security-events/{event_id}/placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk), **extra},
        format="json",
    )


def test_first_assignment_within_the_need_goes_through_silently(
    manager, event_on_placement
):
    """Расчёт не исчерпан — предупреждения нет: гард не мешает обычной работе."""
    event_id, post_id = event_on_placement
    resp = assign(manager, event_id, post_id, make_employee("Первый", "Первович"))
    assert resp.status_code == 200, resp.content

    assignment = service.lock_event(event_id).placement_assignments[0]
    assert assignment["needOverrideReason"] is None, (
        "обоснование записано там, где конфликта не было"
    )


def test_assignment_over_the_need_asks_for_a_reason(manager, event_on_placement):
    """Второй человек на пост с расчётом 1 — 409 с кодом OVER_NEED."""
    event_id, post_id = event_on_placement
    assert assign(
        manager, event_id, post_id, make_employee("Первый", "Первович")
    ).status_code == 200

    resp = assign(manager, event_id, post_id, make_employee("Второй", "Вторович"))
    assert resp.status_code == 409, resp.content
    body = resp.json()
    assert body["error_code"] == "SOFT_CONFLICT_DETECTED"
    assert body["overridable"] is True
    codes = [c["conflict_code"] for c in body["details"]["conflicts"]]
    assert "OVER_NEED" in codes, body
    assert len(service.lock_event(event_id).placement_assignments) == 1, (
        "отказ обязан быть чистым — назначение не должно было записаться"
    )


def test_the_reason_lets_the_reinforcement_through_and_is_kept(
    manager, event_on_placement
):
    """Повтор с обоснованием проходит, и обоснование остаётся в строке."""
    event_id, post_id = event_on_placement
    assign(manager, event_id, post_id, make_employee("Первый", "Первович"))
    second = make_employee("Второй", "Вторович")

    resp = assign(
        manager,
        event_id,
        post_id,
        second,
        override=True,
        override_reason="Усиление поста по решению старшего наряда",
    )
    assert resp.status_code == 200, resp.content

    assignments = service.lock_event(event_id).placement_assignments
    assert len(assignments) == 2
    reinforcement = next(
        a for a in assignments if a["employeeId"] == str(second.pk)
    )
    assert (
        reinforcement["needOverrideReason"]
        == "Усиление поста по решению старшего наряда"
    )
