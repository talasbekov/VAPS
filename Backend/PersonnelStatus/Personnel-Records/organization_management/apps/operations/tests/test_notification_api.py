"""GET /api/operations/notifications/ — личная лента уведомлений.

Зона ответственности вьюхи: чья лента (аутентификация вместо кода права),
разбор курсора, страничная выдача и ОТСУТСТВИЕ пишущих глаголов. Что
попадает в ленту и в каком порядке — зона селектора
(test_notification_selector); как уведомление записывается — test_notify.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/notifications/"
DAY = date(2026, 8, 5)
T0 = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)


def send(recipient, *, day=DAY, payload=None, created_at=None):
    """Уведомление через ЕДИНСТВЕННУЮ точку записи, а не ORM напрямую.

    Так проба читает ровно то, что кладёт продакшен-путь. created_at —
    auto_now_add, поэтому время проставляется вторым проходом: курсор иначе
    нечем проверить.
    """
    row = notify(
        recipient,
        OpsNotification.Kind.SUBMISSION_LAGGING,
        day,
        payload=payload or {"laggard_division_ids": [1]},
    )
    if created_at is not None:
        OpsNotification.objects.filter(pk=row.pk).update(created_at=created_at)
        row.refresh_from_db()
    return row


def reader(username="notif-reader"):
    """Пользователь БЕЗ единой роли: лента не требует кода права."""
    api, user = client_for(username)
    return api, str(user.pk)


def ids_of(response):
    return [row["id"] for row in response.data["results"]]


# ── Чья лента ────────────────────────────────────────────────────────────


def test_anonymous_403():
    assert APIClient().get(URL).status_code == 403


def test_an_authenticated_actor_without_any_role_reads_own_feed():
    """Кода права нет и не должно быть.

    Вопрос ленты не «кому можно читать уведомления», а ЧЬИ; на него отвечает
    фильтр получателя. Право `notifications.view` раздавалось бы всем без
    исключения и создавало бы ложное впечатление, будто чужую ленту можно
    открыть, имея его.
    """
    api, actor = reader()
    mine = send(actor)

    response = api.get(URL)

    assert response.status_code == 200
    assert ids_of(response) == [mine.id]


def test_another_recipients_notification_is_absent_not_forbidden():
    """Чужое уведомление не «запрещено» — его для читателя не существует.

    Единственная строка в таблице чужая: ответ обязан быть пустой СТРАНИЦЕЙ
    (200), а не 403 и не чужой строкой. 403 здесь означал бы, что лента
    закрыта правом, которого нет.
    """
    api, _ = reader()
    send("чужой-получатель")

    response = api.get(URL)

    assert response.status_code == 200
    assert response.data["count"] == 0


def test_two_readers_see_disjoint_feeds():
    # Отказ выше обязан быть отказом ОБЛАСТИ, а не «лента пуста у всех»:
    # чужая строка существует и видна СВОЕМУ читателю.
    api_a, actor_a = reader("notif-a")
    api_b, actor_b = reader("notif-b")
    mine = send(actor_a)
    theirs = send(actor_b)

    assert ids_of(api_a.get(URL)) == [mine.id]
    assert ids_of(api_b.get(URL)) == [theirs.id]


# ── Курсор ───────────────────────────────────────────────────────────────


def test_since_is_a_strict_lower_bound():
    api, actor = reader()
    seen = send(actor, created_at=T0)
    fresh = send(
        actor, day=DAY - timedelta(days=1), created_at=T0 + timedelta(minutes=1)
    )

    response = api.get(URL, {"since": seen.created_at.isoformat()})

    assert ids_of(response) == [fresh.id]


def test_a_naive_since_is_refused():
    """Наивный момент — 400, а не молча чужое окно.

    В поясе +05 «2026-08-05T12:00» без зоны сдвигает границу на пять часов:
    опрашивающий экран пропустил бы уведомления этих часов и никогда бы о них
    не узнал — курсор ушёл бы дальше. Тот же довод, что у окна журнала.
    """
    api, actor = reader()
    send(actor, created_at=T0)

    response = api.get(URL, {"since": "2026-08-05T12:00:00"})

    assert response.status_code == 400


def test_an_unparseable_since_is_refused():
    api, actor = reader()
    send(actor)

    assert api.get(URL, {"since": "вчера"}).status_code == 400


# ── Выдача ───────────────────────────────────────────────────────────────


def test_the_newest_comes_first_and_the_page_is_wrapped():
    api, actor = reader()
    old = send(actor, day=DAY - timedelta(days=2), created_at=T0)
    middle = send(
        actor, day=DAY - timedelta(days=1), created_at=T0 + timedelta(hours=1)
    )
    newest = send(actor, day=DAY, created_at=T0 + timedelta(hours=2))

    response = api.get(URL)

    # Три строки, посев не совпадает с итоговым порядком: на двух ассерт
    # прошёл бы и без сортировки вовсе.
    assert ids_of(response) == [newest.id, middle.id, old.id]
    assert response.data["count"] == 3
    assert set(response.data) == {"count", "next", "previous", "results"}


def test_limit_and_offset_are_honoured():
    """Пагинация ИСПОЛНЯЕТСЯ, а не только описана в схеме.

    Вьюха — plain ViewSet: pagination_class на классе стоит ради схемы, а
    листает руками сам list(). Из-за этой развилки схема и поведение способны
    разойтись молча (см. test_pagination_params).
    """
    api, actor = reader()
    for offset in range(3):
        send(actor, day=DAY - timedelta(days=offset))

    # Без параметров страница отдаёт всё — иначе усечение ниже было бы
    # неотличимо от того, что строк просто мало.
    full = api.get(URL).data
    assert full["count"] == 3
    assert len(full["results"]) == 3

    page = api.get(URL, {"limit": 1}).data
    assert page["count"] == 3
    assert len(page["results"]) == 1
    assert page["next"] is not None

    nxt = api.get(URL, {"limit": 1, "offset": 1}).data
    assert nxt["results"][0]["id"] != page["results"][0]["id"]


def test_schema_describes_a_page_and_only_get():
    """Схема обещает ровно то, что сервер отдаёт: страницу, GET и курсор.

    Ловушка, ради которой ассерт стоит: у действия с именем `list` эвристика
    spectacular заворачивает объект-страницу ЕЩЁ и в массив, если many=False
    не стоит на КЛАССЕ сериализатора, — клиент получил бы описание массива
    страниц.

    Владелец страничной обёртки ОДИН — `pagination_class`: из него spectacular
    выводит и компонент Paginated…List, и параметры limit/offset. Лента была
    первой, где ручной inline_serializer рядом не заводили; у соседних списков
    он был вторым владельцем того же самого и снят по образцу отсюда.

    Заодно закрепляется отсутствие маршрута одиночного чтения: в схеме нет
    пути /{id}/ — ни как 404, ни как обещание.
    """
    from drf_spectacular.generators import SchemaGenerator

    schema = SchemaGenerator().get_schema(request=None, public=True)
    list_path = schema["paths"][URL]

    assert list(list_path) == ["get"]
    assert f"{URL}{{id}}/" not in schema["paths"]

    body = list_path["get"]["responses"]["200"]["content"]["application/json"]
    assert body["schema"] == {
        "$ref": "#/components/schemas/PaginatedOpsNotificationList"
    }
    page = schema["components"]["schemas"]["PaginatedOpsNotificationList"]
    assert page["type"] == "object"
    assert set(page["properties"]) == {"count", "next", "previous", "results"}
    assert page["properties"]["results"]["type"] == "array"

    # Курсор и листание описаны: без since клиент не узнал бы, чем опрашивать
    # ленту, а без limit/offset — что страницу вообще можно листать (сервер
    # листает в любом случае, см. test_limit_and_offset_are_honoured).
    assert {"since", "limit", "offset"} <= {
        parameter["name"] for parameter in list_path["get"]["parameters"]
    }


def test_the_projection_is_the_flat_fact():
    """Проекция — плоский ФАКТ: вид, дата, данные. Слов в ней нет.

    payload отдаётся как есть: разложив его на поля, вьюха завела бы второе
    представление факта, разъезжающееся с первым при первом же новом виде.
    """
    api, actor = reader()
    send(actor, payload={"laggard_division_ids": [3, 5]})

    row = api.get(URL).data["results"][0]

    assert set(row) == {
        "id",
        "recipient",
        "kind",
        "business_date",
        "payload",
        "read_at",
        "created_at",
    }
    assert row["kind"] == "SUBMISSION_LAGGING"
    assert row["business_date"] == DAY.isoformat()
    assert row["payload"] == {"laggard_division_ids": [3, 5]}
    assert row["read_at"] is None


# ── Только чтение ────────────────────────────────────────────────────────


@pytest.mark.parametrize("verb", ["post", "put", "patch", "delete"])
def test_write_verbs_are_405_not_403(verb):
    """405 раньше гейта: пишущих действий у вьюхи НЕТ, роутер их не знает.

    403 сбивал бы с толку — он обещал бы, что с подходящей ролью запись
    откроется, тогда как открыть её можно только новым действием в коде.
    """
    api, actor = reader()
    send(actor)

    assert getattr(api, verb)(URL, {}, format="json").status_code == 405


def test_there_is_no_detail_route():
    # Одиночного чтения в этом срезе нет: маршрут /{id}/ не заведён, и
    # отсутствие это подтверждается 404, а не «нашлось чужое».
    api, actor = reader()
    mine = send(actor)

    assert api.get(f"{URL}{mine.id}/").status_code == 404


# ── POST .../{id}/read/ — отметка прочитанным ────────────────────────────


def read_url(notification_id):
    return f"{URL}{notification_id}/read/"


def test_marking_read_is_refused_without_an_identity():
    api, me = reader()
    row = send(me)

    assert APIClient().post(read_url(row.pk)).status_code == 403


def test_the_owner_marks_it_read_and_gets_the_moment_back():
    api, me = reader()
    row = send(me)

    with clock.override(T0):
        response = api.post(read_url(row.pk))

    assert response.status_code == 200
    assert response.data["read_at"] is not None
    row.refresh_from_db()
    assert row.read_at == T0


def test_a_repeat_call_answers_the_same_way_instead_of_signalling_a_conflict():
    """Действие идемпотентно, и отдельного кода на повтор нет: клиент, у
    которого экран открыт дважды, не должен разбирать «уже прочитано» как
    ошибку."""
    api, me = reader()
    row = send(me)

    with clock.override(T0):
        first = api.post(read_url(row.pk))
    with clock.override(T0 + timedelta(hours=3)):
        second = api.post(read_url(row.pk))

    assert first.status_code == second.status_code == 200
    assert first.data["read_at"] == second.data["read_at"]


def test_a_foreign_notification_is_not_found_rather_than_forbidden():
    """404, а не 403: ответ «нельзя» подтвердил бы, что такое уведомление есть,
    и что оно адресовано кому-то другому.

    Чужая строка при этом ЕДИНСТВЕННАЯ в таблице — иначе 404 объяснялся бы
    пустой выборкой, а не областью видимости.
    """
    api, me = reader()
    theirs = send("someone-else")

    assert OpsNotification.objects.count() == 1
    assert api.post(read_url(theirs.pk)).status_code == 404


def test_a_foreign_notification_stays_unread():
    api, me = reader()
    theirs = send("someone-else")

    api.post(read_url(theirs.pk))

    theirs.refresh_from_db()
    assert theirs.read_at is None


@pytest.mark.parametrize("junk", ["abc", "999999", "1.5"])
def test_junk_and_missing_ids_answer_the_same_way(junk):
    api, me = reader()
    send(me)

    assert api.post(read_url(junk)).status_code == 404


def test_the_moment_is_set_by_the_server_and_not_by_the_body():
    """Момент, присланный клиентом, позволил бы датировать прочтение задним
    числом — и «что нового с последнего захода» стало бы управляемым снаружи."""
    api, me = reader()
    row = send(me)
    forged = (T0 - timedelta(days=30)).isoformat()

    with clock.override(T0):
        api.post(read_url(row.pk), {"read_at": forged}, format="json")

    row.refresh_from_db()
    assert row.read_at == T0


def test_a_get_on_the_read_route_is_a_method_error():
    api, me = reader()
    row = send(me)

    assert api.get(read_url(row.pk)).status_code == 405


def test_marking_one_notification_leaves_the_rest_of_the_feed_unread():
    api, me = reader()
    first = send(me, day=DAY)
    second = send(me, day=DAY - timedelta(days=1))

    with clock.override(T0):
        api.post(read_url(first.pk))

    second.refresh_from_db()
    assert second.read_at is None
