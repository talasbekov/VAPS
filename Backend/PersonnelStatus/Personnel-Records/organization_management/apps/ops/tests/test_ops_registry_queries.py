"""Страница реестра ОМ не растит запросы вместе со строками (Plane №480).

🔴 ЧТО СТЕРЕЖЁТ. `visit_object_posts` на КАЖДОМ вызове спрашивал
`event.visit_objects.count()` — отдельный запрос. При сериализации строки его
зовут дважды на объект посещения (готовность расстановки и признак
устаревшего согласования через подпись), а `primary_visit_object` делал свой
`order_by().first()` в обход уже подтянутого списка — ещё дважды на
мероприятие плюс раз на признак уровня ОМ. Двадцать строк реестра добирали
порядка шестидесяти лишних запросов.

Это ВОЗВРАТ болезни, а не новая: тем же были №376 (51 запрос к одной ручке) и
№786 (восемь запросов на строку). Она незаметна, пока не измеришь: ответ
верный, экран правильный, растёт только время.

ПОЧЕМУ ПРОБА МЕРЯЕТ ПРИРОСТ, А НЕ ЧИСЛО. Абсолютное число запросов зависит от
всего, что делает ручка, — прав, фильтров, пагинации, — и пин на нём краснел
бы от любой соседней правки, ничего не говоря про N+1. Прирост на строку — это
и есть предмет: он обязан быть НУЛЁМ.
"""
import pytest

from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    give_chief,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _event_with_two_objects(manager, index):  # noqa: F811
    """ОМ с ДВУМЯ объектами посещения: на одном объекте N+1 не виден."""
    first = make_object(code=f"OBJ-Q-{index}-A", with_passport=True)
    created = manager.post(
        URL,
        {
            "title": f"Проба запросов реестра {index}",
            "objectId": str(first.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    second = make_object(code=f"OBJ-Q-{index}-B", with_passport=True)
    added = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    give_chief(manager, event_id)
    imported = manager.post(
        f"{URL}{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(added.json()["visitObjects"][0]["id"])},
        format="json",
    )
    assert imported.status_code == 200, imported.content
    return event_id


def _queries_for_registry(manager):  # noqa: F811
    with CaptureQueriesContext(connection) as captured:
        resp = manager.get(f"{URL}?page_size=50")
        assert resp.status_code == 200, resp.content
        rows = len(resp.json()["results"])
    return len(captured), rows


def test_the_registry_does_not_add_queries_per_row(manager):  # noqa: F811
    """Прирост запросов на дополнительное мероприятие — НОЛЬ.

    Красная на мутации: верни `event.visit_objects.count()` внутрь
    `visit_object_posts` (или `order_by().first()` в `primary_visit_object`) —
    каждая новая строка снова начнёт стоить своих запросов.
    """
    _event_with_two_objects(manager, 1)
    one, rows_one = _queries_for_registry(manager)
    assert rows_one == 1, "в реестре не одна строка — прирост не с чем сравнивать"

    _event_with_two_objects(manager, 2)
    _event_with_two_objects(manager, 3)
    three, rows_three = _queries_for_registry(manager)
    assert rows_three == 3

    growth = three - one
    assert growth == 0, (
        f"страница реестра выросла на {growth} запросов из-за двух лишних "
        f"строк ({one} → {three}). Запрос на строку — это N+1: он не виден "
        "глазом и растёт линейно вместе с числом мероприятий."
    )
