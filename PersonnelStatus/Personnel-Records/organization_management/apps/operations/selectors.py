"""Селекторы раздела ОМ (порт apps/operations/selectors.py + часть
apps/core/selectors.py из Backend/VAPS).

DivisionTreeSelector работает по СТАРОЙ структуре (divisions.Division, int-pk,
MPTT): переезд «женит» новый RBAC со старым деревом. Адъяценси-обход оставлен
вместо mptt-запросов намеренно — children_map() переносится один-в-один и
переживёт будущую смену модели дерева.
"""
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import StatusType, UserRole
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.staff_unit.models import StaffUnit


class OpsUserRoleSelector:
    """Read-only доступ к назначениям ролей."""

    @staticmethod
    def active_for_user(user_id):
        return list(
            UserRole.objects.filter(user_id=user_id, is_active=True).select_related(
                "role_code"
            )
        )


class DivisionTreeSelector:
    """Read-only доступ к дереву подразделений (единая точка для RBAC)."""

    @staticmethod
    def children_map() -> dict:
        """{parent_id: [child_id, ...]} на всё дерево, ОДИН запрос.

        parent_id верхних узлов — None. Полный скан Division: звать один раз
        и переиспользовать, не в цикле по узлам.
        """
        children: dict = {}
        for did, parent_id in Division.objects.values_list("id", "parent_id"):
            children.setdefault(parent_id, []).append(did)
        return children

    @staticmethod
    def names_map(division_ids=None) -> dict:
        """{id: name} для подписи строк отчёта, ОДИН запрос."""
        queryset = Division.objects.all()
        if division_ids is not None:
            queryset = queryset.filter(id__in=list(division_ids))
        return dict(queryset.values_list("id", "name"))

    @staticmethod
    def all_ids() -> set:
        """Все подразделения дерева, ОДИН запрос.

        Нужен там, где безскоуповый (глобальный) грант надо развернуть в
        конкретное множество: сервисы раздела ждут множество id, а None
        уронил бы их TypeError'ом.
        """
        return set(Division.objects.values_list("id", flat=True))

    @classmethod
    def subtree_ids(cls, division_id, *, children_map=None) -> set:
        # children_map позволяет решающему НЕСКОЛЬКО поддеревьев вызову
        # переиспользовать один скан вместо повторного на каждый вызов.
        children = cls.children_map() if children_map is None else children_map
        result, stack = set(), [division_id]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(children.get(current, []))
        return result


class StatusTypeSelector:
    """Read-only доступ к справочнику типов статусов."""

    @staticmethod
    def catalog_rows():
        """Проекция каталога для расхода, ОДИН запрос.

        Деактивированные типы включены намеренно: строка статуса, написанная
        до деактивации типа, обязана остаться разрешимой — иначе расход за
        прошлую дату упал бы на «неизвестном коде».
        """
        return list(
            StatusType.objects.values(
                "code", "priority", "report_column_code", "counts_in_staff"
            )
        )


class EmployeeStatusSelector:
    """Пакетное чтение статусов — единственный канал данных для агрегации."""

    @staticmethod
    def overlapping_on(on_date, employee_ids=None):
        """Живые интервальные факты, накрывающие дату, ОДИН запрос.

        period__contains едет по полному GiST-индексу, построенному ровно под
        такие выборки; отменённые строки для расхода не существуют
        (cancelled_at — это «записи нет»).
        """
        queryset = OpsEmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            queryset = queryset.filter(employee_id__in=employee_ids)
        return list(
            queryset.values(
                "employee_id", "status_type_code", "date_start", "date_end"
            )
        )


class StaffUnitSelector:
    """Знаменатель расхода — штатные слоты старой структуры."""

    @staticmethod
    def slots_with_working_occupants(division_ids=None):
        """([{division_id, employee_id|None}], {id уволенных в слотах}).

        Два запроса независимо от числа слотов: слоты и работающие среди их
        обитателей. Занятый уволенным слот возвращается как СВОБОДНЫЙ
        (employee_id=None) — уволенный не попадает ни в список, ни в колонки,
        а сам факт уезжает вторым значением, чтобы вызывающий сообщил о нём.
        Слот без подразделения пропускается: подразделение — ключ агрегации.
        """
        queryset = StaffUnit.objects.filter(division_id__isnull=False)
        if division_ids is not None:
            queryset = queryset.filter(division_id__in=list(division_ids))
        raw = list(queryset.values("division_id", "employee_id"))
        occupied = {row["employee_id"] for row in raw if row["employee_id"]}
        working = set(
            Employee.objects.filter(
                id__in=occupied,
                employment_status=Employee.EmploymentStatus.WORKING,
            ).values_list("id", flat=True)
        )
        dismissed = occupied - working
        slots = [
            {
                "division_id": row["division_id"],
                "employee_id": (
                    row["employee_id"] if row["employee_id"] in working else None
                ),
            }
            for row in raw
        ]
        return slots, dismissed
