"""Нечисловой `need` рекогносцировки — Plane №959.

`PATCH .../recon/` валидировал `sectorPosts[].need` голым `int(row.get("need",
0))`: нечисловое значение (строка, `None` внутри непустого поля, список)
падало необработанным `TypeError`/`ValueError` и превращалось в 500. Соседнее
поле `forceRequest` уже ловило то же самое через try/except — `need` этот
приём пропустил.

Проба стережёт границу мутацией: вернуть голый `int(...)` на месте
try/except красит `test_non_numeric_need_is_rejected_not_500`, а корректный
числовой `need` обязан по-прежнему сохраняться (не даёт зафиксировать фикс,
который заодно ломает рабочий путь).
"""
import pytest

from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def event_with_visit(manager):  # noqa: F811
    obj = make_object(with_passport=True)
    resp = create_event(manager, obj)
    event_id = resp.json()["id"]
    visit_id = resp.json()["visitObjects"][0]["id"]
    return event_id, visit_id


def test_non_numeric_need_is_rejected_not_500(manager, event_with_visit):  # noqa: F811
    event_id, visit_id = event_with_visit
    row = {
        "sector": "Периметр",
        "post": "Пост 1",
        "task": "Охрана",
        "need": "не число",
        "visitObjectId": str(visit_id),
    }

    response = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [row]},
        format="json",
    )

    assert response.status_code == 400, response.content
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    assert "sectorPosts.0.need" in response.json()["details"]


def test_numeric_need_still_saves(manager, event_with_visit):  # noqa: F811
    event_id, visit_id = event_with_visit
    row = {
        "sector": "Периметр",
        "post": "Пост 1",
        "task": "Охрана",
        "need": 2,
        "visitObjectId": str(visit_id),
    }

    response = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [row]},
        format="json",
    )

    assert response.status_code == 200, response.content
