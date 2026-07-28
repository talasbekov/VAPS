"""Story 7.9 — выгрузка «как в системе» для построчной сверки владельцем.

Membership comes from ``HistoricalEmployeeSelector.roster_on()`` (canon
date-versioned roster, ARCH-DATA-025) — NOT a raw ``Employee.objects.filter
(division=...)`` query, which would give the CURRENT roster, not the one AS
OF ``business_date`` (and would silently disagree with what the strength
report shows for the same day).
"""

from dataclasses import dataclass

from apps.core.models import Division, Employee, Position, Rank
from apps.core.selectors import HistoricalEmployeeSelector


@dataclass(frozen=True)
class RosterExportRow:
    employee_id: str
    personnel_number: str
    full_name: str
    rank_name: str
    position_name: str


def resolve_division_by_code(code):
    """``Division.code`` is unique only PER ORGANIZATION
    (``unique_org_division_code``), not globally — a bare ``.filter(code=
    ...).first()`` would silently pick an arbitrary division if two
    organizations happen to share a code (review fix: caught by adversarial
    review, blind-hunter pass). Raises ``LookupError`` on 0 or >1 matches so
    callers can turn that into an unambiguous CLI error."""
    matches = list(Division.objects.filter(code=code))
    if not matches:
        raise LookupError(f"подразделение не найдено: {code!r}")
    if len(matches) > 1:
        orgs = ", ".join(sorted(str(d.organization_id) for d in matches))
        raise LookupError(
            f"код подразделения {code!r} неоднозначен — совпадает в "
            f"нескольких организациях ({orgs}); используйте UUID вместо кода"
        )
    return matches[0]


def build_roster_export_rows(division_id, business_date):
    """Denormalized, deterministically ordered rows for one division on
    ``business_date`` — safe to hand to a human for line-by-line sign-off."""
    roster = HistoricalEmployeeSelector.roster_on(
        business_date, division_ids=[division_id]
    )
    employee_ids = roster.get(division_id, [])
    if not employee_ids:
        return []

    employees = {
        e.id: e
        for e in Employee.objects.filter(id__in=employee_ids).only(
            "id", "personnel_number", "full_name", "rank_code", "position_code"
        )
    }
    rank_names = dict(Rank.objects.values_list("code", "name"))
    position_names = dict(Position.objects.values_list("code", "name"))

    rows = []
    for employee_id in employee_ids:
        employee = employees.get(employee_id)
        if employee is None:
            # roster_on resolved an id that's since gone missing (deleted
            # between roster resolution and this lookup) — skip, don't crash
            # a reconciliation export over a race that self-heals next run.
            continue
        rows.append(
            RosterExportRow(
                employee_id=str(employee.id),
                personnel_number=employee.personnel_number or "",
                full_name=employee.full_name,
                rank_name=rank_names.get(employee.rank_code, employee.rank_code),
                position_name=position_names.get(
                    employee.position_code, employee.position_code
                ),
            )
        )
    rows.sort(key=lambda r: r.full_name)
    return rows
