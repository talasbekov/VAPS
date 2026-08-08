"""Вьюхи core: чтение оргструктуры в контракте нового бэка.

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations: заводить
второй механизм прав ради нового префикса значило бы защищать одни и те же
сведения по-разному в зависимости от того, каким адресом их спросили.
"""
from rest_framework import viewsets

from organization_management.apps.core.api.serializers import (
    DivisionSerializer,
    EmployeeSerializer,
    PositionSerializer,
    RankSerializer,
    StaffingSlotSerializer,
)
from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.staff_unit.models import StaffUnit

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


class PositionViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/positions/ — справочник должностей в донорском контракте.

    Право то же, что у оргструктуры: должность — это форма штата, а не
    персональные данные, и делить её со структурой подразделений логично.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка
    справочника живёт на старой стороне со своими проверками.
    """

    serializer_class = PositionSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно (тот же, что в Meta модели): без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return Position.objects.all().order_by("level", "name", "id")


class RankViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/ranks/ — справочник званий в донорском контракте.

    Право и режим те же, что у PositionViewSet: звание — справочник формы
    штата, правка живёт на старой стороне.
    """

    serializer_class = RankSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно (тот же, что в Meta модели): без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return Rank.objects.all().order_by("level", "name", "id")


class StaffingSlotViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/staffing-slots/ — штатные слоты в донорском контракте.

    Право то же, что у positions и ranks: штатный слот — это форма штата, а
    не персональные данные. Сотрудник, занимающий слот, в контракте донора не
    участвует вовсе (у него связь идёт отдельной сущностью назначения),
    поэтому кадровое право здесь не при чём.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка штатного
    расписания живёт на старой стороне (/api/staff_unit/) со своими
    проверками, и две пишущие поверхности над одной таблицей разошлись бы в
    инвариантах.
    """

    serializer_class = StaffingSlotSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # select_related по должности: без него каждая строка добавляла бы
        # запрос за кодом должности (N+1). Порядок фиксируем явно — без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return (
            StaffUnit.objects.select_related("position")
            .all()
            .order_by("division_id", "index", "id")
        )
