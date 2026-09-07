"""Тот, кто заводит бюллетень, читает списки объектов и людей (Plane №946).

Заказчик: «При создании бюллетени не доступны выбор объектов и старшего ГВО».

🔴 ЧТО БЫЛО. Окно «Создать бюллетень» берёт объекты посещения из
`GET …/security-events/bindable-objects/`, а старшего наряда / ГВО — из
`GET /api/ops/personnel/?search=`. Обе ручки были закрыты правом
`event.manage`, а создатель бюллетеня по `[БЛН-10]` носит `event.create` и
`event.bulletin` — `event.manage` у него нет намеренно («без возможности
редактирования»). Проверено на прод-стенде под `acc_employee_d2`: обе ручки
отвечают 403, поле объекта говорит «Реестр объектов недоступен», комбобокс
старшего — «Кадровый список сейчас недоступен». Штаб (`HEAD_OPS_UNIT`)
получал то же: `event.manage` у него тоже нет.

ПРАВИЛО: списки для выбора открыты тому, кто может ЗАВЕСТИ мероприятие,
наравне с тем, кто его ведёт. Карта прав вьюсета принимает НЕСКОЛЬКО кодов
(любой из) — это первое такое место; каталог прав показывает каждый код
строкой-гейтом.

КРАСНАЯ ПРОБА: верни одиночный `event.manage` в `permission_map` любой из двух
ручек — покраснеет её проба «создатель читает». Читатель с одним `event.view`
по-прежнему отбивается — этим стережётся, что «любой из» не стал «любому».
"""
import pytest

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.access_catalog import catalog

from .test_ops_security_events_api import make_employee, make_object

pytestmark = pytest.mark.django_db

BINDABLE_URL = "/api/ops/security-events/bindable-objects/"
PERSONNEL_URL = "/api/ops/personnel/"


@pytest.fixture
def creator():
    """Персона `[БЛН-10]`: заводит бюллетень, вести мероприятие не может."""
    api, _ = client_for(
        "bulletin-creator", "BULLETIN_CREATOR",
        perms=("event.view", "event.create", "event.bulletin"),
    )
    return api


@pytest.fixture
def reader():
    api, _ = client_for("event-reader", "EVENT_READER", perms=("event.view",))
    return api


def test_the_creator_reads_the_objects_to_bind(creator):
    make_object(code="OBJ-946", name="Резиденция")
    response = creator.get(BINDABLE_URL)
    assert response.status_code == 200, response.content
    assert {row["code"] for row in response.json()["results"]} == {"OBJ-946"}


def test_the_creator_searches_people_for_the_chief_field(creator):
    make_employee(last_name="Старшинов")
    response = creator.get(PERSONNEL_URL, {"search": "Старшинов", "page": 1, "page_size": 8})
    assert response.status_code == 200, response.content
    # Имя — в форме кадрового снимка (`personnel_display_name`: фамилия и инициал).
    assert [row["name"] for row in response.json()["results"]] == ["Старшинов С."]


def test_a_plain_reader_still_gets_neither_list(reader):
    """«Любой из двух кодов» не значит «кому угодно с правом чтения»."""
    assert reader.get(BINDABLE_URL).status_code == 403
    assert reader.get(PERSONNEL_URL, {"page": 1, "page_size": 8}).status_code == 403


def test_the_catalog_lists_both_gates_of_a_shared_action():
    """Экран «Права» обязан показать ОБА кода на ручке: администратор раздаёт
    права по этому экрану, и ручка, закрытая двумя ключами, но показанная под
    одним, читалась бы как «второй ключ ничего не открывает» (тот же класс
    ошибки, что №602 и №901)."""
    rows = catalog()
    for code in ("event.manage", "event.create"):
        actions = {
            (row["view"], row["action"], row["kind"])
            for row in rows.get(code, [])
        }
        assert ("SecurityEventViewSet", "bindable_objects", "gate") in actions, code
        assert ("OpsPersonnelViewSet", "list", "gate") in actions, code
