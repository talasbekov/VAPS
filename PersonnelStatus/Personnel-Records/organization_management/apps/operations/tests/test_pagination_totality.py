"""Страничная выдача ничего не теряет и не дублирует.

Список, упорядоченный по НЕуникальному полю, — тихая беда. На одной странице всё
выглядит правильно; ломается он только при листании: база не обязана сохранять
порядок строк с равным ключом между запросами, и одна и та же строка приезжает
дважды, а другая не приезжает вовсе. Пользователь при этом видит правдоподобный
список и не имеет причин ему не верить.

Два таких списка в разделе и нашлись — «роли пользователей» (порядок по user_id,
у одного человека ролей много) и «временные наряды» (порядок по -starts_at,
наряды заводят пачкой одним приказом, моменты совпадают). Оба теперь дополнены id
последним ключом.

ВОСПРОИЗВОДИТСЯ ИЗ ДВУХ ОДИН. Со снятым разрывом ничьей устойчиво краснеют только
наряды; роли на этом объёме Postgres отдаёт в физическом порядке, случайно
совпадающем с порядком id. Беда от этого не перестаёт быть настоящей — порядок
без полного ключа не обещан НИКАКОЙ базой, — но сила проб разная, и написано это
здесь, чтобы следующий читатель не считал обе доказанными.

ПРОВЕРКА ПОВЕДЕНЧЕСКАЯ: страницы вычитываются по одной и складываются. Статическая
(«у order_by последний ключ уникален») не отличила бы уникальную пару полей от
неуникальной и потребовала бы списка исключений, который сам стал бы предметом
доверия.
"""
import pytest

from organization_management.apps.operations.models import (
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    seed_role,
)

pytestmark = pytest.mark.django_db


def admin_client(name="pagination-admin"):
    return client_for(name, "ORGD", ["admin.roles"])


def walk_pages(api, url, *, limit=1, max_pages=50):
    """Все элементы, вычитанные ПО ОДНОМУ на страницу.

    Ровно по одному — чтобы каждая страница была отдельным запросом: при
    неустойчивом порядке ошибка проявляется именно на границе страниц.
    """
    collected = []
    offset = 0
    for _ in range(max_pages):
        response = api.get(url, {"limit": limit, "offset": offset})
        assert response.status_code == 200, response.content
        page = response.json()["results"]
        if not page:
            return collected, response.json()["count"]
        collected.extend(page)
        offset += limit
    raise AssertionError("страницы не кончились — похоже на зацикливание")


# ── Роли пользователей ───────────────────────────────────────────────────


@pytest.fixture
def tied_user_roles():
    """Много ролей ОДНОГО человека: ключ сортировки у всех одинаковый."""
    seed_role("ORGD", ["admin.roles"])
    for code in ("R1", "R2", "R3", "R4", "R5"):
        seed_role(code, [])
    for code in ("R1", "R2", "R3", "R4", "R5"):
        UserRole.objects.create(user_id="same-person", role_code_id=code)
    return UserRole.objects.filter(user_id="same-person")


def test_paging_user_roles_returns_every_row_exactly_once(tied_user_roles):
    """У всех строк РАВНЫЙ ключ сортировки.

    ЧЕСТНАЯ ОГОВОРКА о силе этой пробы: снятие разрыва ничьей здесь её НЕ
    краснит — на таком объёме Postgres возвращает строки в физическом порядке,
    который случайно совпадает с порядком id. Соседний список («временные
    наряды») на той же пробе краснеет устойчиво, и это доказывает, что беда
    настоящая, а не выдуманная.

    Тест оставлен: он стережёт не сегодняшний план запроса, а договор — порядок
    обязан быть полным независимо от того, что решит планировщик завтра, на
    другом объёме или после смены индекса.
    """
    api, _ = admin_client()

    collected, count = walk_pages(api, "/api/operations/user-roles/")

    ids = [row["id"] for row in collected]
    assert len(ids) == len(set(ids)), "строка приехала дважды"
    assert set(ids) >= set(tied_user_roles.values_list("id", flat=True))
    assert len(ids) == count


def test_paging_user_roles_agrees_with_a_single_page(tied_user_roles):
    """Постранично и одним куском — один и тот же набор.

    Без этого «ничего не потеряно» означало бы только «страницы не пересеклись».
    Оговорка о силе — та же, что у соседнего теста выше.
    """
    api, _ = admin_client()

    by_pages, _ = walk_pages(api, "/api/operations/user-roles/")
    whole = api.get("/api/operations/user-roles/", {"limit": 100}).json()["results"]

    assert [row["id"] for row in by_pages] == [row["id"] for row in whole]


# ── Временные наряды ─────────────────────────────────────────────────────


@pytest.fixture
def tied_duties():
    """Наряды, начинающиеся в ОДИН момент — их заводят пачкой одним приказом."""
    from datetime import datetime, timezone

    start = datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 8, 7, 9, 0, tzinfo=timezone.utc)
    for index in range(5):
        TemporaryDutyPermission.objects.create(
            user_id=f"duty-{index}",
            duty_role_code="RESPONSIBLE",
            starts_at=start,
            ends_at=end,
            created_by="seed",
        )
    return TemporaryDutyPermission.objects.all()


def test_paging_temporary_duty_returns_every_row_exactly_once(tied_duties):
    api, _ = admin_client()

    collected, count = walk_pages(api, "/api/operations/temporary-duty/")

    ids = [row["id"] for row in collected]
    assert len(ids) == len(set(ids)), "строка приехала дважды"
    assert set(ids) == set(tied_duties.values_list("id", flat=True))
    assert len(ids) == count


def test_paging_temporary_duty_agrees_with_a_single_page(tied_duties):
    api, _ = admin_client()

    by_pages, _ = walk_pages(api, "/api/operations/temporary-duty/")
    whole = api.get("/api/operations/temporary-duty/", {"limit": 100}).json()["results"]

    assert [row["id"] for row in by_pages] == [row["id"] for row in whole]


# ── Порядок устойчив между запросами ─────────────────────────────────────


def test_the_same_page_asked_twice_answers_the_same_way(tied_user_roles):
    """Неустойчивый порядок проявляется и так: один и тот же запрос дважды
    подряд возвращает разные строки."""
    api, _ = admin_client()

    first = api.get("/api/operations/user-roles/", {"limit": 2, "offset": 2}).json()
    second = api.get("/api/operations/user-roles/", {"limit": 2, "offset": 2}).json()

    assert [row["id"] for row in first["results"]] == [
        row["id"] for row in second["results"]
    ]
