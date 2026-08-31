"""Список типов статусов приходит С СЕРВЕРА и знает то, что завели в админке
(Plane №354).

ЖАЛОБА ЗАКАЗЧИКА ДОСЛОВНО: «в админке добавил новый статус, там она не
появилась» — про окно планирования статуса.

ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ПОЧЕМУ ИМЕННО ТАК. Дефект был ДВОЙНОЙ, и проба,
стерегущая только список, оставила бы вторую половину. Мало показать
заведённый тип в выпадающем списке — его надо ещё уметь СОХРАНИТЬ: пока у поля
`EmployeeStatus.status_type` стояли `choices` из тринадцати значений, сервер
отбивал любой новый код, и «починенный» список предлагал бы выбор, ломающийся
при нажатии «Сохранить». Поэтому проб три: тип виден, тип сохраняется,
несуществующий тип отвергается словами администратора.
"""
from datetime import date

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

CATALOG_URL = "/api/statuses/types/"
STATUSES_URL = "/api/statuses/statuses/"


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(User.objects.create_user("status-catalog-reader"))
    return client


@pytest.fixture
def employee():
    return Employee.objects.create(
        first_name="Иван",
        last_name="Иванов-каталог",
        personnel_number="S90001",
        iin="900010000001",
        hire_date=date(2020, 1, 1),
    )


def add_type(code, name, **extra):
    """Тип, заведённый АДМИНИСТРАТОРОМ в справочнике: своего legacy-кода у него
    нет — в старом словаре из тринадцати значений его не было и быть не могло."""
    return StatusType.objects.create(
        code=code,
        name=name,
        priority=extra.pop("priority", 50),
        report_column_code=extra.pop("report_column_code", "ABSENT"),
        **extra,
    )


def test_the_type_added_in_the_admin_shows_up_in_the_catalog(api):
    """Ровно жалоба заказчика: завёл в админке — обязан увидеть.

    Мутация «вернуть список из кода» краснит здесь: зашитый каталог о
    `SPECIAL_TASK` не знает и знать не может.
    """
    add_type("SPECIAL_TASK", "Особое задание")

    response = api.get(CATALOG_URL, {"selectable": "1"})

    assert response.status_code == 200, response.content
    assert "SPECIAL_TASK" in {row["code"] for row in response.json()}


def test_the_new_type_can_actually_be_saved(api, employee):
    """Вторая половина дефекта: тип не только виден, но и СОХРАНЯЕТСЯ.

    Пока у поля стояли `choices`, здесь был бы 400 — и починенный список
    предлагал бы выбор, ломающийся при нажатии «Сохранить».
    """
    add_type("SPECIAL_TASK", "Особое задание")

    response = api.post(
        STATUSES_URL,
        {
            "employee": employee.id,
            "status_type": "SPECIAL_TASK",
            "start_date": "2026-09-01",
            "end_date": "2026-09-05",
        },
        format="json",
    )

    assert response.status_code == 201, response.content
    saved = EmployeeStatus.objects.get(employee=employee)
    assert saved.status_type == "SPECIAL_TASK"


def test_an_unknown_type_is_refused_with_words_the_administrator_can_act_on(
    api, employee
):
    """Снятие `choices` не должно превращать поле в свалку.

    Отказ называет ПРИЧИНУ и место, где чинить: «нет в справочнике или
    выключен». «Invalid choice» отправило бы администратора искать список в
    коде, которого больше нет.
    """
    response = api.post(
        STATUSES_URL,
        {
            "employee": employee.id,
            "status_type": "НЕТ_ТАКОГО",
            "start_date": "2026-09-01",
            "end_date": "2026-09-05",
        },
        format="json",
    )

    assert response.status_code == 400, response.content
    assert "справочник" in str(response.json()).lower()


def test_a_switched_off_type_leaves_the_catalog(api):
    """Деактивация в админке убирает тип из выбора — иначе выключатель
    справочника ничего не выключает."""
    add_type("SPECIAL_TASK", "Особое задание", is_active=False)

    response = api.get(CATALOG_URL, {"selectable": "1"})

    assert "SPECIAL_TASK" not in {row["code"] for row in response.json()}


def test_secondment_is_not_offered_for_manual_choice(api):
    """Прикомандирование заводится своим процессом (заявка и согласование).

    В общем каталоге оно есть, в выбираемом — нет: две двери в один факт
    разошлись бы данными.

    Строки заводятся ЗДЕСЬ, а не берутся из сида: тестовая база пуста, и проба,
    опирающаяся на посев, проверяла бы наличие сида, а не правило отбора.
    """
    add_type("SECONDED_FROM", "Прикомандирован", legacy_code="seconded_from")
    add_type("SECONDED_TO", "Откомандирован", legacy_code="seconded_to")

    all_codes = {row["code"] for row in api.get(CATALOG_URL).json()}
    selectable = {row["code"] for row in api.get(CATALOG_URL, {"selectable": "1"}).json()}

    assert {"seconded_from", "seconded_to"} <= all_codes
    assert not ({"seconded_from", "seconded_to"} & selectable)
