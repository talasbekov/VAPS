"""Срез 153: контракт /api/core/divisions/ поверх СТАРОГО дерева.

Зачем ручка вообще: SPA раздела (Smart Josparlau) написана под новый бэк
Backend/VAPS и зовёт `/api/core/divisions/`. В целевом бэке такого префикса
нет — есть своё `/api/divisions/divisions/` с другим набором полей. Пока
контракт не совпадает, экран «Расход дня» не женится: из четырёх его запросов
два уходят в `core`.

Переносится КОНТРАКТ, а не модель: `apps/core` донора несёт 17 миграций и
собственные Division/Employee/User, которые столкнулись бы с уже живыми
divisions.Division и стоковым auth.User. По конвенции переезда (см. шапку
apps/operations/selectors.py) новый контракт садится на старые модели через
адаптер.

Два поля контракта в старой модели не лежат готовыми, и тесты закрепляют
именно их перевод:
  * `type_code` ← `division_type` (у донора это FK на справочник, здесь
    CharField с choices — наружу оба отдают код строкой);
  * `organization` ← КОРЕНЬ дерева MPTT, потому что в старой структуре
    организация не отдельная сущность, а узел с division_type='organization'.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/core/divisions/"

CONTRACT_FIELDS = {
    "id",
    "organization",
    "parent",
    "type_code",
    "name",
    "code",
    "is_active",
}


@pytest.fixture
def tree():
    """Служба → Департамент → Управление → Отдел: та же форма, что на стенде."""
    org = Division.objects.create(
        name="Служба", code="ORG-1", division_type=Division.DivisionType.ORGANIZATION
    )
    dep = Division.objects.create(
        name="Департамент охраны",
        code="DEP-1",
        division_type=Division.DivisionType.DEPARTMENT,
        parent=org,
    )
    dir_ = Division.objects.create(
        name="Управление объектами",
        code="DIR-1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=dep,
    )
    div = Division.objects.create(
        name="Отдел охраны",
        code="DIV-1",
        division_type=Division.DivisionType.DIVISION,
        parent=dir_,
    )
    return {"org": org, "dep": dep, "dir": dir_, "div": div}


def reader(name="core-reader"):
    return client_for(name, "VIEWER", ["orgstructure.view"])


def rows(response):
    body = response.json()
    # Пагинация DRF заворачивает список в конверт; контракт донора — тот же
    # постраничный конверт, поэтому строки достаём одинаково.
    return body["results"] if isinstance(body, dict) else body


def by_code(response, code):
    return next(r for r in rows(response) if r["code"] == code)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(tree):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(tree):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("core-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(tree):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(tree):
    """Поля пиним точным равенством.

    Проверка «поля присутствуют» пропустила бы лишнее: клиент донора
    сгенерирован из схемы, и поле сверх контракта разошлось бы со схемой
    молча.
    """
    api, _ = reader()

    assert set(by_code(api.get(URL), "DIV-1")) == CONTRACT_FIELDS


def test_type_code_carries_the_division_type(tree):
    api, _ = reader()
    response = api.get(URL)

    assert by_code(response, "ORG-1")["type_code"] == "organization"
    assert by_code(response, "DEP-1")["type_code"] == "department"
    assert by_code(response, "DIR-1")["type_code"] == "directorate"
    assert by_code(response, "DIV-1")["type_code"] == "division"


def test_parent_points_at_the_direct_parent(tree):
    api, _ = reader()
    response = api.get(URL)

    assert by_code(response, "DIV-1")["parent"] == tree["dir"].id
    assert by_code(response, "ORG-1")["parent"] is None


def test_organization_is_the_root_not_the_parent(tree):
    """Ключевой кейс адаптера.

    У «Отдела» родитель — «Управление», а организация — «Служба» через два
    уровня. Тест берёт узел ГЛУБЖЕ второго уровня намеренно: на ребёнке
    корня organization и parent совпадают, и подмена одного другим прошла бы
    незамеченной.
    """
    api, _ = reader()
    response = api.get(URL)
    row = by_code(response, "DIV-1")

    assert row["organization"] == tree["org"].id
    assert row["organization"] != row["parent"]


def test_organization_of_the_root_is_itself(tree):
    api, _ = reader()

    assert by_code(api.get(URL), "ORG-1")["organization"] == tree["org"].id


def test_second_tree_does_not_borrow_the_first_root(tree):
    """Корень берётся у СВОЕГО дерева, а не «первый organization в базе»."""
    other = Division.objects.create(
        name="Управление (стенд)",
        code="ORG-2",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    child = Division.objects.create(
        name="Отдел стенда",
        code="DIV-2",
        division_type=Division.DivisionType.DIVISION,
        parent=other,
    )
    api, _ = reader()

    row = by_code(api.get(URL), "DIV-2")
    assert row["organization"] == other.id
    assert row["organization"] != tree["org"].id
    assert child.get_root() == other


# ── Отбор по типу узла (Plane №315) ─────────────────────────────────────────
#
# Параметр `?type_code=` ручка МОЛЧА ИГНОРИРОВАЛА: клиент, отобравший
# «департаменты», получал всё дерево и первой строкой — организацию. Ошибка
# всплывала через шаг: заявку такому «департаменту» сервер отбивал 400
# «Такого департамента нет в справочнике», и выглядело это как ошибка ввода
# пользователя. Найдено живой пробой №287.


def test_type_code_narrows_the_list(tree):
    api, _user = reader()
    response = api.get(URL, {"type_code": "department"})

    assert response.status_code == 200
    codes = {row["type_code"] for row in rows(response)}
    assert codes == {"department"}, f"в выдаче не только департаменты: {codes}"


def test_without_type_code_the_whole_tree_comes_back(tree):
    """Отбор не сузил выдачу тем, кто его не просил."""
    api, _user = reader()
    response = api.get(URL)

    assert response.status_code == 200
    assert len(rows(response)) == 4


def test_an_unknown_type_is_refused(tree):
    """Неизвестный тип — 400, а не пустой список.

    «Таких узлов нет» и «такого типа не бывает» для клиента выглядят
    одинаково, а означают разное: во втором случае у него опечатка в коде.
    """
    api, _user = reader()
    response = api.get(URL, {"type_code": "departament"})

    assert response.status_code == 400
    assert "type_code" in response.json()
