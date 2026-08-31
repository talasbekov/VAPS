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
# ValidationError берётся у DRF, а не у Django: только его исключение
# превращается в ответ 400. Django-шное, поднятое из метода фильтра, уходит
# наружу пятисоткой — проверено падением, а не догадкой.
from rest_framework.exceptions import ValidationError

from organization_management.apps.statuses.models import EmployeeStatus


class EmployeeStatusFilter(django_filters.FilterSet):
    """Фильтр списка статусов: сотрудник, тип, состояние, окно дат."""

    # Окно дат по началу статуса: `?start_date_after=` / `?start_date_before=`.
    start_date = django_filters.DateFromToRangeFilter(
        field_name='start_date',
        label='Дата начала (диапазон)',
    )

    # 🔴 ТИП ПРОВЕРЯЕТСЯ ПО СПРАВОЧНИКУ, А НЕ ПО `choices` (Plane №354).
    # Валидация здесь держалась на том, что у поля модели был список
    # допустимого; сняв его, я молча вернул ручке прежнюю болезнь №289 —
    # `?status_type=no-such-type` снова отвечал 200 и полным списком вместо
    # 400. Поймано пробой test_unknown_status_type_is_rejected, а не глазами.
    status_type = django_filters.CharFilter(method='filter_status_type')

    def filter_status_type(self, queryset, name, value):
        from organization_management.apps.statuses import catalog

        known = catalog.known_codes() | {
            code for code, _label in EmployeeStatus.StatusType.choices
        }
        if value not in known:
            raise ValidationError(
                f"Типа статуса «{value}» нет в справочнике типов статусов."
            )
        return queryset.filter(status_type=value)

    class Meta:
        model = EmployeeStatus
        fields = {
            'employee': ['exact'],
            'state': ['exact'],
            'related_division': ['exact'],
            'end_date': ['gte', 'lte', 'isnull'],
        }
