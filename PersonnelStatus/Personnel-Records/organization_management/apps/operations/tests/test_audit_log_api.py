"""GET /api/operations/audit-logs/ и /{id}/ — чтение журнала раздела.

Зона ответственности вьюхи: гейт права (audit.view — своё, не status.*),
разбор фильтров, полный порядок и страничная выдача, отсутствие пишущих
глаголов. Что и когда пишется в журнал — зона врезки (test_audit_coverage),
механика записи — test_audit_service.
"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/audit-logs/"


def detail_url(entry_id):
    return f"{URL}{entry_id}/"


def write(action=None, entity_type=None, entity_id=1, actor="7", at=None, **extra):
    """Строка журнала через ЕДИНСТВЕННУЮ точку записи, а не ORM напрямую.

    Так проба читает ровно то, что кладёт продакшен-путь: сочинённая мимо
    сервиса строка могла бы нести значение, которого журнал не производит.
    """
    with clock.override(at or TODAY):
        return audit_service.record(
            actor=actor,
            action=action or audit_service.STATUS_CREATED,
            entity_type=entity_type or audit_service.ENTITY_STATUS,
            entity_id=entity_id,
            **extra,
        )


def reader(username="aud-reader"):
    return client_for(username, "ORGD", ["audit.view"])[0]


def get(api, url=URL, **params):
    with clock.override(TODAY):
        return api.get(url, params)


def ids_of(response):
    return [row["id"] for row in response.data["results"]]


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области: различает форма (гейт → {detail} DRF)."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403():
    assert_denied_by_gate(get(APIClient()))


def test_status_rights_do_not_open_the_journal():
    # Журнал — своё право. Оператор, которому выдали и чтение, и запись
    # статусов, читателем журнала от этого не становится: иначе audit.view
    # был бы украшением, а «кто и что менял» видел бы каждый, кто менял.
    api, _ = client_for(
        "aud-status-guy", "OPERATOR", ["status.manage", "status.view"]
    )
    write()
    assert_denied_by_gate(get(api))


def test_audit_view_holder_reads():
    # Обратная сторона: отказ выше обязан быть отказом ПРАВА, а не «журнал
    # закрыт всем» ([[право без persona-без-него не демонстрируется]]).
    write()
    response = get(reader())
    assert response.status_code == 200
    assert response.data["count"] == 1


# ── Поверхность: только чтение ───────────────────────────────────────────

@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_verbs_are_405(method):
    # Журнал append-only на уровне БД; открытый по HTTP глагол обещал бы
    # правку, которую триггер всё равно отвергнет 500-м.
    #
    # 405, а НЕ 403: метод не маршрутизирован, и это выясняется раньше гейта
    # права. Отвечать «нет доступа» на глагол, которого не существует, значило
    # бы намекать, что с нужной ролью он бы сработал.
    entry = write()
    url = detail_url(entry.pk) if method != "post" else URL
    with clock.override(TODAY):
        assert getattr(reader(), method)(url, {}, format="json").status_code == 405
        # И БЕЗ права — тоже 405: иначе ответ «нет доступа» намекал бы, что с
        # нужной ролью глагол сработал бы.
        api, _ = client_for(f"aud-nope-{method}", "OPERATOR", ["status.view"])
        assert getattr(api, method)(url, {}, format="json").status_code == 405


# ── Фильтры ──────────────────────────────────────────────────────────────

class TestFilters:
    def test_entity_feed_is_addressable(self):
        # Главный разрез журнала: лента КОНКРЕТНОЙ сущности.
        mine = write(entity_id=42)
        write(entity_id=43)
        write(entity_type=audit_service.ENTITY_SECONDMENT, entity_id=42)

        response = get(
            reader(), entity_type=audit_service.ENTITY_STATUS, entity_id=42
        )
        assert ids_of(response) == [mine.pk]

    def test_actor_and_action_filters(self):
        mine = write(actor="9", action=audit_service.STATUS_CANCELLED)
        write(actor="9", action=audit_service.STATUS_CREATED)
        write(actor="7", action=audit_service.STATUS_CANCELLED)

        api = reader()
        assert ids_of(get(api, actor="9", action=audit_service.STATUS_CANCELLED)) == [
            mine.pk
        ]

    def test_window_is_half_open(self):
        # [from, to): строка, легшая ровно в `to`, в окно НЕ входит — иначе
        # два соседних окна показали бы её дважды.
        base = timezone.now().replace(microsecond=0)
        early = write(at=base)
        edge = write(at=base + timedelta(hours=1))

        response = get(
            reader(),
            created_from=base.isoformat(),
            created_to=(base + timedelta(hours=1)).isoformat(),
        )
        assert ids_of(response) == [early.pk]
        # Верхняя граница включительно показала бы обе строки — проба
        # различает эти два поведения, а не просто «что-то вернулось».
        assert edge.pk not in ids_of(response)

    def test_unknown_action_is_400_not_empty_page(self):
        # Словарь событий закрыт: опечатка это ошибка запроса. Пустая
        # страница убедила бы читателя, что таких событий не было.
        write()
        response = get(reader(), action="STATUS_CREATE")
        assert response.status_code == 400
        assert "action" in response.data

    def test_unknown_entity_type_is_400(self):
        write()
        response = get(reader(), entity_type="status")
        assert response.status_code == 400
        assert "entity_type" in response.data

    def test_naive_datetime_is_400(self):
        # Наивный момент в поясе +05 сдвинул бы границу окна на пять часов, и
        # читатель молча получил бы чужой день.
        write()
        response = get(reader(), created_from="2026-08-04T00:00:00")
        assert response.status_code == 400
        assert "created_from" in response.data

    def test_unparsable_datetime_is_400(self):
        write()
        response = get(reader(), created_to="вчера")
        assert response.status_code == 400
        assert "created_to" in response.data

    def test_unparsable_entity_id_is_400(self):
        write()
        response = get(reader(), entity_id="abc")
        assert response.status_code == 400
        assert "entity_id" in response.data


# ── Порядок и страницы ───────────────────────────────────────────────────

class TestOrdering:
    def test_fresh_first(self):
        base = timezone.now().replace(microsecond=0)
        old = write(at=base)
        middle = write(at=base + timedelta(minutes=1))
        fresh = write(at=base + timedelta(minutes=2))

        # ТРИ строки, и порядок фикстуры не совпадает с ответом: на двух
        # элементах «порядок задаёт сервер» проверялось бы вслепую.
        assert ids_of(get(reader())) == [fresh.pk, middle.pk, old.pk]

    def test_equal_time_is_broken_by_id(self):
        # Равное created_at здесь НЕ край: record_many ставит всей пачке один
        # момент. Без второго ключа страничная выдача теряла бы и дублировала
        # строки пачки между страницами.
        moment = timezone.now().replace(microsecond=0)
        with clock.override(moment):
            batch = audit_service.record_many(
                [
                    {
                        "actor": "7",
                        "action": audit_service.STATUS_CREATED,
                        "entity_type": audit_service.ENTITY_STATUS,
                        "entity_id": index,
                    }
                    for index in range(1, 4)
                ]
            )
        assert len({row.created_at for row in batch}) == 1

        expected = sorted((row.pk for row in batch), reverse=True)
        assert ids_of(get(reader())) == expected

    def test_pages_do_not_lose_or_repeat_rows(self):
        # Сквозная проба того же: пачка одного момента, разложенная по
        # страницам, обязана дать КАЖДУЮ строку РОВНО один раз.
        with clock.override(timezone.now().replace(microsecond=0)):
            batch = audit_service.record_many(
                [
                    {
                        "actor": "7",
                        "action": audit_service.STATUS_CREATED,
                        "entity_type": audit_service.ENTITY_STATUS,
                        "entity_id": index,
                    }
                    for index in range(1, 6)
                ]
            )
        api = reader()
        seen = []
        for offset in (0, 2, 4):
            seen += ids_of(get(api, limit=2, offset=offset))

        assert sorted(seen) == sorted(row.pk for row in batch)
        assert len(seen) == len(set(seen))


# ── Одна запись ──────────────────────────────────────────────────────────

class TestRetrieve:
    def test_returns_the_row_as_written(self):
        entry = write(
            action=audit_service.STATUS_CANCELLED,
            entity_id=77,
            old_value={"comment": "было"},
            new_value={"comment": "стало"},
            reason="приказ №5",
        )
        response = get(reader(), detail_url(entry.pk))

        assert response.status_code == 200
        assert response.data["id"] == entry.pk
        assert response.data["action"] == audit_service.STATUS_CANCELLED
        assert response.data["entity_type"] == audit_service.ENTITY_STATUS
        assert response.data["entity_id"] == 77
        assert response.data["actor_user_id"] == "7"
        # Снимки отдаются как есть — второе представление события разъехалось
        # бы с первым при первой же смене снимка.
        assert response.data["old_value"] == {"comment": "было"}
        assert response.data["new_value"] == {"comment": "стало"}
        assert response.data["reason"] == "приказ №5"

    def test_missing_row_is_404_envelope(self):
        response = get(reader(), detail_url(999999))
        assert response.status_code == 404
        assert response.data["error_code"] == "ENTITY_NOT_FOUND"

    def test_non_numeric_id_is_404_not_500(self):
        # pk роутера — произвольная строка; без коэрции до запроса мусор ушёл
        # бы ValueError → 500.
        response = get(reader(), f"{URL}abc/")
        assert response.status_code == 404
        assert response.data["error_code"] == "ENTITY_NOT_FOUND"

    def test_retrieve_needs_the_same_right(self):
        entry = write()
        api, _ = client_for("aud-detail-guy", "OPERATOR", ["status.view"])
        assert_denied_by_gate(get(api, detail_url(entry.pk)))


# ── Страничный конверт ───────────────────────────────────────────────────

def test_response_is_a_page_not_a_bare_array():
    write()
    response = get(reader())
    assert set(response.data) >= {"count", "next", "previous", "results"}
    assert isinstance(response.data["results"], list)


def test_schema_describes_a_page_and_only_get():
    """Схема обещает ровно то, что сервер отдаёт.

    Страничную обёртку у plain ViewSet выводит объявленный на классе
    pagination_class — единственный её владелец; без него ответ был бы описан
    голым массивом, которого клиент никогда не получит. Что владелец удержан,
    держит test_pagination_params.test_schema_owns_limit_offset_on_every_list.

    Проверяется по собранной схеме, а не по коду обёртки: разъехаться могут
    именно они.
    """
    from drf_spectacular.generators import SchemaGenerator

    schema = SchemaGenerator().get_schema(request=None, public=True)
    list_path = schema["paths"]["/api/operations/audit-logs/"]
    detail_path = schema["paths"]["/api/operations/audit-logs/{id}/"]

    # Ни одного пишущего глагола в контракте — как и в маршрутах.
    assert list(list_path) == ["get"]
    assert list(detail_path) == ["get"]

    body = list_path["get"]["responses"]["200"]["content"]["application/json"]
    assert body["schema"] == {"$ref": "#/components/schemas/PaginatedOpsAuditLogList"}
    page = schema["components"]["schemas"]["PaginatedOpsAuditLogList"]
    assert page["type"] == "object"
    assert set(page["properties"]) == {"count", "next", "previous", "results"}
    assert page["properties"]["results"]["type"] == "array"

    # id пути — целое: у ViewSet нет queryset, и без явного типа тут была бы
    # "string" (и четвёртое предупреждение spectacular к базовым трём).
    path_id = [
        parameter
        for parameter in detail_path["get"]["parameters"]
        if parameter["name"] == "id"
    ]
    assert path_id and path_id[0]["schema"]["type"] == "integer"


def test_journal_of_another_actor_is_visible():
    # Область ПЛОСКАЯ: держатель audit.view видит журнал целиком, включая
    # системные закрытия, у которых живого пользователя нет вовсе.
    write(actor="system:dismissal", action=audit_service.EMPLOYEE_DISMISSED,
          entity_type=audit_service.ENTITY_EMPLOYEE, entity_id=5)
    response = get(reader())
    assert response.data["count"] == 1
    assert response.data["results"][0]["actor_user_id"] == "system:dismissal"
    assert OpsAuditLog.objects.count() == 1
