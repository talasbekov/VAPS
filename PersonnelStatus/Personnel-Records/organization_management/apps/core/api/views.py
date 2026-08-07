"""Вьюхи core: чтение оргструктуры в контракте нового бэка.

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations: заводить
второй механизм прав ради нового префикса значило бы защищать одни и те же
сведения по-разному в зависимости от того, каким адресом их спросили.
"""
from rest_framework import viewsets

from organization_management.apps.core.api.serializers import (
    DivisionSerializer,
    EmployeeSerializer,
)
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)

# Оргструктура открывается тем же правом, что и в доноре.
_READ_ORGSTRUCTURE_PERMISSION = "orgstructure.view"
# Кадровые записи открываются своим правом: оргструктура — это форма, а
# карточка сотрудника — персональные данные, и уравнивать их нельзя.
_READ_PERSONNEL_PERMISSION = "personnel.view"


class DivisionViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/divisions/ — список подразделений в донорском контракте.

    Только чтение: срез переносит контракт для экранов раздела, а правка
    оргструктуры на старой стороне уже живёт в /api/divisions/ со своими
    проверками. Две пишущие поверхности над одной таблицей разошлись бы в
    инвариантах.
    """

    serializer_class = DivisionSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно: без него пагинация DRF предупреждает о
        # нестабильной выборке, а страницы могут повторять и терять строки.
        return Division.objects.all().order_by("tree_id", "lft", "id")


class EmployeeViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/employees/ — кадровые карточки в донорском контракте.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка кадровых
    записей живёт на старой стороне со своими проверками.
    """

    serializer_class = EmployeeSerializer
    permission_map = {
        "list": _READ_PERSONNEL_PERMISSION,
        "retrieve": _READ_PERSONNEL_PERMISSION,
    }

    def get_queryset(self):
        # select_related по званию и штатной единице: без него каждая строка
        # добавляла бы запросы за должностью и подразделением (N+1).
        return (
            Employee.objects.select_related(
                "rank", "staff_unit", "staff_unit__position"
            )
            .all()
            .order_by("last_name", "first_name", "id")
        )
