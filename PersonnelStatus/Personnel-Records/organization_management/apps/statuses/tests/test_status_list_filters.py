"""GET /api/statuses/statuses/ — фильтры списка (Plane №289).

До этих проб ручка молча игнорировала любой параметр запроса: `?employee=1` и
`?employee=2` возвращали одно и то же — ВСЕ строки. Клиент, думавший что сузил
выборку, получал всё и не мог об этом узнать; ровно так проба №255 объявила
«занятыми» всех подряд.

Пробы стерегут две стороны одного правила:
* известный фильтр СУЖАЕТ выдачу (мутация «снять filterset_class» краснит
  `test_employee_filter_narrows_list`: без фильтра в выдаче два сотрудника);
* неизвестное ЗНАЧЕНИЕ известного фильтра отбивается 400, а не молча отдаёт
  всё. Это второй половина дефекта: «фильтр не применился» и «фильтр применился
  и ничего не нашёл» для клиента выглядят одинаково, если ручка не спорит.
"""
from datetime import date

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

URL = "/api/statuses/statuses/"

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


def make_employee(seq):
    return Employee.objects.create(
        first_name="Иван",
        last_name=f"Иванов-{seq}",
        personnel_number=f"S{seq:05d}",
        iin=f"{seq:012d}",
        hire_date=date(2020, 1, 1),
    )


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(User.objects.create_user("status-filter-reader"))
    return client


@pytest.fixture
def statuses():
    """Двое сотрудников с РАЗНЫМИ типами статусов.

    Разные типы не украшение: на одинаковых проба про `?status_type=` прошла бы
    и при неработающем фильтре — выдача совпала бы с полной.
    """
    first, second = make_employee(1), make_employee(2)
    EmployeeStatus.objects.create(
        employee=first,
        status_type=_ST.VACATION,
        state=_STATE.ACTIVE,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 10),
    )
    EmployeeStatus.objects.create(
        employee=second,
        status_type=_ST.SICK_LEAVE,
        state=_STATE.PLANNED,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 5),
    )
    return first, second


def rows(response):
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


def test_employee_filter_narrows_list(api, statuses):
    first, _second = statuses

    response = api.get(URL, {"employee": first.id})

    assert response.status_code == 200
    got = rows(response)
    assert len(got) == 1
    assert {row["employee"] for row in got} == {first.id}


def test_two_employees_get_different_answers(api, statuses):
    """Сердце дефекта: два разных фильтра давали ОДИН И ТОТ ЖЕ ответ."""
    first, second = statuses

    first_rows = rows(api.get(URL, {"employee": first.id}))
    second_rows = rows(api.get(URL, {"employee": second.id}))

    assert [row["id"] for row in first_rows] != [row["id"] for row in second_rows]


def test_status_type_filter_narrows_list(api, statuses):
    response = api.get(URL, {"status_type": _ST.SICK_LEAVE})

    assert response.status_code == 200
    got = rows(response)
    assert len(got) == 1
    assert got[0]["status_type"] == _ST.SICK_LEAVE


def test_state_filter_narrows_list(api, statuses):
    response = api.get(URL, {"state": _STATE.PLANNED})

    assert response.status_code == 200
    got = rows(response)
    assert [row["state"] for row in got] == [_STATE.PLANNED]


def test_unknown_employee_is_rejected(api, statuses):
    """Несуществующий сотрудник — 400, а не «все строки» и не «пустой список»."""
    response = api.get(URL, {"employee": 10 ** 6})

    assert response.status_code == 400


def test_unknown_status_type_is_rejected(api, statuses):
    response = api.get(URL, {"status_type": "no-such-type"})

    assert response.status_code == 400


def test_no_filter_returns_everything(api, statuses):
    """Фильтры не сузили выдачу тем, кто их не просил."""
    response = api.get(URL)

    assert response.status_code == 200
    assert len(rows(response)) == 2
