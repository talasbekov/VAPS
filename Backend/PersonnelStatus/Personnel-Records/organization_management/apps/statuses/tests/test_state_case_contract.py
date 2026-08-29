"""Регистр состояния статуса в ДВУХ каталогах — закреплённое расхождение.

Plane №317. `/api/statuses/statuses/` (кадровый каталог) отдаёт состояние
СТРОЧНЫМИ (`active`), `/api/operations/statuses/` (каталог раздела ОМ) —
ПРОПИСНЫМИ (`ACTIVE`). Одно понятие, два вида.

ЗАЧЕМ ПРОБА, ЕСЛИ ЭТО НЕ ПОЧИНЕНО. Расхождение опасно тихой стороной:
сравнение, которое не совпадает НИКОГДА, читается как «таких строк нет» и
молча сужает выдачу до пустой — то же, чем были №289 и №315 (молчащий фильтр).
На клиенте ловушка уже закрыта типами: у `OpsEmployeeStatusRow.state` и
`EmployeeStatus.state` разные литеральные union'ы, и `tsc` валит сравнение с
чужим регистром («no overlap» — проверено мутацией 29.08.2026). А вот там, где
типы не достают — e2e на сыром `fetch`, любой внешний клиент, — ловушка живая:
на ней уже покраснела проба соседней сессии.

ЧТО СТЕРЕЖЁТ ЭТА ПРОБА. Не «правильный» регистр — правильного пока не выбрано,
это решение заказчика (карточка №317 называет три варианта). Она стережёт то,
что регистр не поедет МОЛЧА: приведёт кто-нибудь одну ручку к другой — проба
покраснеет и потребует осознанной правки вместе с читателями, а не оставит
тихо разъехавшийся контракт. Красная на мутации: заменить в сериализаторе
раздела `state` на строчный — падает `test_ops_catalog_reports_state_uppercase`.
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

PERSONNEL_URL = "/api/statuses/statuses/"
OPS_URL = "/api/operations/statuses/"


@pytest.fixture
def personnel_row():
    """Действующий статус кадрового каталога."""
    employee = Employee.objects.create(
        first_name="Айгерим",
        last_name="Регистрова",
        personnel_number="C00317",
        iin="000000000317",
        hire_date=date(2020, 1, 1),
    )
    # Даты — от НАСТОЯЩЕГО сегодня, а не от TODAY проб раздела: кадровая модель
    # пересчитывает состояние в `save()` по календарю, и строка с прошлыми
    # датами вернулась бы `completed` — проба проверяла бы не тот регистр, а
    # чужое состояние.
    today = date.today()
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=EmployeeStatus.StatusType.BUSINESS_TRIP,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=3),
        state=EmployeeStatus.StatusState.ACTIVE,
    )


@pytest.fixture
def ops_row(division, types):  # noqa: F811 — фикстуры pytest
    """Действующая строка каталога раздела ОМ — тот же смысл, другой каталог."""
    employee = make_employee(division)
    # Даты от настоящего сегодня по той же причине, что и у кадровой строки:
    # состояние обеих ручек считается по календарю, и строка «в прошлом» дала
    # бы COMPLETED в обоих каталогах — регистр бы совпал, а проба стала бы
    # вакуумной.
    today = date.today()
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="DUTY",
        date_start=today - timedelta(days=1),
        date_end=today + timedelta(days=3),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def test_personnel_catalog_reports_state_lowercase(personnel_row):
    api = APIClient()
    api.force_authenticate(User.objects.create_user("state-case-personnel"))

    row = api.get(f"{PERSONNEL_URL}?employee={personnel_row.employee_id}").json()["results"][0]

    assert row["state"] == "active"


def test_ops_catalog_reports_state_uppercase(ops_row):
    api, _ = client_for("state-case-ops", "ORGD", ["status.view"])

    body = api.get(f"{OPS_URL}?employee_id={ops_row.employee_id}").json()
    rows = body["results"] if isinstance(body, dict) else body

    assert rows[0]["state"] == "ACTIVE"


def test_two_catalogs_disagree_on_case_and_this_is_pinned(personnel_row, ops_row):
    """Само расхождение — предмет пробы, а не побочность двух проверок выше.

    Сведи их кто-нибудь в одном сравнении — получит «строк нет» вместо
    «состояния совпали». Пока расхождение живо, оно должно быть ВИДНО в
    прогоне, а не всплывать у того, кто первым сведёт два каталога на одном
    экране (этого требует №314).
    """
    personnel_api = APIClient()
    personnel_api.force_authenticate(User.objects.create_user("state-case-both"))
    ops_api, _ = client_for("state-case-both-ops", "ORGD", ["status.view"])

    personnel_state = personnel_api.get(
        f"{PERSONNEL_URL}?employee={personnel_row.employee_id}"
    ).json()["results"][0]["state"]
    ops_body = ops_api.get(f"{OPS_URL}?employee_id={ops_row.employee_id}").json()
    ops_state = (ops_body["results"] if isinstance(ops_body, dict) else ops_body)[0]["state"]

    assert personnel_state != ops_state
    assert personnel_state.upper() == ops_state, (
        "каталоги разошлись не только регистром — это уже не №317, "
        "а расхождение по существу: разберитесь, прежде чем чинить регистр"
    )
