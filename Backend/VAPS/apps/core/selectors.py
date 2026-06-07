import logging

from django.db.models import Q

from apps.core.models import Division, Employee, EmployeeDivisionHistory


class CoreDivisionTreeSelector:
    """Read-only division tree access. Sanctioned cross-context entry point (ARCH-004)."""

    @staticmethod
    def _children_map():
        children: dict = {}
        for did, parent_id in Division.objects.values_list("id", "parent_id"):
            children.setdefault(parent_id, []).append(did)
        return children

    @classmethod
    def subtree_ids(cls, division_id) -> set:
        children = cls._children_map()
        result, stack = set(), [division_id]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(children.get(current, []))
        return result

    @classmethod
    def leaf_descendants(cls, division_id) -> list:
        children = cls._children_map()
        ids = cls.subtree_ids(division_id)
        leaf_ids = [d for d in ids if not children.get(d)]
        return list(Division.objects.filter(id__in=leaf_ids))


logger = logging.getLogger("apps.core")


class CoreEmployeeSelector:
    @staticmethod
    def get(employee_id):
        return Employee.objects.get(id=employee_id)

    @staticmethod
    def active_in_division(division_id):
        return list(
            Employee.objects.filter(division_id=division_id, is_active=True).order_by("full_name")
        )


class CoreEmployeeLockSelector:
    @staticmethod
    def lock_employee(employee_id):
        """Row-lock an employee for status/assignment flows (§1059). Use inside a transaction."""
        return Employee.objects.select_for_update().get(id=employee_id)


class HistoricalEmployeeSelector:
    @staticmethod
    def division_at(employee_id, at):
        """Division the employee belonged to at instant `at`.

        BR-CORE-HISTORY-003: if no history exists, return the current
        division_id and log a warning.
        """
        record = (
            EmployeeDivisionHistory.objects.filter(
                employee_id=employee_id, starts_at__lte=at
            )
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=at))
            .order_by("-starts_at")
            .first()
        )
        if record is not None:
            return record.division_id
        logger.warning(
            "No division history for employee %s at %s; falling back to current division.",
            employee_id, at,
        )
        return Employee.objects.values_list("division_id", flat=True).get(id=employee_id)
