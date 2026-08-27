"""Ручка штатки: отбор и страницы — необязательные (Plane №227).

🔴 ГЛАВНОЕ ОБЕЩАНИЕ — СОВМЕСТИМОСТЬ. Эту ручку читают девять мест клиента, и
календарю статусов и массовой правке нужен ВЕСЬ состав подразделения. Поэтому
первая проба здесь не про страницы, а про то, что БЕЗ ПАРАМЕТРОВ ответ не
изменился: включённая по умолчанию пагинация молча отдала бы восьми экранам
первую страницу вместо состава, и на стенде в 440 человек это выглядело бы
как «часть людей пропала».

Остальное — про отбор: он обязан считаться в базе и обязан совпадать с тем, что
показывает экран. Отдельная проба держит статус: у сотрудника может быть
несколько действующих строк, и «есть статус такого типа» — ДРУГОЙ вопрос, чем
«текущий статус такой».
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

URL_NAME = "staffunit-directorate-management"


@pytest.fixture
def scene():
    root = Division.objects.create(
        name="Служба", code="pg-root", division_type=Division.DivisionType.ORGANIZATION
    )
    first = Division.objects.create(
        name="Первый отдел", code="pg-d1",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    second = Division.objects.create(
        name="Второй отдел", code="pg-d2",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    inspector = Position.objects.create(name="Инспектор", code="pg-insp", level=8)
    chief = Position.objects.create(name="Начальник отдела", code="pg-chief", level=5)

    people = []
    for index in range(1, 13):
        division = first if index <= 8 else second
        position = chief if index == 1 else inspector
        employee = Employee.objects.create(
            personnel_number=f"pg-{index:03d}",
            last_name=f"Фамилия{index:02d}",
            first_name="Имя",
            birth_date=date(1990, 1, 1),
            hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(division=division, position=position, index=index, employee=employee)
        people.append(employee)
    return {"first": first, "second": second, "people": people}


@pytest.fixture
def actor():
    return get_user_model().objects.create_superuser(username="paging-admin")


def ask(actor, query=""):
    client = APIClient()
    client.force_authenticate(user=actor)
    response = client.get(reverse(URL_NAME) + query)
    assert response.status_code == 200, response.data
    return response.data


def test_without_parameters_the_answer_is_the_old_one(actor, scene):
    payload = ask(actor)

    assert len(payload["staff_units"]) == 12
    assert payload["total_count"] == 12
    assert payload["matched_count"] == 12
    # Ключей страницы быть НЕ должно: их появление означало бы, что клиент,
    # который о страницах не просил, обязан о них знать.
    assert "page" not in payload and "has_next" not in payload


def test_a_page_returns_exactly_its_slice(actor, scene):
    first = ask(actor, "?page=1&page_size=5")
    second = ask(actor, "?page=2&page_size=5")
    last = ask(actor, "?page=3&page_size=5")

    assert [len(p["staff_units"]) for p in (first, second, last)] == [5, 5, 2]
    assert first["matched_count"] == 12 and first["total_count"] == 5
    assert first["has_next"] is True and last["has_next"] is False

    ids = [unit["id"] for page in (first, second, last) for unit in page["staff_units"]]
    assert len(set(ids)) == 12, "страницы пересекаются или теряют строки"


def test_the_page_size_has_a_ceiling(actor, scene):
    payload = ask(actor, "?page=1&page_size=100000")

    assert payload["page_size"] == 200, "просьбу «дай всё одной страницей» исполнять нельзя"


def test_search_looks_at_the_name_position_and_division(actor, scene):
    by_name = ask(actor, "?search=Фамилия03")
    by_position = ask(actor, "?search=Начальник")
    by_division = ask(actor, "?search=Второй отдел")

    assert by_name["matched_count"] == 1
    assert by_position["matched_count"] == 1
    assert by_division["matched_count"] == 4


def test_search_and_paging_agree_about_the_total(actor, scene):
    payload = ask(actor, "?search=Фамилия1&page=1&page_size=2")

    # «Фамилия10», «Фамилия11», «Фамилия12» — трое: единицы в номерах с нулём
    # («Фамилия01») подстроке «Фамилия1» не отвечают.
    assert payload["matched_count"] == 3
    assert payload["total_count"] == 2, "в ответе — страница"
    assert payload["has_next"] is True


def test_filter_by_division(actor, scene):
    payload = ask(actor, f"?division_id={scene['second'].id}")

    assert payload["matched_count"] == 4
    assert {unit["division"]["name"] for unit in payload["staff_units"]} == {"Второй отдел"}


def test_filter_by_current_status_not_by_any_active_one(actor, scene):
    """У сотрудника может быть несколько действующих строк — берётся ТЕКУЩАЯ.

    Отбор обязан совпадать с тем, что показывает экран: он печатает статус,
    выбранный `active_status` (самый поздний по `start_date`).
    """
    # 🔴 ДВА действующих статуса разом модель не даст: `clean()` запрещает
    # пересечение периодов. Такие строки в базе всё же бывают — их кладут
    # сиды, импорт и правки SQL мимо модели, и ровно поэтому `active_status`
    # в `statuses.selectors` вообще СОРТИРУЕТ, а не берёт первый попавшийся.
    # Здесь они заводятся `bulk_create` — тем же путём, каким появляются в
    # жизни.
    employee = scene["people"][0]
    today = date.today()
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(
            employee=employee, status_type="vacation",
            start_date=today - timedelta(days=10), end_date=today + timedelta(days=5),
            state=EmployeeStatus.StatusState.ACTIVE,
        ),
        EmployeeStatus(
            employee=employee, status_type="business_trip",
            start_date=today - timedelta(days=1), end_date=today + timedelta(days=9),
            state=EmployeeStatus.StatusState.ACTIVE,
        ),
    ])

    current = ask(actor, "?status=business_trip")
    older = ask(actor, "?status=vacation")
    without = ask(actor, "?status=none")

    assert current["matched_count"] == 1
    assert older["matched_count"] == 0, "отобрался не текущий статус, а любой действующий"
    assert without["matched_count"] == 11


def test_filter_by_position_level(actor, scene):
    """Руководство отбирается по уровню должности, а не по списку кодов.

    Полоске руководства нужен десяток строк; до №235 она получала весь состав
    подразделения — 2,7 МБ на пяти тысячах человек.
    """
    payload = ask(actor, "?position_level_max=5")

    assert payload["matched_count"] == 1, "уровень 5 — только начальник отдела"
    assert payload["staff_units"][0]["position"]["name"] == "Начальник отдела"

    wider = ask(actor, "?position_level_max=8")
    assert wider["matched_count"] == 12, "уровень 8 включает инспекторов"


def test_a_broken_level_is_a_loud_refusal(actor, scene):
    """Мусор в параметре — не «покажи всё».

    🔴 Молча отдать полный состав значило бы вернуть ровно ту нагрузку, от
    которой отбор и защищает, — и заметить это было бы нечем: ответ выглядит
    исправным.
    """
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.get(reverse(URL_NAME) + "?position_level_max=руководство")

    assert response.status_code == 400, response.data
    assert "position_level_max" in response.data


def test_filter_by_employee_ids(actor, scene):
    """Диалогу статусов нужна ОДНА строка, а не весь состав (Plane №234)."""
    wanted = [scene["people"][0].id, scene["people"][3].id]

    payload = ask(actor, "?employee_ids=" + ",".join(str(i) for i in wanted))

    assert payload["matched_count"] == 2
    assert {unit["employee"]["id"] for unit in payload["staff_units"]} == set(wanted)


def test_too_many_employee_ids_is_a_loud_refusal(actor, scene):
    """Список на тысячу — это снова выгрузка всего состава, только окольно."""
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.get(reverse(URL_NAME) + "?employee_ids=" + ",".join(str(i) for i in range(1, 500)))

    assert response.status_code == 400
    assert "employee_ids" in response.data


def test_broken_employee_ids_are_refused(actor, scene):
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.get(reverse(URL_NAME) + "?employee_ids=1,два,3")

    assert response.status_code == 400
    assert "employee_ids" in response.data


def test_summary_counts_the_whole_selection_not_the_page(actor, scene):
    """Сводка считается по ОТБОРУ и ДО страницы (Plane №231).

    🔴 Экран статусов печатает «нужно обновить / просрочено / запланировано»
    по всему подразделению. Посчитай их по странице в пятьдесят строк — числа
    станут про другое, а выглядеть будут так же.
    """
    today = date.today()
    people = scene["people"]
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(
            employee=people[0], status_type="vacation",
            start_date=today - timedelta(days=30), end_date=today - timedelta(days=2),
            state=EmployeeStatus.StatusState.ACTIVE,
        ),
        EmployeeStatus(
            employee=people[1], status_type="business_trip",
            start_date=today + timedelta(days=5), end_date=today + timedelta(days=9),
            state=EmployeeStatus.StatusState.ACTIVE,
        ),
    ])

    payload = ask(actor, "?with_summary=1&page=1&page_size=2")

    assert payload["total_count"] == 2, "в ответе — страница"
    assert payload["summary"] == {
        "employees": 12,
        "without_status": 10,
        "overdue": 1,
        "scheduled": 1,
    }


def test_summary_is_not_sent_unless_asked(actor, scene):
    """Три подзапроса платит только тот, кому сводка нужна."""
    assert "summary" not in ask(actor)
