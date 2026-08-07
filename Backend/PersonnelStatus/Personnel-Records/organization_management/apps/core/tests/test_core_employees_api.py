"""Срез 154b: контракт /api/core/employees/ поверх старой кадровой модели.

Последний из двух запросов, которых экрану «Расход дня» не хватало (первый
закрыт срезом 153). Как и там, переносится КОНТРАКТ, а не модель.

Три группы полей ведут себя по-разному, и тесты разводят их намеренно:

  * ЛЕЖАТ ГОТОВЫМИ — iin, gender, personnel_number, даты, контакты, notes,
    employment_status: прямое чтение.
  * СОБИРАЮТСЯ — full_name из трёх частей; rank_code/rank_index из
    справочника звания; position_code и division ЧЕРЕЗ ШТАТНУЮ ЕДИНИЦУ, а не
    из самой Employee (в старой схеме должность и подразделение висят на
    StaffUnit).
  * ИСТОЧНИКА НЕТ — external_id, phone, height_cm, is_attached_force,
    data_source. Отдаются null по решению Bratan. Это честнее, чем подставить
    похожее поле: `phone` рядом с work_phone/personal_phone выглядел бы
    заполненным, но означал бы не то, и клиент не отличил бы «нет данных» от
    «данные есть, но другие».

Сотрудник без штатной единицы — не исключение, а норма (принят, ещё не
назначен), поэтому у него position_code и division тоже null.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL = "/api/core/employees/"

CONTRACT_FIELDS = {
    "id", "external_id", "iin", "full_name", "last_name", "first_name",
    "middle_name", "rank_code", "rank_index", "position_code", "division",
    "phone", "gender", "height_cm", "is_active", "is_attached_force",
    "data_source", "personnel_number", "birth_date", "photo_file_path",
    "hire_date", "dismissal_date", "work_phone", "work_email",
    "personal_phone", "personal_email", "notes", "employment_status",
}

# Поля, которым в старой схеме соответствия нет вовсе.
SOURCELESS_FIELDS = {
    "external_id", "phone", "height_cm", "is_attached_force", "data_source",
}


@pytest.fixture
def staffed():
    """Сотрудник НА штатной единице: должность и подразделение через неё."""
    division = Division.objects.create(
        name="Отдел охраны", code="DIV-1",
        division_type=Division.DivisionType.DIVISION,
    )
    position = Position.objects.create(name="Инспектор", code="POS-INSP", level=3)
    rank = Rank.objects.create(name="капитан", code="RANK-CPT", level=5)
    employee = Employee.objects.create(
        personnel_number="777001", last_name="Абенов", first_name="Санжар",
        middle_name="Ерланович", iin="123456789012", rank=rank,
    )
    StaffUnit.objects.create(
        division=division, position=position, employee=employee, index=1,
    )
    return {"employee": employee, "division": division, "rank": rank}


@pytest.fixture
def unstaffed():
    """Принят, но ещё не назначен — штатной единицы нет."""
    return Employee.objects.create(
        personnel_number="777002", last_name="Без", first_name="Слота",
    )


def reader(name="core-emp-reader"):
    return client_for(name, "VIEWER", ["personnel.view"])


def rows(response):
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


def by_number(response, number):
    return next(r for r in rows(response) if r["personnel_number"] == number)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(staffed):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(staffed):
    api, _ = client_for("core-emp-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(staffed):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(staffed):
    """Точное равенство: поле сверх контракта разошлось бы со схемой донора,
    из которой сгенерирован клиент SPA, и никто бы этого не заметил."""
    api, _ = reader()

    assert set(by_number(api.get(URL), "777001")) == CONTRACT_FIELDS


def test_full_name_is_assembled_from_three_parts(staffed):
    api, _ = reader()

    row = by_number(api.get(URL), "777001")
    assert row["full_name"] == "Абенов Санжар Ерланович"


def test_full_name_skips_a_missing_middle_name(unstaffed):
    """Без отчества имя не должно нести двойной пробел или хвост."""
    api, _ = reader()

    assert by_number(api.get(URL), "777002")["full_name"] == "Без Слота"


def test_rank_comes_from_the_reference_book(staffed):
    api, _ = reader()

    row = by_number(api.get(URL), "777001")
    assert row["rank_code"] == "RANK-CPT"
    assert row["rank_index"] == staffed["rank"].level


def test_position_and_division_come_through_the_staff_unit(staffed):
    """Ключевой кейс адаптера: в старой схеме их нет в самой Employee."""
    api, _ = reader()

    row = by_number(api.get(URL), "777001")
    assert row["position_code"] == "POS-INSP"
    assert row["division"] == staffed["division"].id


def test_employee_without_a_staff_unit_reports_nulls(unstaffed):
    api, _ = reader()

    row = by_number(api.get(URL), "777002")
    assert row["position_code"] is None
    assert row["division"] is None
    assert row["rank_code"] is None
    assert row["rank_index"] is None


@pytest.mark.parametrize("field", sorted(SOURCELESS_FIELDS))
def test_fields_without_a_source_are_null(staffed, field):
    """Null, а не похожее поле.

    Кейс закреплён именно на сотруднике С данными: на пустой записи null
    вернулся бы и так, и подмена `phone` на work_phone прошла бы незаметно.
    """
    api, _ = reader()

    assert by_number(api.get(URL), "777001")[field] is None


def test_phone_is_null_even_when_work_phone_is_filled(staffed):
    """Красный флаг на самую заманчивую подмену."""
    employee = staffed["employee"]
    employee.work_phone = "+7 700 000-00-00"
    employee.save(update_fields=["work_phone"])
    api, _ = reader()

    row = by_number(api.get(URL), "777001")
    assert row["work_phone"] == "+7 700 000-00-00"
    assert row["phone"] is None


# ── Стоимость выборки ────────────────────────────────────────────────────


def _seed_employees(count, offset=0):
    division = Division.objects.create(
        name=f"Отдел-{offset}", code=f"DIV-N{offset}",
        division_type=Division.DivisionType.DIVISION,
    )
    position = Position.objects.create(
        name="Инспектор", code=f"POS-N{offset}", level=3
    )
    rank = Rank.objects.create(name=f"сержант-{offset}", code=f"RANK-N{offset}", level=9)
    for i in range(count):
        employee = Employee.objects.create(
            personnel_number=f"78{offset}{i:02d}", last_name=f"Тест{offset}{i}",
            first_name="Имя", rank=rank,
        )
        StaffUnit.objects.create(
            division=division, position=position, employee=employee,
            index=i + 1,
        )


def _count_queries(api, django_capture_on_commit_callbacks=None):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    with CaptureQueriesContext(connection) as ctx:
        api.get(URL)
    return len(ctx)


def test_list_does_not_grow_queries_per_employee():
    """Гвард против N+1.

    Считаем не «сколько запросов», а «растёт ли их число с количеством
    сотрудников»: закреплённое магическое число ловило бы любую перестройку
    выборки, но пропустило бы главное — линейный рост. Звание, должность и
    подразделение лежат в связанных таблицах, и без select_related каждая
    строка добавила бы по запросу.
    """
    api, _ = reader()

    _seed_employees(3, offset=1)
    few = _count_queries(api)

    _seed_employees(12, offset=2)
    many = _count_queries(api)

    assert many == few, (
        f"число запросов выросло с {few} до {many} — выборка ходит "
        "за связанными таблицами построчно"
    )
