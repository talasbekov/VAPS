"""Каталог функций права (задача заказчика Plane №36, шаг «П-1»).

Каталог НЕ хранится, а собирается из карт `permission_map`. Пробы стерегут
именно это: правка гейта немедленно видна в каталоге, а не через миграцию.
"""
import pytest

from organization_management.apps.ops.access_catalog import catalog

# `client_for` — обычная функция, не фикстура: импортируется и зовётся.
from organization_management.apps.operations.tests.test_rbac_admin_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/access-catalog/"


def test_catalog_names_real_routes_of_a_permission():
    """У права из карты гейта есть его настоящие ручки — с методом и путём."""
    rows = catalog()["event.manage"]

    paths = {(row["method"], row["path"]) for row in rows}

    assert ("POST", "/api/ops/security-events/") in paths
    # Завершение этапа осталось у ведущего мероприятие: это переход цепочки,
    # а не расстановка людей (Plane №74).
    assert ("POST", "/api/ops/security-events/<pk>/placement/complete/") in paths


def test_catalog_follows_the_gate_when_a_route_changes_its_permission():
    """Каталог идёт ЗА картой гейта, а не за памятью о ней.

    Назначение на пост переехало с `event.manage` на `placement.manage`
    (Plane №74): расстановку заказчик закрепил за старшим объекта. Пин
    перенацелен осознанно и стережёт обе стороны переезда — ручка появилась
    у нового права И пропала у старого. Проверять только появление значило бы
    не заметить, если бы она осталась и там, и там.
    """
    assign = ("POST", "/api/ops/security-events/<pk>/placement/assign/")

    moved_to = {(row["method"], row["path"]) for row in catalog()["placement.manage"]}
    stayed_at = {(row["method"], row["path"]) for row in catalog()["event.manage"]}

    assert assign in moved_to
    assert assign not in stayed_at


def test_catalog_paths_are_addresses_not_patterns():
    """Регексы и якори не протекают наружу: администратору нужен адрес.

    Проверяется ВЕСЬ каталог, а не одно право: очистка пути общая, и привязка
    к `event.manage` делала пробу заложницей того, какое право какую ручку
    сторожит (после Plane №74 половина ручек переехала к своим кодам).
    """
    rows = [row for permission_rows in catalog().values() for row in permission_rows]
    paths = {(row["method"], row["path"]) for row in rows}

    assert all("(?P<" not in row["path"] for row in rows)
    assert all(not row["path"].endswith("$") for row in rows)
    # Маршрут С ПРОВЕРОЧНОЙ ГРУППОЙ в паттерне (`(?!assign/|complete/)`)
    # называется ЦЕЛИКОМ и правильно: ассерт «в пути нет скобок» этого не
    # стережёт — снятие очистки даёт путь без скобок, но склеенный из чужих
    # кусков.
    assert (
        "DELETE",
        "/api/ops/security-events/<pk>/placement/<assignment_id>/",
    ) in paths
    # Ни одного остатка регекса: проверочные группы и классы символов
    # обрывали жадный разбор и протекали хвостом `<assignment_id>[/]+)/`.
    assert all(
        not any(junk in row["path"] for junk in ("(", ")", "[", "]", "?", "+"))
        for row in rows
    )


def test_catalog_does_not_repeat_a_route_under_head():
    """HEAD — тот же вход, что и GET, и второй строкой в каталоге не стоит.

    Поймано на живом стенде экраном «Права»: у права администрирования
    доступа стояли ДВЕ функции с одним адресом, GET и HEAD.

    Отчего проба выглядит странно. DRF дописывает `actions['head']` не при
    регистрации маршрута, а при ПЕРВОМ обращении к нему (`ViewSetMixin.as_view`
    мутирует словарь внутри `view()`), и в свежем процессе двойника ещё нет —
    проба без обращения зеленела бы и без фильтра, стерегя пустоту. Поэтому
    ручка сперва дёргается (ответ не важен, мутация происходит до проверки
    прав), и только потом собирается каталог.
    """
    from rest_framework.test import APIClient

    APIClient().get(URL)

    rows = catalog()["admin.roles"]
    methods = {row["method"] for row in rows}

    assert "HEAD" not in methods
    assert "OPTIONS" not in methods
    # Сторож: сама ручка из каталога не пропала вместе с двойником.
    assert ("GET", "/api/ops/access-catalog/") in {
        (row["method"], row["path"]) for row in rows
    }


def test_catalog_does_not_double_the_format_suffix_routes():
    """`.json`-двойники DRF в каталог не попадают."""
    rows = catalog()["event.manage"]

    assert all("format" not in row["path"] for row in rows)
    assert len(rows) == len({(row["method"], row["path"], row["action"]) for row in rows})


def test_catalog_search_looks_at_the_path_not_only_the_code():
    """Поиск идёт по пути и действию: спрашивают «где трогают расстановку»."""
    found = catalog("placement")

    assert found != {}
    assert all(
        "placement" in f"{row['path']} {row['action']}".lower()
        for rows in found.values()
        for row in rows
    )
    # Сторож: без фильтра функций СИЛЬНО больше — иначе проба не отличала бы
    # поиск от его отсутствия.
    assert sum(len(v) for v in found.values()) < sum(
        len(v) for v in catalog().values()
    )


def test_catalog_endpoint_is_closed_to_those_who_do_not_manage_access():
    """Карта гейтов не для всех: её читает тот, кто раздаёт доступ."""
    stranger, _ = client_for("catalog-stranger", "READER", perms=("event.view",))

    assert stranger.get(URL).status_code == 403


def test_catalog_endpoint_answers_the_admin():
    """Администратору доступа каталог приходит с именами прав из справочника."""
    from organization_management.apps.operations.models import Permission

    admin, _ = client_for("catalog-admin", "ACCESS_ADMIN", perms=("admin.roles",))
    Permission.objects.update_or_create(
        code="event.manage", defaults={"name": "Ведение мероприятий"}
    )

    data = admin.get(URL).json()

    row = next(item for item in data["results"] if item["code"] == "event.manage")
    assert row["name"] == "Ведение мероприятий"
    assert row["isKnown"] is True
    assert len(row["functions"]) > 0
    assert data["count"] == len(data["results"])


def test_permission_missing_from_the_dictionary_still_shows_up():
    """Право без строки справочника не прячется: гейт на нём стоит."""
    from organization_management.apps.operations.models import Permission

    admin, _ = client_for("catalog-admin-2", "ACCESS_ADMIN_2", perms=("admin.roles",))
    Permission.objects.filter(code="event.manage").delete()

    row = next(
        item
        for item in admin.get(URL).json()["results"]
        if item["code"] == "event.manage"
    )

    assert row["isKnown"] is False
    assert row["name"] == ""
    assert len(row["functions"]) > 0
