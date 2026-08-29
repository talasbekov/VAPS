"""
Фильтры списка статусов сотрудников (`/api/statuses/statuses/`).

Заведены по Plane №289: до них ручка молча игнорировала любой параметр
запроса. `?employee=1` и `?employee=2` возвращали ОДНО И ТО ЖЕ — все строки
стенда, и клиент, думавший что сузил выборку, получал всё. Молчание опаснее
отказа: неверные данные читались как верные (так проба №255 объявила
«занятыми» всех подряд).

Значения фильтров валидируются: несуществующий сотрудник или неизвестный тип
статуса дают 400, а не «пустой список» и не «все строки».
"""

import django_filters

from organization_management.apps.statuses.models import EmployeeStatus


class EmployeeStatusFilter(django_filters.FilterSet):
    """Фильтр списка статусов: сотрудник, тип, состояние, окно дат."""

    # Окно дат по началу статуса: `?start_date_after=` / `?start_date_before=`.
    start_date = django_filters.DateFromToRangeFilter(
        field_name='start_date',
        label='Дата начала (диапазон)',
    )

    class Meta:
        model = EmployeeStatus
        fields = {
            'employee': ['exact'],
            'status_type': ['exact'],
            'state': ['exact'],
            'related_division': ['exact'],
            'end_date': ['gte', 'lte', 'isnull'],
        }
