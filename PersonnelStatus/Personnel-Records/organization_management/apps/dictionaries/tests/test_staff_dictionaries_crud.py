"""Кадровые справочники: чтение всем, правка по праву (Plane №274, Ш-1).

ЗАЧЕМ. Заказчик просил у модуля «Справочники» все три действия — «Добавлять,
удалять, редактировать» — и подтвердил, что кадровые справочники правятся под
ТЕМ ЖЕ правом, что и справочники раздела ОМ (`dictionary.manage`).

До этого ручки должностей и званий были закрыты наглухо: `http_method_names =
['get', 'head', 'options']` с подписью «Только GET для API».

🔴 Ключевая проба здесь — НЕ «правка работает», а «удаление используемого
запрещено». Должность — основание штатного расписания: на стенде 442 штатные
единицы ссылаются на должности, и удаление одной из них молча оборвало бы
расписание. Это тот же класс молчаливой потери, который чинился в №269.
"""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

POSITIONS = "/api/dictionaries/positions/"
RANKS = "/api/dictionaries/ranks/"


@pytest.fixture
def manager_api():
    api, _ = client_for(
        "dict-manager", "DICT_MANAGER",
        perms=("dictionary.view", "dictionary.manage"),
    )
    return api


@pytest.fixture
def viewer_api():
    api, _ = client_for("dict-viewer", "DICT_VIEWER", perms=("dictionary.view",))
    return api


def test_a_position_is_created_and_edited(manager_api):
    created = manager_api.post(
        POSITIONS,
        {"name": "Старший смены", "code": "SHIFT_SENIOR", "level": 6},
        format="json",
    )
    assert created.status_code == 201, created.json()

    pk = created.json()["id"]
    edited = manager_api.patch(
        f"{POSITIONS}{pk}/", {"name": "Старший смены (ночь)"}, format="json"
    )

    assert edited.status_code == 200, edited.json()
    assert Position.objects.get(pk=pk).name == "Старший смены (ночь)"


def test_an_unused_position_is_deleted(manager_api):
    created = manager_api.post(
        POSITIONS,
        {"name": "Временная", "code": "TEMP_ONE", "level": 9},
        format="json",
    ).json()

    resp = manager_api.delete(f"{POSITIONS}{created['id']}/")

    assert resp.status_code == 204, resp.content
    assert not Position.objects.filter(pk=created["id"]).exists()


def test_a_position_used_by_staffing_is_not_deleted(manager_api):
    """Отказ НАЗЫВАЕТ ЧИСЛО: «нельзя» без него читается как поломка."""
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.staff_unit.models import StaffUnit

    position = Position.objects.create(
        name="Занятая должность", code="BUSY_ONE", level=5
    )
    division = Division.objects.create(name="Отдел пробы", code="DIV-DICT-1")
    StaffUnit.objects.create(division=division, position=position, index=1)

    resp = manager_api.delete(f"{POSITIONS}{position.pk}/")

    assert resp.status_code == 400, resp.content
    assert "1" in str(resp.json()), resp.json()
    assert Position.objects.filter(pk=position.pk).exists(), (
        "должность, на которую ссылается штатка, всё-таки удалена"
    )


def test_a_viewer_reads_but_does_not_write(viewer_api):
    Position.objects.create(name="Только чтение", code="READ_ONLY", level=8)

    assert viewer_api.get(POSITIONS).status_code == 200
    created = viewer_api.post(
        POSITIONS, {"name": "Чужая", "code": "FOREIGN", "level": 8},
        format="json",
    )
    assert created.status_code == 403


def test_a_rank_is_created_and_protected_by_its_employees(manager_api):
    from organization_management.apps.employees.models import Employee

    created = manager_api.post(
        RANKS, {"name": "Пробное звание", "code": "PROBE_RANK", "level": 4},
        format="json",
    )
    assert created.status_code == 201, created.json()
    rank = Rank.objects.get(pk=created.json()["id"])

    Employee.objects.create(
        first_name="Иван", last_name="Иванов", personnel_number="P90001",
        iin="900010000001", rank=rank,
    )
    resp = manager_api.delete(f"{RANKS}{rank.pk}/")

    assert resp.status_code == 400, resp.content
    assert Rank.objects.filter(pk=rank.pk).exists()
