"""Закрытие по спецификации (`[ЗАК-01]`/`[ЗАК-03]`/`[ЗАК-04]`, Plane №448).

Стережём: закрыть можно без итогов по направлениям, с одним необязательным
комментарием (он сохраняется и отдаётся контрактом); инцидент журнала несёт
время, пост и принятые меры; сводка «постов · назначено · замен · отказов ·
инцидентов» считается на чтении по постам объекта и мероприятия.
"""
import pytest

from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def test_closing_needs_no_direction_summaries_and_keeps_the_comment(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, _, _ = two_objects_on_conduct
    resp = manager.post(f"{URL}{event_id}/close/", {"comment": "  Всё штатно.  "}, format="json")
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["stage"] == "CLOSED"
    assert body["closingComment"] == "Всё штатно."
    assert body["closureDirectionSummaries"] == []
    assert all(v["stage"] == "CLOSED" for v in body["visitObjects"])


def test_incident_carries_time_post_and_measures(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    post_id = service.visit_object_posts(event, first)[0]["id"]
    resp = manager.post(
        f"{URL}{event_id}/journal/",
        {
            "type": "INCIDENT", "title": "Попытка прохода", "description": "Посторонний у КПП",
            "occurredAt": "2026-09-10T10:15:00+05:00", "postId": post_id, "measures": "Задержан, передан полиции",
        },
        format="json",
    )
    assert resp.status_code in (200, 201), resp.content
    entry = next(e for e in resp.json()["journalEntries"] if e["type"] == "INCIDENT")
    assert (entry["occurredAt"], entry["postId"], entry["measures"]) == (
        "2026-09-10T10:15:00+05:00", post_id, "Задержан, передан полиции",
    )


def test_closure_summary_counts_posts_assignments_replacements_and_incidents(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, second = two_objects_on_conduct
    manager.post(f"{URL}{event_id}/journal/", {"type": "INCIDENT", "title": "Инцидент", "description": ""}, format="json")
    body = manager.get(f"{URL}{event_id}/").json()
    total = body["closureSummary"]
    assert set(total) == {"posts", "need", "assigned", "replacements", "declines", "incidents"}
    assert total["incidents"] == 1
    assert total["posts"] == len(body["reconSectorPosts"])
    assert total["assigned"] == len(body["placementAssignments"])
    per_object = [v["closureSummary"] for v in body["visitObjects"]]
    assert sum(s["posts"] for s in per_object) == total["posts"]
    assert sum(s["assigned"] for s in per_object) == total["assigned"]


@pytest.mark.parametrize("junk", ["10:15", "вчера", "2026-13-45T99:00:00", "-"])
def test_incident_time_that_is_not_a_moment_is_refused(manager, two_objects_on_conduct, junk):  # noqa: F811
    """`occurredAt` разбирается при записи, а не печатается как есть (Plane №766).

    🔴 ЗАЩИТА ЧИТАТЕЛЯ — НЕ ПОЧИНКА ФАКТА. №730 научил панель печатать прочерк
    вместо «Invalid Date», но в журнале продолжало лежать значение, которое не
    является временем: документ дела печатает его через `_fmt_dt` строкой как
    есть, а сортировка и расчёты по времени инцидента на таких строках неверны.
    Журнал штаба неизменяем — строка, попавшая туда, остаётся навсегда, поэтому
    отбивать надо на входе.

    Валидный клиент такого не шлёт (форма — `datetime-local`, отправка через
    `toISOString()`), дыра открыта для прямого запроса в API.
    """
    _, event_id, first, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    post_id = service.visit_object_posts(event, first)[0]["id"]
    before = len(service.lock_event(event_id).journal_entries)

    resp = manager.post(
        f"{URL}{event_id}/journal/",
        {
            "type": "INCIDENT", "title": "Попытка прохода", "description": "Посторонний у КПП",
            "occurredAt": junk, "postId": post_id, "measures": "Задержан",
        },
        format="json",
    )
    assert resp.status_code == 400, resp.content
    assert "occurredAt" in resp.json().get("details", {}), resp.content
    # Отказ не должен оставлять половину записи.
    assert len(service.lock_event(event_id).journal_entries) == before


def test_incident_without_a_time_is_still_allowed(manager, two_objects_on_conduct):  # noqa: F811
    """Время инцидента необязательно: пусто — это `None`, а не отказ."""
    _, event_id, _, _ = two_objects_on_conduct
    resp = manager.post(
        f"{URL}{event_id}/journal/",
        {"type": "INCIDENT", "title": "Без времени", "description": "", "occurredAt": ""},
        format="json",
    )
    assert resp.status_code in (200, 201), resp.content
    entry = next(e for e in resp.json()["journalEntries"] if e["title"] == "Без времени")
    assert entry["occurredAt"] is None
