"""Срез 155: контракт /api/core/positions/ поверх СТАРОГО справочника должностей.

Продолжение переезда: SPA раздела сгенерирована из схемы донора и берёт
справочник должностей по `/api/core/positions/`. В целевом бэке такого
префикса нет, а сама должность живёт как dictionaries.Position с другим
набором полей.

Переносится КОНТРАКТ, а не модель (см. срезы 153 и 154b): донорская Position
лежит в своей таблице core_positions с кодом-первичным ключом, и копировать
её значило бы поставить второй справочник рядом с живым.

РАСХОЖДЕНИЕ, КОТОРОЕ ЗАКРЕПЛЯЮТ ТЕСТЫ. Из пяти полей контракта старая модель
несёт три: `code` (заведён срезом 154a), `name` и `level`. Полей `sort_order`
и `is_active` в ней нет вовсе — они отдаются null. На каждое стоит отдельный
кейс, и оба сеются на строке С данными: на пустой записи null вернулся бы и
так, и подмена соседним полем (например, sort_order ← level) прошла бы
незаметно.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/core/positions/"

CONTRACT_FIELDS = {"code", "name", "level", "sort_order", "is_active"}


@pytest.fixture
def positions():
    """Три должности с РАЗНЫМИ уровнями.

    Уровни намеренно не нулевые и не совпадают между собой: на level=0
    подмена sort_order уровнем дала бы тот же 0, что и «пусто», и кейс о
    null-полях стал бы вакуумным.
    """
    return {
        "chief": Position.objects.create(name="Начальник отдела", code="P-CHIEF", level=2),
        "senior": Position.objects.create(name="Старший инспектор", code="P-SENIOR", level=5),
        "guard": Position.objects.create(name="Инспектор", code="P-GUARD", level=9),
    }


def reader(name="core-pos-reader"):
    return client_for(name, "VIEWER", ["orgstructure.view"])


def rows(response):
    body = response.json()
    # Пагинация DRF заворачивает список в конверт; контракт донора — тот же
    # постраничный конверт, поэтому строки достаём одинаково.
    return body["results"] if isinstance(body, dict) else body


def by_code(response, code):
    return next(r for r in rows(response) if r["code"] == code)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(positions):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(positions):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("core-pos-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(positions):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(positions):
    """Поля пиним точным равенством.

    Проверка «поля присутствуют» пропустила бы лишнее: клиент донора
    сгенерирован из схемы, и поле сверх контракта разошлось бы со схемой
    молча.
    """
    api, _ = reader()

    assert set(by_code(api.get(URL), "P-CHIEF")) == CONTRACT_FIELDS


def test_code_and_name_are_not_swapped(positions):
    """Ключ формы — именно `code`, а не человекочитаемое имя.

    Довод тот же, что у среза 154a: имя меняется при переименовании
    должности, и клиент, принявший его за ключ, разъехался бы молча.
    """
    api, _ = reader()
    row = by_code(api.get(URL), "P-SENIOR")

    assert row["code"] == "P-SENIOR"
    assert row["name"] == "Старший инспектор"


def test_level_is_read_from_the_old_field(positions):
    """`level` есть в контракте напрямую и совпадает по смыслу: «чем меньше
    число, тем выше должность» — та же семантика, что у донора."""
    api, _ = reader()
    response = api.get(URL)

    assert by_code(response, "P-CHIEF")["level"] == 2
    assert by_code(response, "P-SENIOR")["level"] == 5
    assert by_code(response, "P-GUARD")["level"] == 9


# ── Поля без источника ───────────────────────────────────────────────────


def test_sort_order_is_null_even_when_level_is_filled(positions):
    """`sort_order` источника не имеет — отдаём null, а НЕ level.

    Подставить level было бы хуже молчания: клиент не отличил бы «порядка
    нет» от «порядок задан», а совпадение с уровнем — случайность старой
    схемы. Кейс идёт на строке с непустым level: иначе подмена дала бы null
    и без ошибки.
    """
    api, _ = reader()
    row = by_code(api.get(URL), "P-SENIOR")

    assert row["level"] == 5
    assert row["sort_order"] is None


def test_is_active_is_null_for_every_row(positions):
    """`is_active` в старом справочнике должностей отсутствует.

    Вернуть True «по умолчанию» нельзя: строка выглядела бы подтверждённо
    действующей, хотя признака в базе нет вовсе.
    """
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["is_active"] is None for row in listed)


def test_seeded_positions_are_listed_too(positions):
    """Выборка не сужена до своей фикстуры: справочник сеет миграция 0002,
    и её строки клиенту тоже нужны."""
    api, _ = reader()

    listed = {r["code"] for r in rows(api.get(URL))}
    stored = set(Position.objects.values_list("code", flat=True))
    assert listed
    assert listed == stored


# ── Переход list → карточка (Plane №306) ─────────────────────────────────


def test_detail_opens_by_the_code_from_the_list(positions):
    """Ключ, которым клиент располагает из списка, обязан открывать карточку.

    Единственное, что строка списка даёт наружу, — `code` (числового pk в
    контракте донора нет вовсе). Пока detail искал по pk, объявленный схемой
    переход был недостижим: обращение по коду давало 404.
    """
    api, _ = reader()
    code = by_code(api.get(URL), "P-SENIOR")["code"]

    response = api.get(f"{URL}{code}/")

    assert response.status_code == 200
    assert response.json()["code"] == "P-SENIOR"


def test_detail_repeats_the_row_of_the_list(positions):
    """Карточка и строка списка — одна и та же запись в одном контракте.

    Сверяем целым словарём: разойдись эти два места набором полей или
    значением — клиент, открывший карточку, увидел бы не то, что в списке.
    """
    api, _ = reader()
    listed = by_code(api.get(URL), "P-CHIEF")

    assert api.get(f"{URL}P-CHIEF/").json() == listed


def test_detail_refuses_an_unknown_code(positions):
    """Несуществующий код — честный 404, а не пятисотка и не чужая строка."""
    api, _ = reader()

    assert api.get(f"{URL}P-NO-SUCH-CODE/").status_code == 404


def test_detail_is_closed_without_the_permission(positions):
    """Карточка закрыта тем же правом, что и список (fail-closed)."""
    api, _ = client_for("core-pos-detail-nobody")

    assert api.get(f"{URL}P-CHIEF/").status_code == 403
