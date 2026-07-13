import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Min, Q

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    Employee,
    EmployeeDivisionHistory,
    Position,
    Rank,
)
from apps.core.sorting import (
    UNKNOWN_LEVEL,
    RosterEntry,
    RosterGroup,
    sort_roster,
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


def _resolve_roster(working, history, division_ids=None):
    """Merge current-division headcount with versioned history → roster.

    Pure (no ORM): ``working`` is {employee_id: current_division_id} for the
    WORKING & active headcount; ``history`` is an iterable of
    (employee_id, division_id, starts_at) rows whose interval covers the
    target date. History overrides the current division (max starts_at wins
    per employee — EmployeeDivisionHistory has no DB exclusion constraint, so
    the read must survive overlap); employees absent from history keep their
    current division (BR-CORE-HISTORY-003 fallback). Only employees present
    in ``working`` are placed — a non-working employee's history never
    resurrects them. ``division_ids=None`` = all divisions.

    Returns {division_id: [employee_id]}. Kept pure so the global-convergence
    invariants (никто не потерян, никто в двух списках, Σ сходится — AC-3)
    are property-tested without a database.
    """
    chosen, best_key = {}, {}
    for employee_id, division_id, starts_at in history:
        # Tie-break on (starts_at, division_id): equal-starts overlaps (no DB
        # exclusion constraint on the history table) must resolve to the SAME
        # division regardless of query/iteration order — the расход
        # denominator must not flip between runs.
        key = (starts_at, division_id)
        if employee_id not in best_key or key > best_key[employee_id]:
            best_key[employee_id] = key
            chosen[employee_id] = division_id
    result: dict = {}
    for employee_id, current_division_id in working.items():
        division_id = chosen.get(employee_id, current_division_id)
        if division_ids is not None and division_id not in division_ids:
            continue
        result.setdefault(division_id, []).append(employee_id)
    return result


class CoreDivisionTreeSelector:
    """Read-only division tree access.

    Sanctioned cross-context entry point (ARCH-004).
    """

    @staticmethod
    def children_map() -> dict:
        """{parent_id: [child_id, ...]} for the whole tree, ONE query.

        The single sanctioned channel for division-tree STRUCTURE
        (ARCH-DATA-024): a generic adjacency map with NO светофор/расход
        semantics — the consumer (e.g. the 5.5b cascade in
        apps.operations.submissions) folds its own values up over it.
        ``parent_id`` is ``None`` for top-level divisions. FULL-scans Division,
        so call it ONCE and reuse — never per node (NFR-4).
        """
        children: dict = {}
        for did, parent_id in Division.objects.values_list("id", "parent_id"):
            children.setdefault(parent_id, []).append(did)
        return children

    @staticmethod
    def _children_map():
        """Backward-compatible alias for the now-public ``children_map``."""
        return CoreDivisionTreeSelector.children_map()

    @classmethod
    def subtree_ids(cls, division_id, *, children_map=None) -> set:
        # ``children_map`` lets a caller resolving SEVERAL subtrees reuse one
        # adjacency scan (the map's own «call it ONCE» contract) instead of
        # re-scanning Division per call (review 5.8c).
        children = cls.children_map() if children_map is None else children_map
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
        children = cls.children_map()
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

    @staticmethod
    def exists(division_id) -> bool:
        """True if a division with this id exists — the сдача-сервис 5.3b
        existence gate (404 BEFORE building a snapshot, so a valid-but-phantom
        UUID can't silently produce an empty сдача). Cross-context callers read
        this instead of importing core.models (ARCH-003/004 isolation)."""
        return Division.objects.filter(id=division_id).exists()


logger = logging.getLogger("apps.core")


class CoreEmployeeSelector:
    @staticmethod
    def get(employee_id):
        return Employee.objects.get(id=employee_id)

    @staticmethod
    def active_in_division(division_id):
        """Active employees of a division in the FR-5 sort canon (story 2.6).

        Order: own personnel by Position.level (asc) then surname, then the
        attached-force block. ``position_code`` is a plain string, so the level
        comes from one ``{code: level}`` map (no N+1); an unmatched code falls
        back to UNKNOWN_LEVEL (AC-3). Group is static here — ``is_attached_force``
        is the only attach signal available without a date; date-keyed
        ATTACHED/DETACHED classification lives in apps.operations.statuses
        (core ↛ operations) and plugs into the same canon when the per-person
        расход lists land (E6/E9/E10).
        """
        levels = dict(Position.objects.values_list("code", "level"))
        entries = [
            RosterEntry(
                group=(
                    RosterGroup.ATTACHED
                    if employee.is_attached_force
                    else RosterGroup.OWN
                ),
                position_level=levels.get(employee.position_code, UNKNOWN_LEVEL),
                surname=employee.last_name or employee.full_name or "",
                id=employee.id,
                payload=employee,
            )
            for employee in Employee.objects.filter(
                division_id=division_id, is_active=True
            )
        ]
        return [entry.payload for entry in sort_roster(entries)]

    @staticmethod
    def denorm_for(employee_ids) -> dict:
        """employee_id -> {"full_name", "rank"} for the сдача-снапшот (5.3a).

        Denormalised print values «как было»: ``full_name`` as stored, ``rank``
        resolved to the Rank dictionary name (fall back to the raw ``rank_code``
        when the dictionary has no row). Two bulk queries (employees + ranks).
        Cross-context callers (apps.operations) read this instead of importing
        core models directly — ARCH-003 isolation (operations ↛ core.models).
        """
        employees = list(
            Employee.objects.filter(id__in=employee_ids).values(
                "id", "full_name", "rank_code"
            )
        )
        rank_codes = {e["rank_code"] for e in employees if e["rank_code"]}
        rank_names = dict(
            Rank.objects.filter(code__in=rank_codes).values_list("code", "name")
        )
        return {
            e["id"]: {
                "full_name": e["full_name"],
                "rank": rank_names.get(e["rank_code"], e["rank_code"]),
            }
            for e in employees
        }

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

    @staticmethod
    def lock_employees(employee_ids):
        """Bulk row-lock employees for a mass status write — ONE query, no
        per-item lock (NFR-4 / story 3.8). ``order_by("id")`` makes the lock
        order deterministic so two operators writing the same unit at the
        16-17 peak cannot deadlock on a different acquisition order. Use inside
        a transaction. Returns ``{id: Employee}`` (missing ids are simply absent
        — the caller decides whether that is a 404)."""
        rows = (
            Employee.objects.select_for_update()
            .filter(id__in=list(employee_ids))
            .order_by("id")
        )
        return {employee.id: employee for employee in rows}


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
            employee_id,
            at,
        )
        return Employee.objects.values_list("division_id", flat=True).get(
            id=employee_id
        )

    @staticmethod
    def earliest_history_start():
        """Earliest division-history start as a LOCAL business date — the
        history half of the report data horizon (6.10a review D1 2026-07-13).
        None while the pilot has zero history rows (E7 backfills intervals).
        """
        earliest = EmployeeDivisionHistory.objects.aggregate(m=Min("starts_at"))["m"]
        if earliest is None:
            return None
        return earliest.astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)).date()

    @classmethod
    def roster_on(cls, business_date, division_ids=None) -> dict:
        """division_id -> [employee_id]: the roster on a business date.

        The date-versioned Список denominator of the strength report
        (ARCH-DATA-025): membership comes from EmployeeDivisionHistory
        intervals on the date, falling back to the current Employee.division
        for employees with no covering interval (BR-CORE-HISTORY-003). The
        fallback is load-bearing: the donor import writes zero history rows,
        so every employee takes it until E7 backfills intervals.

        Bulk: two queries (WORKING headcount + covering history) merged by
        _resolve_roster — NEVER division_at in a loop. Only WORKING & active
        employees count (parity with working_by_division, review D1
        2026-06-15): hire/dismissal bound membership via employment_status /
        is_active. business_date is explicit (ARCH-DATA-022, no wall-clock);
        T = local_midnight(business_date); a row acts iff starts_at <= T AND
        (ends_at IS NULL OR ends_at > T). division_ids=None = the whole DB.

        History is fetched DB-wide (not pushed into the query): a covering
        interval may resolve to a division other than the current one, so
        filtering happens AFTER resolution. Indexing the bulk-by-date scan is
        a perf follow-up (the table is empty until E7 backfills).
        """
        t = local_midnight(business_date)
        working = dict(
            Employee.objects.filter(
                employment_status=Employee.EmploymentStatus.WORKING,
                is_active=True,
            ).values_list("id", "division_id")
        )
        history = list(
            EmployeeDivisionHistory.objects.filter(starts_at__lte=t)
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=t))
            .values_list("employee_id", "division_id", "starts_at")
        )
        roster = _resolve_roster(working, history, division_ids)
        covered = {row[0] for row in history}
        fallback_count = sum(1 for eid in working if eid not in covered)
        if fallback_count:
            # BR-CORE-HISTORY-003: aggregate (not per-row — bulk would spam)
            # visibility of employees placed by current-division fallback.
            logger.debug(
                "roster_on(%s): %d/%d employees via current-division fallback "
                "(no covering history; BR-CORE-HISTORY-003).",
                business_date,
                fallback_count,
                len(working),
            )
        return roster

    @classmethod
    def roster_reconciliation(cls, business_date) -> dict:
        """Global convergence check for the date-versioned roster (AC-3).

        Σ(roster over all divisions) must equal the count of WORKING & active
        employees (ARCH-DATA-025: convergence is global). A hole — an active
        employee placed in no division — is a DATA finding, NOT an exception
        (Решение №6 стори 1.7): the report still comes out. With the fallback
        above, the invariant holds by construction; missing stays [] and
        guards against regressions / a future no-fallback mode.
        """
        roster = cls.roster_on(business_date)
        placed = {eid for ids in roster.values() for eid in ids}
        active = set(
            Employee.objects.filter(
                employment_status=Employee.EmploymentStatus.WORKING,
                is_active=True,
            ).values_list("id", flat=True)
        )
        missing = sorted(active - placed, key=str)
        return {
            "expected": len(active),
            "actual": len(placed),
            "missing_employee_ids": missing,
        }
