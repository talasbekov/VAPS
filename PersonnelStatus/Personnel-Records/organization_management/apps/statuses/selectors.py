"""«Текущий статус сотрудника» — одно место, где это слово имеет значение.

Определений было три, и они расходились:

* `staff_unit/views.py` — `state=ACTIVE`, порядок `-start_date, -created_at`,
  при отсутствии `None`;
* `staff_unit/serializers.py` — `state=ACTIVE`, порядок `-start_date`, а при
  отсутствии СИНТЕТИЧЕСКИЙ `{"status_type": "in_service"}` без дат — то есть
  выдумывал статус там, где его нет, и был вторым источником «статуса без
  периода» в таблицах;
* `statuses/application/services.py` — `state=ACTIVE` И период покрывает
  сегодня.

Третье отличалось не случайно: оно отвечает на ДРУГОЙ вопрос. Поэтому здесь их
двое, и оба названы вслух:

`active_status` — статус, ЗАПИСАННЫЙ как действующий. Им живут списки и
карточки. Статус с истёкшим `end_date` остаётся `ACTIVE` в базе, пока его не
закроет `complete_expired_statuses_task`, и это состояние надо ПОКАЗЫВАТЬ:
таблица подсвечивает такую строку как просроченную, и по ней кадровик видит,
что статус пора закрыть. Скрыть её значило бы спрятать работу.

`status_on_date` — статус, действующий НА ДАТУ. Им отвечают на вопрос «что с
человеком сегодня», и истёкший в ответ не попадает.

Смешивать их нельзя: список, построенный на `status_on_date`, объявил бы
шестерых сотрудников стенда «без статуса» — и `ensure_active_status` завёл бы
им «в строю» поверх незакрытого отпуска.
"""
from django.db.models import Q
from django.db.models.query import Prefetch

from organization_management.apps.statuses.models import EmployeeStatus

#: Порядок выбора среди действующих. `-created_at` вторым — устойчивый
#: доводчик: у двух статусов может совпасть `start_date` (через модель это
#: недостижимо, но данные попадают в базу и мимо неё — сидами, SQL-правками),
#: и без него «текущий» выбирался бы по усмотрению планировщика.
CURRENT_STATUS_ORDER = ('-start_date', '-created_at')

#: Имя атрибута, в который префетч кладёт действующие статусы сотрудника.
ACTIVE_STATUSES_ATTR = 'active_statuses'


def active_statuses_queryset():
    """Действующие статусы в каноническом порядке."""
    return EmployeeStatus.objects.filter(
        state=EmployeeStatus.StatusState.ACTIVE
    ).order_by(*CURRENT_STATUS_ORDER)


def active_status_prefetch(lookup='employee__statuses'):
    """`Prefetch` для списков: один запрос на всю выборку вместо запроса на
    каждого сотрудника.

    `to_attr` обязателен: без него достаточно случайного `.filter()` или
    `.order_by()` на `employee.statuses`, чтобы префетч молча выродился в N+1.
    Именно так и было в списке подразделения.
    """
    return Prefetch(
        lookup, queryset=active_statuses_queryset(), to_attr=ACTIVE_STATUSES_ATTR
    )


def active_status(employee):
    """Статус, ЗАПИСАННЫЙ как действующий. `None` — такого нет.

    Если сотрудник пришёл из выборки с `active_status_prefetch`, берётся
    префетч и запроса не будет.
    """
    if employee is None:
        return None
    prefetched = getattr(employee, ACTIVE_STATUSES_ATTR, None)
    if prefetched is not None:
        return next(iter(prefetched), None)
    return (
        employee.statuses.filter(state=EmployeeStatus.StatusState.ACTIVE)
        .order_by(*CURRENT_STATUS_ORDER)
        .first()
    )


def status_on_date(employee_id: int, on_date):
    """Статус, действующий НА ДАТУ. `None` — на эту дату статуса нет.

    Отличается от `active_status` намеренно: сюда не попадает статус, чей
    период уже прошёл, но который ещё не закрыт фоновой задачей.
    """
    return (
        EmployeeStatus.objects.filter(
            employee_id=employee_id,
            state=EmployeeStatus.StatusState.ACTIVE,
            start_date__lte=on_date,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .order_by(*CURRENT_STATUS_ORDER)
        .first()
    )
