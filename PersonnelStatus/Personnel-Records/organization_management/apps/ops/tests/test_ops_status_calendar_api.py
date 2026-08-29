"""Календарь статусов, вид «месяц» (/api/ops/status-calendar/month/).

Ручка Ш-1 задачи Plane №270: коды статусов по каждому сотруднику за каждый
день выбранного месяца. Проверяется то, за что отвечает именно она:

* раскладка полуинтервала `[date_start, date_end)` по дням — день окончания
  НЕ занят;
* победитель дня берётся общим правилом расхода (`resolve_status`), а не
  вторым определением;
* отменённая строка не существует;
* область видимости: чужое подразделение — 403, а не пустой ответ;
* мусор в параметрах — 400, а не 500;
* страница ограничена потолком: месяц × состав службы одним ответом не
  отдаётся.
"""
from datetime import date

import pytest
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    make_employee,
)

pytestmark = pytest.mark.django_db

MONTH = "/api/ops/status-calendar/month/"


@pytest.fixture
def division(db):
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def catalog(db):
    """Справочник: наряд, отпуск, участие в ОМ и выводимое «в строю».

    `IN_SERVICE` обязателен так же, как в расходе: календарю некуда положить
    дни без фактов, если выводимого типа в справочнике нет.
    """
    rows = [
        ("SICK_LEAVE", "На больничном", 10),
        ("VACATION", "В отпуске", 20),
        ("EVENT_ASSIGNMENT", "Привлечён на мероприятие (наряд)", 80),
        ("DUTY", "На дежурстве", 70),
        ("IN_SERVICE", "В строю", 999),
    ]
    for code, name, priority in rows:
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "priority": priority,
                "report_column_code": "X",
                "is_hard_block": False,
            },
        )


@pytest.fixture
def viewer(division, catalog):
    api, _ = client_for(
        "calendar-viewer", "CALENDAR_VIEWER", perms=("status.view",)
    )
    return api


def status(employee, code, start, end):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code=code,
        date_start=start,
        date_end=end,
    )


def days_of(response, employee):
    row = next(
        item
        for item in response.json()["results"]
        if item["id"] == str(employee.pk)
    )
    return dict(zip(response.json()["days"], row["days"]))


def test_month_lays_the_half_open_period_over_the_days(viewer, division):
    """`[date_start, date_end)`: день окончания свободен.

    Красная на мутации: считать период включающим `date_end` (`<=` вместо
    `<`) — 3 августа станет «в отпуске», хотя человек в этот день уже в строю.
    """
    employee = make_employee(division)
    status(employee, "VACATION", date(2026, 8, 1), date(2026, 8, 3))

    response = viewer.get(MONTH, {"month": "2026-08"})

    assert response.status_code == 200, response.json()
    by_day = days_of(response, employee)
    assert by_day["2026-08-01"] == "VACATION"
    assert by_day["2026-08-02"] == "VACATION"
    assert by_day["2026-08-03"] == "IN_SERVICE"
    # Дней ровно столько, сколько в месяце.
    assert len(response.json()["days"]) == 31


def test_month_resolves_overlap_by_catalog_priority(viewer, division):
    """Перекрытие решает приоритет справочника — общее правило расхода.

    Своё правило («последний записанный побеждает») разошлось бы с расходом
    того же дня, и два экрана называли бы один день по-разному.
    """
    employee = make_employee(division)
    status(employee, "DUTY", date(2026, 8, 5), date(2026, 8, 8))
    status(employee, "SICK_LEAVE", date(2026, 8, 6), date(2026, 8, 7))

    by_day = days_of(viewer.get(MONTH, {"month": "2026-08"}), employee)

    assert by_day["2026-08-05"] == "DUTY"
    # Приоритет 10 у больничного против 70 у наряда — побеждает больничный.
    assert by_day["2026-08-06"] == "SICK_LEAVE"
    assert by_day["2026-08-07"] == "DUTY"


def test_month_does_not_show_cancelled_rows(viewer, division):
    """Отменённая строка не существует — как и везде в разделе."""
    employee = make_employee(division)
    row = status(employee, "VACATION", date(2026, 8, 10), date(2026, 8, 12))
    row.cancelled_at = timezone.now()
    row.save(update_fields=["cancelled_at"])

    by_day = days_of(viewer.get(MONTH, {"month": "2026-08"}), employee)

    assert by_day["2026-08-10"] == "IN_SERVICE"


def test_month_carries_catalog_names_and_employee_identity(viewer, division):
    """Подписи типов приезжают из справочника, а не из таблицы в компоненте.

    Своя таблица подписей в виджете уже расходилась с палитрой; здесь она
    расходилась бы с самим справочником, который заказчик правит на экране
    справочников.
    """
    employee = make_employee(division)
    status(employee, "EVENT_ASSIGNMENT", date(2026, 8, 4), date(2026, 8, 5))

    body = viewer.get(MONTH, {"month": "2026-08"}).json()

    names = {row["code"]: row["name"] for row in body["catalog"]}
    assert names["EVENT_ASSIGNMENT"] == "Привлечён на мероприятие (наряд)"
    assert names["IN_SERVICE"] == "В строю"
    row = next(item for item in body["results"] if item["id"] == str(employee.pk))
    assert row["name"] == "Иванов Иван"
    assert row["division"] == {"id": str(division.pk), "name": division.name}


def test_month_closes_a_foreign_division(division, catalog):
    """Чужое подразделение — 403, а не пустой список.

    Пустой ответ неотличим от «там никого нет» и прячет отказ — тот же довод,
    что у расхода.
    """
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "calendar-scoped",
        "CALENDAR_SCOPED",
        perms=("status.view",),
        scope_division_id=other.pk,
    )

    response = api.get(MONTH, {"month": "2026-08", "division_id": division.pk})

    assert response.status_code == 403


def test_month_rejects_a_broken_month(viewer):
    """Мусор в `month` — 400 с внятным полем, а не 500."""
    for raw in ("2026-13", "август", "2026-08-04", ""):
        response = viewer.get(MONTH, {"month": raw})
        assert response.status_code == 400, raw

    assert viewer.get(MONTH).status_code == 400


def test_month_page_is_capped(viewer, division):
    """Размер страницы назначает сервер, а не спросивший.

    Месяц × состав службы одним ответом — это тот же путь, которым экран
    статусов набирал 2,7 МБ (Plane №236): страница обязана иметь потолок.
    """
    for _ in range(3):
        make_employee(division)

    body = viewer.get(MONTH, {"month": "2026-08", "page_size": "1000000"}).json()

    assert body["page_size"] == 100
    assert body["count"] == 3
    assert len(body["results"]) == 3
