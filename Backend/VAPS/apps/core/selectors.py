import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Q

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    Employee,
    EmployeeDivisionHistory,
)


def local_midnight(business_date):
    """Aware start-of-day of a business date in the VAPS local timezone.

    The ONLY way to compare a business date against aware timeline columns
    (valid_from/valid_to): naive datetimes or UTC midnight shift by the
    local offset and produce off-by-one at day boundaries.
    """
    return datetime.combine(
        business_date, time.min, tzinfo=ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
    )


class CoreDivisionTreeSelector:
    """Read-only division tree access.

    Sanctioned cross-context entry point (ARCH-004).
    """

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

    @staticmethod
    def divisions_map(division_ids=None) -> dict:
        """id -> name for report rows, one query; None = the whole DB."""
        qs = Division.objects.all()
        if division_ids is not None:
            qs = qs.filter(id__in=division_ids)
        return dict(qs.values_list("id", "name"))


logger = logging.getLogger("apps.core")


class CoreEmployeeSelector:
    @staticmethod
    def get(employee_id):
        return Employee.objects.get(id=employee_id)

    @staticmethod
    def active_in_division(division_id):
        return list(
            Employee.objects.filter(division_id=division_id, is_active=True).order_by(
                "full_name"
            )
        )

    @staticmethod
    def working_by_division(division_ids=None) -> dict:
        """division_id -> [employee_id] for WORKING & active employees.

        One query over ALL divisions (division_ids=None = the whole DB):
        the E1 strength-report denominator — never call active_in_division
        in a loop for aggregation. is_active=True aligns with
        active_in_division (review verdict D1 2026-06-15, deviating from
        Решение №3): a WORKING-but-inactive row must not inflate Список.
        """
        qs = Employee.objects.filter(
            employment_status=Employee.EmploymentStatus.WORKING,
            is_active=True,
        )
        if division_ids is not None:
            qs = qs.filter(division_id__in=division_ids)
        result: dict = {}
        for employee_id, division_id in qs.values_list("id", "division_id"):
            result.setdefault(division_id, []).append(employee_id)
        return result


class CoreStaffingSelector:
    @staticmethod
    def allocated_slots_on(business_date, division_ids=None) -> dict:
        """division_id -> allocated_slots on a business date, one query.

        BR-002 timeline rule: valid_from <= T AND (valid_to IS NULL OR
        valid_to > T) at T = local midnight of the date; with several
        matching rows per division the one with max valid_from wins
        (Решение №5 стори 1.7).
        """
        t = local_midnight(business_date)
        qs = DivisionHistoricalSlot.objects.filter(valid_from__lte=t).filter(
            Q(valid_to__isnull=True) | Q(valid_to__gt=t)
        )
        if division_ids is not None:
            qs = qs.filter(division_id__in=division_ids)
        result: dict = {}
        best_from: dict = {}
        for division_id, slots, valid_from in qs.values_list(
            "division_id", "allocated_slots", "valid_from"
        ):
            if division_id not in best_from or valid_from > best_from[division_id]:
                best_from[division_id] = valid_from
                result[division_id] = slots
        return result


class CoreEmployeeLockSelector:
    @staticmethod
    def lock_employee(employee_id):
        """Row-lock an employee for status/assignment flows (§1059).

        Use inside a transaction.
        """
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
            "No division history for employee %s at %s; "
            "falling back to current division.",
            employee_id, at,
        )
        return (
            Employee.objects.values_list("division_id", flat=True).get(id=employee_id)
        )
