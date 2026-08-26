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
    assert ("POST", "/api/ops/security-events/<pk>/placement/assign/") in paths
    # Регексы и якори не протекают наружу: администратору нужен адрес, а не
    # выражение, по которому маршрут матчится.
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
