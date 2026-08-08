"""Срез 157: контракт /api/core/staffing-slots/ поверх старой штатной единицы.

SPA раздела сгенерирована из схемы донора и берёт штатные слоты по
`/api/core/staffing-slots/`. В целевом бэке такого адреса нет, а слот живёт как
staff_unit.StaffUnit с другим набором полей. Переносится КОНТРАКТ, а не модель
— по конвенции переезда (срезы 153, 154b, 155, 156).

ТРИ СУДЬБЫ У ВОСЬМИ ПОЛЕЙ, И ТЕСТЫ ЗАКРЕПЛЯЮТ ИМЕННО ИХ:
  * `id`, `division`, `parent_slot` читаются напрямую, `position_code` —
    через справочник должностей (у донора это FK с db_column position_code,
    наружу обе стороны отдают код строкой);
  * `slot_number` ← `index`. Источник не одноимённый, но это ПЕРЕВОД, а не
    подмена соседним полем: verbose_name у `index` — «Номер слота», то есть
    ровно то, что донор зовёт slot_number. Прецеденты той же формы —
    `type_code` ← `division_type` (срез 153) и `rank_index` ← `level`
    (срезы 154b/156);
  * `is_active`, `valid_from`, `valid_to` источника не имеют — отдаются null.
    Временных границ у StaffUnit нет вовсе, признака действующего слота тоже.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL = "/api/core/staffing-slots/"

CONTRACT_FIELDS = {
    "id",
    "division",
    "position_code",
    "slot_number",
    "parent_slot",
    "is_active",
    "valid_from",
    "valid_to",
}


@pytest.fixture
def slots():
    """Дерево из трёх слотов: корневой и двое подчинённых.

    Номера слотов РАЗНЫЕ и ненулевые намеренно: на index=0 потеря перевода
    (константа 0 или пустая строка) дала бы то же значение, что и «пусто», и
    ключевой кейс среза стал бы вакуумным. Должности тоже разные — иначе
    подмена position_code соседней строкой прошла бы незаметно.
    """
    division = Division.objects.create(name="Управление кадров")
    other = Division.objects.create(name="Отдел режима", parent=division)
    chief = Position.objects.create(name="Начальник", code="P-CHIEF", level=1)
    inspector = Position.objects.create(name="Инспектор", code="P-INSP", level=5)

    root = StaffUnit.objects.create(division=division, position=chief, index=7)
    child = StaffUnit.objects.create(
        division=division, position=inspector, index=12, parent=root
    )
    orphan = StaffUnit.objects.create(division=other, position=None, index=21)
    return {"root": root, "child": child, "orphan": orphan, "division": division}


def reader(name="core-slot-reader"):
    return client_for(name, "VIEWER", ["orgstructure.view"])


def rows(response):
    body = response.json()
    # Пагинация DRF заворачивает список в конверт; контракт донора — тот же
    # постраничный конверт, поэтому строки достаём одинаково.
    return body["results"] if isinstance(body, dict) else body


def by_id(response, pk):
    return next(r for r in rows(response) if r["id"] == pk)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(slots):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(slots):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("core-slot-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(slots):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(slots):
    """Поля пиним точным равенством.

    Проверка «поля присутствуют» пропустила бы лишнее: клиент донора
    сгенерирован из схемы, и поле сверх контракта разошлось бы со схемой
    молча. Здесь это особенно важно: `index`, `employee` и `vacancy` старой
    модели наружу выходить НЕ должны — первый уезжает под именем slot_number,
    двух других в контракте донора нет вовсе.
    """
    api, _ = reader()
    row = by_id(api.get(URL), slots["root"].id)

    assert set(row) == CONTRACT_FIELDS
    assert "index" not in row
    assert "employee" not in row
    assert "vacancy" not in row


def test_position_code_is_the_dictionary_code_not_its_name(slots):
    """Ключ должности — именно `code`: имя меняется при переименовании, и
    клиент, принявший его за ключ, разъехался бы молча (см. срез 154a)."""
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, slots["root"].id)["position_code"] == "P-CHIEF"
    assert by_id(response, slots["child"].id)["position_code"] == "P-INSP"


def test_position_code_is_null_when_the_slot_has_no_position(slots):
    """Должность на слоте необязательна (FK с null=True), и это норма данных
    на стенде, а не сбой: строка обязана отдать null, а не упасть."""
    api, _ = reader()

    assert by_id(api.get(URL), slots["orphan"].id)["position_code"] is None


def test_division_carries_the_owning_division_id(slots):
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, slots["root"].id)["division"] == slots["division"].id
    assert (
        by_id(response, slots["orphan"].id)["division"] != slots["division"].id
    )


def test_slot_number_carries_the_index(slots):
    """Ключевой перевод среза: slot_number — это `index` старой модели.

    Значения разные у всех трёх строк, поэтому совпадение не может быть
    случайным: перевод, взявший чужое поле или константу, дал бы одинаковые
    номера. Наружу уходит строка — в контракте донора slot_number строковый.
    """
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, slots["root"].id)["slot_number"] == "7"
    assert by_id(response, slots["child"].id)["slot_number"] == "12"
    assert by_id(response, slots["orphan"].id)["slot_number"] == "21"


def test_parent_slot_carries_the_tree_edge(slots):
    """Иерархия слотов у донора и в старой модели — одна и та же вещь.

    Проверяются ОБЕ стороны ребра: у корня null, у подчинённого — id корня.
    Без верхней половины кейс прошёл бы и на сериализаторе, который всегда
    отдаёт null.
    """
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, slots["root"].id)["parent_slot"] is None
    assert by_id(response, slots["child"].id)["parent_slot"] == slots["root"].id


# ── Поля без источника ───────────────────────────────────────────────────


def test_is_active_is_null_even_on_a_filled_row(slots):
    """Признака действующего слота в старой модели нет вовсе.

    Вернуть True «по умолчанию» нельзя: строка выглядела бы подтверждённо
    действующей, хотя данных об этом нет. Кейс идёт на заполненной строке: на
    пустой записи null вернулся бы и так, и подмена прошла бы незаметно.
    """
    api, _ = reader()
    row = by_id(api.get(URL), slots["root"].id)

    assert row["position_code"] == "P-CHIEF"
    assert row["slot_number"] == "7"
    assert row["is_active"] is None


def test_valid_from_is_null_for_every_row(slots):
    """Временных границ у StaffUnit нет: подставить created_at значило бы
    выдать дату заведения строки за дату ввода слота в штат."""
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["valid_from"] is None for row in listed)


def test_valid_to_is_null_for_every_row(slots):
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["valid_to"] is None for row in listed)


# ── Выборка и её цена ────────────────────────────────────────────────────


def test_every_stored_slot_is_listed(slots):
    """Выборка не сужена: клиенту нужен весь штат, включая слот без
    должности и слот без сотрудника."""
    api, _ = reader()

    listed = {r["id"] for r in rows(api.get(URL))}
    assert listed == set(StaffUnit.objects.values_list("id", flat=True))


def test_query_count_does_not_grow_with_the_number_of_slots(slots):
    """Гвард N+1 на справочнике должностей.

    Сравниваются ДВА размера выборки, а не магическое число запросов: строка
    ходит за кодом должности, и без select_related каждая добавленная строка
    добавляла бы запрос. Пин на константу ломался бы от любой посторонней
    правки (аутентификация, права), ничего не говоря о росте.
    """
    api, _ = reader()
    with CaptureQueriesContext(connection) as small:
        few = api.get(URL)

    extra_position = Position.objects.create(
        name="Дежурный", code="P-DUTY", level=9
    )
    for number in range(8):
        StaffUnit.objects.create(
            division=slots["division"],
            position=extra_position,
            index=100 + number,
        )

    with CaptureQueriesContext(connection) as big:
        many = api.get(URL)

    # Обе выборки лежат на одной странице (PAGE_SIZE=50) — иначе рост числа
    # строк не дошёл бы до сериализатора и сравнение стало бы вакуумным.
    assert len(rows(few)) == 3
    assert len(rows(many)) == 11
    assert len(big.captured_queries) == len(small.captured_queries)
