"""Календарь статусов: месяц целиком, по дням (Plane №270, Ш-1).

Отдельный модуль, а не ещё одна ручка в `ops/api/views.py`: вид календаря
спрашивает у базы ровно один вопрос («какие факты задевают месяц») и
раскладывает ответ по дням ОБЩИМ правилом победителя — тем же
`resolve_status`, которым живёт расход. Своё второе правило значило бы, что
календарь и расход называют один день по-разному.

Источник — канонический `OpsEmployeeStatus`, а не кадровый
`statuses.EmployeeStatus`: эталон требует различать «на дежурстве»,
«задействован в ОМ» и «отсутствует», а коды участия в ОМ существуют только в
каноне (`EVENT_ASSIGNMENT`, `EVENT_ASSIGNMENT_GROUP`).
"""
from calendar import monthrange
from datetime import date, timedelta

from organization_management.apps.operations.selectors import (
    EmployeeStatusSelector,
    StatusTypeSelector,
)
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    resolve_status,
)

#: Потолок страницы. Месяц × состав службы одним ответом — тот же путь, каким
#: экран статусов набирал 2,7 МБ (Plane №236): размер страницы назначает
#: сервер, а не спросивший.
MAX_PAGE_SIZE = 100


def parse_month(raw):
    """`YYYY-MM` → первое число месяца. Мусор — `None` (вызывающий даёт 400).

    Полная дата (`2026-08-04`) тоже мусор: ручка отдаёт МЕСЯЦ, и приняв дату,
    она молча решила бы за спросившего, какой именно месяц он имел в виду.
    """
    text = (raw or "").strip()
    if len(text) != 7 or text[4] != "-":
        return None
    year, _, month = text.partition("-")
    if not (year.isdigit() and month.isdigit()):
        return None
    try:
        return date(int(year), int(month), 1)
    except ValueError:
        return None


def month_days(first_day):
    """Все дни месяца списком дат."""
    _, length = monthrange(first_day.year, first_day.month)
    return [first_day + timedelta(days=offset) for offset in range(length)]


def _full_name(employee):
    """ФИО целиком: календарь читают по именам, а не по инициалам.

    `personnel_display_name` («Иванов И.») здесь не годится — панель занятости
    (Ш-2) называет людей поимённо, и два разных написания одного человека на
    одном экране пришлось бы объяснять.
    """
    parts = [employee.last_name, employee.first_name, employee.middle_name]
    return " ".join(part for part in parts if part)


def _employees_page(scope_division_ids, page, page_size):
    """Страница состава области: сотрудники + их подразделение.

    `scope_division_ids is None` — безскоуповый актор, всё дерево; сужение
    делает вызывающий через общий резолвер области, а не эта функция.
    """
    from organization_management.apps.employees.models import Employee

    queryset = (
        Employee.objects.filter(is_active=True)
        .select_related("rank", "staff_unit__division")
        .order_by("last_name", "first_name", "id")
    )
    if scope_division_ids is not None:
        queryset = queryset.filter(
            staff_unit__division_id__in=list(scope_division_ids)
        )
    count = queryset.count()
    start = (page - 1) * page_size
    return count, list(queryset[start : start + page_size])


def month_page(*, first_day, scope_division_ids, page=1, page_size=MAX_PAGE_SIZE):
    """Месяц × страница состава: по каждому сотруднику код на каждый день.

    Запросов к базе — постоянное число (состав, счёт, факты, справочник), а не
    «по запросу на день»: факты берутся одним чтением на весь месяц
    (`overlapping_range`) и раскладываются в памяти.
    """
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    days = month_days(first_day)
    next_month = days[-1] + timedelta(days=1)

    count, employees = _employees_page(scope_division_ids, page, page_size)
    catalog_rows = StatusTypeSelector.catalog_rows()
    catalog = StatusCatalog.from_rows(catalog_rows)

    facts_by_employee = {}
    if employees:
        for row in EmployeeStatusSelector.overlapping_range(
            first_day, next_month, [employee.pk for employee in employees]
        ):
            facts_by_employee.setdefault(row["employee_id"], []).append(row)

    results = []
    for employee in employees:
        facts = facts_by_employee.get(employee.pk, [])
        # `staff_unit` — обратная OneToOne: у сотрудника без штатной единицы
        # обращение к ней бросает, а не отдаёт None. `getattr` с умолчанием
        # это ловит (RelatedObjectDoesNotExist наследует AttributeError).
        staff_unit = getattr(employee, "staff_unit", None)
        division = staff_unit.division if staff_unit is not None else None
        results.append(
            {
                "id": str(employee.pk),
                "name": _full_name(employee),
                "rank": employee.rank.name if employee.rank else "",
                "division": (
                    {"id": str(division.pk), "name": division.name}
                    if division is not None
                    else None
                ),
                "days": [
                    resolve_status(facts, day, catalog) for day in days
                ],
            }
        )

    return {
        "month": first_day.strftime("%Y-%m"),
        "days": [day.isoformat() for day in days],
        # Подписи типов — из справочника: своя таблица подписей в компоненте
        # разошлась бы с тем, что заказчик правит на экране справочников.
        "catalog": [
            {"code": row["code"], "name": row["name"]} for row in catalog_rows
        ],
        "count": count,
        "page": page,
        "page_size": page_size,
        "results": results,
    }
