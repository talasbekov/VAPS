"""Селекторы раздела ОМ (порт apps/operations/selectors.py + часть
apps/core/selectors.py из Backend/VAPS).

DivisionTreeSelector работает по СТАРОЙ структуре (divisions.Division, int-pk,
MPTT): переезд «женит» новый RBAC со старым деревом. Адъяценси-обход оставлен
вместо mptt-запросов намеренно — children_map() переносится один-в-один и
переживёт будущую смену модели дерева.
"""
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import UserRole


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
