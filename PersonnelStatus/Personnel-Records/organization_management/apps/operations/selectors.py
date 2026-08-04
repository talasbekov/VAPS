"""Селекторы раздела ОМ (порт apps/operations/selectors.py + часть
apps/core/selectors.py из Backend/VAPS).

DivisionTreeSelector работает по СТАРОЙ структуре (divisions.Division, int-pk,
MPTT): переезд «женит» новый RBAC со старым деревом. Адъяценси-обход оставлен
вместо mptt-запросов намеренно — children_map() переносится один-в-один и
переживёт будущую смену модели дерева.
"""
from django.db.models import Count

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import StatusType, UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
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


class SecondmentSelector:
    """Пакетное чтение пар прикомандирования для агрегации."""

    @staticmethod
    def attached_counts_on(on_date, division_ids=None):
        """{to_division_id: N} прикомандированных на дату, ОДИН запрос.

        Считает ЖИВАЯ ЛИ НОГА ATTACHED на эту дату — не факты возврата: у
        подтверждённого возврата нога закрыта датой, и «до какого дня человек
        числится у принимающего» решает ровно её интервал. Читать вместо
        этого return_confirmed_at значило бы завести второе правило о том же
        и разойтись с ним на день возврата.

        Отменённая нога не существует для расхода — тот же предикат, которым
        её не видит выборка статусов.
        """
        queryset = Secondment.objects.filter(
            in_status__cancelled_at__isnull=True,
            in_status__period__contains=on_date,
        )
        if division_ids is not None:
            queryset = queryset.filter(to_division_id__in=list(division_ids))
        return dict(
            queryset.values("to_division_id")
            .annotate(count=Count("id"))
            .values_list("to_division_id", "count")
        )


class StaffUnitSelector:
    """Знаменатель расхода — штатные слоты старой структуры."""

    @staticmethod
    def divisions_of(employee_ids):
        """{employee_id: division_id} по штатным единицам, ОДИН запрос.

        Подразделение сотрудника в старой структуре живёт ТОЛЬКО в штатной
        единице (у Employee своего division_id нет), поэтому здесь общий
        источник области видимости и для пачки, и для одиночной правки:
        сотрудник без слота отсутствует в ответе и не попадает ни в чью
        область (fail-closed — решение принимает вызывающий).
        """
        return dict(
            StaffUnit.objects.filter(employee_id__in=list(employee_ids)).values_list(
                "employee_id", "division_id"
            )
        )

    @staticmethod
    def employee_ids_in(division_ids):
        """{employee_id} обитателей штатных единиц указанных подразделений,
        ОДИН запрос.

        Обратная сторона divisions_of: там спрашивают «в чьей области ЭТОТ
        сотрудник», здесь — «кто вообще попадает в область» для списочного
        чтения. Сотрудник без штатной единицы не принадлежит ничьей области и
        в ответ скоупованному оператору не попадает: тот же fail-closed выбор,
        что и у одиночной правки, где такая строка даёт 403.

        Свободные слоты (employee_id IS NULL) отсеиваются в запросе: None в
        множестве превратился бы в `employee_id IN (..., NULL)` — лишний
        элемент фильтра, ничего не значащий для выборки статусов.
        """
        return set(
            StaffUnit.objects.filter(
                division_id__in=list(division_ids), employee_id__isnull=False
            ).values_list("employee_id", flat=True)
        )

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


class OpsAuditLogSelector:
    """Чтение журнала раздела: фильтры и ПОЛНЫЙ порядок.

    Единственный канал чтения журнала — как audit_service единственный канал
    записи. Вьюха сюда не заглядывает мимо: разъехавшийся порядок сортировки
    у двух читателей означал бы, что «страница 2» у них про разные строки.

    ОБЛАСТЬ ВИДИМОСТИ ПЛОСКАЯ: держатель audit.view видит журнал целиком.
    Так же ведёт себя источник, и здесь это не недосмотр, а следствие
    раскладки прав — audit.view выдан ORGD и админу, а не операторам
    подразделений (см. seed_operations). Сузить журнал по подразделению
    нечем одинаково для всех строк: у события статуса подразделение выводится
    через сотрудника и штатную единицу, у события пары — через две стороны, а
    у события сотрудника его нет вовсе. Разные правила на разные типы событий
    дали бы читателю дырявую ленту, в которой пропажу не отличить от отказа.
    Если область когда-нибудь понадобится, начинать надо отсюда.
    """

    @staticmethod
    def list(
        *,
        entity_type=None,
        entity_id=None,
        actor_user_id=None,
        action=None,
        created_from=None,
        created_to=None,
    ):
        """Строки журнала под И-фильтрами (применяются только заданные).

        created_from/created_to — ПОЛУИНТЕРВАЛ [from, to), тот же уговор о
        границах, что у периодов статусов: сосед, начинающийся ровно в `to`,
        в окно не попадает, и два соседних окна не покажут одну строку дважды.
        """
        queryset = OpsAuditLog.objects.all()
        if entity_type is not None:
            queryset = queryset.filter(entity_type=entity_type)
        if entity_id is not None:
            queryset = queryset.filter(entity_id=entity_id)
        if actor_user_id is not None:
            queryset = queryset.filter(actor_user_id=actor_user_id)
        if action is not None:
            queryset = queryset.filter(action=action)
        if created_from is not None:
            queryset = queryset.filter(created_at__gte=created_from)
        if created_to is not None:
            queryset = queryset.filter(created_at__lt=created_to)
        # Свежие первыми, id — ОБЯЗАТЕЛЬНЫЙ разрыв ничьей, а не украшение:
        # record_many ставит всей пачке ОДНО время (см. audit_service), то
        # есть равный created_at здесь — обычное дело, а не край. Без второго
        # ключа страничная выдача теряла бы и дублировала строки пачки между
        # страницами.
        return queryset.order_by("-created_at", "-id")
