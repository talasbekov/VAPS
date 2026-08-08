"""Срез 158: контракт /api/core/vacancies/ поверх старых штатных единиц.

ГЛАВНОЕ ПРО ЭТОТ АДРЕС: у донора он отдаёт НЕ записи «вакансия», а СВОБОДНЫЕ
ШТАТНЫЕ СЛОТЫ, и строка у него — ровно та же StaffingSlot, что на
/api/core/staffing-slots/ (VacancyViewSet.list зовёт compute_free_slots и
сериализует результат StaffingSlotSerializer). Правило донора —
BR-CORE-STAFF-002: «вакансия = слот без действующего назначения на дату».

Поэтому здесь НЕ участвует старая модель staff_unit.Vacancy: она описывает
объявление о наборе (требования, обязанности, статус), а не занятость слота.
Свободным считается слот без сотрудника — это прямой аналог «нет действующего
назначения». Слот, у которого сотрудника нет, но и объявления не заведено, у
донора вакансия, и сузить выборку по наличию объявления значило бы спрятать
незанятый штат.

Поля строки — те же восемь, что в срезе 157, и с теми же судьбами: три поля
без источника отдаются null. Кейсы на них здесь свои: выборка другая, и
сериализатор мог бы разойтись со срезом 157 незамеченным.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit, Vacancy

pytestmark = pytest.mark.django_db

URL = "/api/core/vacancies/"

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
def staff():
    """Четыре слота: два свободных, один занятый, один в чужом подразделении.

    Занятый слот — ДИСКРИМИНАТОР выборки: без него «список вакансий» совпал бы
    со списком всего штата, и правило отбора не проверялось бы вовсе.

    Один из свободных слотов идёт БЕЗ объявления staff_unit.Vacancy, второй —
    с объявлением: обе строки обязаны попасть в выборку. Если бы отбор шёл по
    наличию объявления, первый слот исчез бы, и незанятый штат оказался бы
    спрятан от клиента.
    """
    division = Division.objects.create(name="Управление кадров")
    other = Division.objects.create(name="Отдел режима", parent=division)
    chief = Position.objects.create(name="Начальник", code="P-CHIEF", level=1)
    inspector = Position.objects.create(name="Инспектор", code="P-INSP", level=5)

    posting = Vacancy.objects.create(
        requirements="Высшее образование", responsibilities="Приём граждан"
    )
    free_bare = StaffUnit.objects.create(
        division=division, position=chief, index=7
    )
    free_posted = StaffUnit.objects.create(
        division=division, position=inspector, index=12, vacancy=posting
    )
    occupied = StaffUnit.objects.create(
        division=division,
        position=inspector,
        index=13,
        employee=Employee.objects.create(
            last_name="Дроздов", first_name="Дмитрий"
        ),
    )
    elsewhere = StaffUnit.objects.create(
        division=other, position=None, index=21
    )
    return {
        "free_bare": free_bare,
        "free_posted": free_posted,
        "occupied": occupied,
        "elsewhere": elsewhere,
        "division": division,
        "other": other,
    }


def reader(name="core-vacancy-reader"):
    return client_for(name, "VIEWER", ["orgstructure.view"])


def rows(response):
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


def ids(response):
    return {row["id"] for row in rows(response)}


def by_id(response, pk):
    return next(r for r in rows(response) if r["id"] == pk)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(staff):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(staff):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("core-vacancy-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(staff):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Правило отбора ───────────────────────────────────────────────────────


def test_only_slots_without_an_employee_are_listed(staff):
    """Правило донора BR-CORE-STAFF-002 в старых терминах: свободен слот, у
    которого нет сотрудника.

    Занятый слот в фикстуре есть и заполнен настоящим сотрудником, поэтому
    кейс не может пройти на выборке «весь штат».
    """
    api, _ = reader()
    listed = ids(api.get(URL))

    assert staff["occupied"].id not in listed
    assert {staff["free_bare"].id, staff["free_posted"].id} <= listed


def test_a_free_slot_without_a_posting_is_still_a_vacancy(staff):
    """Отбор идёт по занятости, а НЕ по наличию staff_unit.Vacancy.

    Объявление — это описание набора (требования, обязанности), его может не
    быть у настоящей незанятой единицы. Сузь выборку по нему — и незанятый
    штат оказался бы спрятан.
    """
    api, _ = reader()

    assert staff["free_bare"].vacancy_id is None
    assert staff["free_posted"].vacancy_id is not None
    assert staff["free_bare"].id in ids(api.get(URL))


def test_an_occupied_slot_leaves_the_list_when_its_employee_goes(staff):
    """Выборка вычисляется, а не хранится: освободившийся слот появляется в
    вакансиях без всякой отдельной записи."""
    api, _ = reader()
    assert staff["occupied"].id not in ids(api.get(URL))

    StaffUnit.objects.filter(pk=staff["occupied"].pk).update(employee=None)

    assert staff["occupied"].id in ids(api.get(URL))


def test_division_id_narrows_the_list(staff):
    """Параметр донора: division_id. Проверяются ОБЕ стороны сужения — что
    своё осталось и что чужое ушло; без второй половины кейс прошёл бы и на
    фильтре, который не фильтрует."""
    api, _ = reader()

    narrowed = ids(api.get(URL, {"division_id": staff["division"].id}))
    assert staff["free_bare"].id in narrowed
    assert staff["elsewhere"].id not in narrowed


def test_without_division_id_the_whole_free_staff_is_listed(staff):
    """Без параметра выборка не сужена: слот чужого подразделения тоже
    свободен и обязан быть виден."""
    api, _ = reader()

    assert staff["elsewhere"].id in ids(api.get(URL))


# ── Контракт строки ──────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(staff):
    """Строка вакансии — это строка СЛОТА: у донора обе собирает один и тот
    же StaffingSlotSerializer. Поля пиним точным равенством: клиент донора
    сгенерирован из схемы, и лишнее поле разошлось бы с ней молча.
    """
    api, _ = reader()
    row = by_id(api.get(URL), staff["free_bare"].id)

    assert set(row) == CONTRACT_FIELDS
    assert "index" not in row
    assert "employee" not in row
    assert "vacancy" not in row
    assert "requirements" not in row
    assert "responsibilities" not in row


def test_row_matches_the_staffing_slot_row_field_for_field(staff):
    """Два адреса обязаны описывать один слот ОДИНАКОВО.

    Разойдись они — клиент, сверяющий вакансию со штатным расписанием,
    получил бы два разных описания одной строки и не смог бы их сопоставить.
    """
    api, _ = reader()
    as_vacancy = by_id(api.get(URL), staff["free_posted"].id)
    as_slot = by_id(
        api.get("/api/core/staffing-slots/"), staff["free_posted"].id
    )

    assert as_vacancy == as_slot


def test_position_code_is_the_dictionary_code_not_its_name(staff):
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, staff["free_bare"].id)["position_code"] == "P-CHIEF"
    assert by_id(response, staff["free_posted"].id)["position_code"] == "P-INSP"


def test_slot_number_carries_the_index(staff):
    """Номера разные, поэтому совпадение не может быть случайным."""
    api, _ = reader()
    response = api.get(URL)

    assert by_id(response, staff["free_bare"].id)["slot_number"] == "7"
    assert by_id(response, staff["free_posted"].id)["slot_number"] == "12"
    assert by_id(response, staff["elsewhere"].id)["slot_number"] == "21"


# ── Поля без источника ───────────────────────────────────────────────────


def test_is_active_is_null_even_on_a_filled_row(staff):
    """Признака действующего слота в старой модели нет вовсе.

    Соблазн подставить True здесь СИЛЬНЕЕ, чем на /staffing-slots/: строка
    попала в выборку, потому что свободна, и «раз вакансия — значит активна»
    выглядит правдоподобно. Это разные утверждения: свободен слот или введён
    он в штат — данных о втором нет.
    """
    api, _ = reader()
    row = by_id(api.get(URL), staff["free_bare"].id)

    assert row["position_code"] == "P-CHIEF"
    assert row["slot_number"] == "7"
    assert row["is_active"] is None


def test_valid_from_is_null_for_every_row(staff):
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["valid_from"] is None for row in listed)


def test_valid_to_is_null_for_every_row(staff):
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["valid_to"] is None for row in listed)


# ── Цена выборки ─────────────────────────────────────────────────────────


def test_query_count_does_not_grow_with_the_number_of_vacancies(staff):
    """Гвард N+1 на справочнике должностей — сравнением ДВУХ размеров
    выборки, а не пином на число запросов."""
    api, _ = reader()
    with CaptureQueriesContext(connection) as small:
        few = api.get(URL)

    extra_position = Position.objects.create(
        name="Дежурный", code="P-DUTY", level=9
    )
    for number in range(8):
        StaffUnit.objects.create(
            division=staff["division"],
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
