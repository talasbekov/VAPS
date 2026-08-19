"""Дефолтный статус сотрудника: один вход для сигнала и для команды.

Инвариант: у КАЖДОГО РАБОТАЮЩЕГО сотрудника есть действующий статус. Уволенный
в него не входит намеренно — `close_statuses_on_dismissal` (signals.py) как раз
закрывает статусы при увольнении, и проставлять «в строю» тому, кто уволен,
значило бы воевать с соседним сигналом.

Зачем отдельный модуль. Раньше дефолтный статус заводился в двух местах и
по-разному: `_directorate_create` при заведении сотрудника (с автором) и ветка
в `_directorate_get`, которая ничего не заводила, а роняла ручку 500. Способов
стало два, инвариант не держался ни одним: сотрудники, заведённые импортом,
админкой или сидом, оставались без статуса вовсе.
"""
from datetime import timedelta

from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus


def employee_is_working(employee: Employee) -> bool:
    """Сотрудник числится работающим.

    Три признака увольнения живут в модели порознь и на практике
    расходятся — поэтому проверяются все три, а не самый заметный.
    """
    return (
        employee.is_active
        and employee.dismissal_date is None
        and employee.employment_status != Employee.EmploymentStatus.FIRED
    )


def default_status_start(employee: Employee):
    """С какого дня ставить «в строю».

    Дата приёма — правда о том, с какого дня человек в строю; `today` объявил
    бы «в строю с сегодня» тому, кто работает пятый год.

    Но если у сотрудника уже есть статусы, начинать с даты приёма нельзя:
    `EmployeeStatus.clean()` запрещает пересечение периодов, и создание упало
    бы. Тогда берётся день после последнего СОСТОЯВШЕГОСЯ конца.

    🔴 Две тонкости, на которых первая версия ошибалась (поймал смоук-обход):

    1. конец периода у статуса — это `actual_end_date`, если он есть, и только
       иначе `end_date`. Досрочно завершённый отпуск (`end_date` 20-е,
       `actual_end_date` 13-е) освобождает период с 14-го, а не с 21-го.
       Прежний код брал максимумы обоих полей ПОРОЗНЬ и складывал худшее из
       двух: получалась дата в БУДУЩЕМ, статус создавался `planned` вместо
       `active`, и команда рапортовала об успехе, не восстановив инвариант;

    2. `cancelled` статусы период не занимали вовсе — отменённое не случилось.
       Их конец на расчёт влиять не должен.
    """
    ends = [
        actual or end
        for actual, end in employee.statuses.exclude(
            state=EmployeeStatus.StatusState.CANCELLED
        ).values_list('actual_end_date', 'end_date')
        if (actual or end) is not None
    ]
    if not ends:
        return employee.hire_date
    return max(employee.hire_date, max(ends) + timedelta(days=1))


@transaction.atomic
def ensure_active_status(employee: Employee, created_by=None):
    """Завести «в строю», если действующего статуса нет.

    Идемпотентна: повторный вызов ничего не делает и ничего не пишет. Возвращает
    созданный статус или `None`, если он уже был (или сотрудник уволен).

    `select_for_update` на строке сотрудника: сигнал и команда могут работать
    одновременно, а без замка оба увидели бы «статуса нет» и создали по одному.
    Второй упал бы на запрете пересечения — то есть шумом в логе вместо тихой
    правильной работы.
    """
    locked = Employee.objects.select_for_update().filter(pk=employee.pk).first()
    if locked is None:
        return None
    if not employee_is_working(locked):
        return None
    if locked.statuses.filter(state=EmployeeStatus.StatusState.ACTIVE).exists():
        return None

    return EmployeeStatus.objects.create(
        employee=locked,
        status_type=EmployeeStatus.StatusType.IN_SERVICE,
        start_date=default_status_start(locked),
        state=EmployeeStatus.StatusState.ACTIVE,
        comment='Статус по умолчанию: сотрудник без действующего статуса',
        created_by=created_by,
    )


def employees_without_active_status():
    """Работающие сотрудники, у которых нет действующего статуса."""
    return (
        Employee.objects.filter(
            is_active=True,
            dismissal_date__isnull=True,
        )
        .exclude(employment_status=Employee.EmploymentStatus.FIRED)
        .exclude(statuses__state=EmployeeStatus.StatusState.ACTIVE)
        .distinct()
    )
