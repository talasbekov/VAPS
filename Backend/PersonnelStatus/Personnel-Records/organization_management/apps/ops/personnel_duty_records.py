"""Canonical personnel exits used by the existing journal and self reader.

Reading never creates a supplement. The first explicit journal mutation freezes
the original placement, hours and affiliation; later source edits retain history.
"""
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from django.db.models import Q

from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.ops.duty_record_access import employee_data, in_scope
from organization_management.apps.statuses.duty_assignments import DUTY_CODES, identifier
from organization_management.apps.statuses.models import EmployeeStatus

MAX_SOURCE_ROWS = 20000


def stamp(value):
    return Clock.to_local(value).isoformat() if value is not None else None


def instant(value):
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("An exit needs an explicit time zone")
    return parsed.astimezone(timezone.utc)


def placement_label(placement):
    return " · ".join(str(placement.get(key) or "") for key in ("object_name", "post_name", "group_name") if placement.get(key))


def snapshots(source):
    placement = source.duty_assignment
    if not isinstance(placement, dict) or placement.get("kind") not in ("POST", "GROUP"):
        return []
    if identifier(placement.get("object_id")) is None:
        return []
    end = source.actual_end_date or source.end_date
    if source.employee_id is None or end is None:
        return []
    metadata = employee_data(source.employee)
    base = {"source_id": str(source.pk), **metadata,
        "date_start": source.start_date.isoformat(), "date_end": end.isoformat(),
        "placement": {key: value for key, value in placement.items() if key not in ("intervals", "time_zone")},
        "created_at": stamp(source.created_at), "updated_at": stamp(source.updated_at),
        "created_by": str(source.created_by_id or "")}
    result = []
    intervals = placement.get("intervals", [None])
    if not isinstance(intervals, list):
        return []
    for interval in intervals:
        try:
            first, last = (instant(interval["start_at"]), instant(interval["end_at"])) if interval is not None else (None, None)
            if first is not None and first >= last:
                continue
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        saved = {**base, "planned_start": stamp(first), "planned_end": stamp(last)}
        identity = {"source_id": str(source.pk), "employee_id": str(source.employee_id),
            "placement": {key: str(placement.get(key) or "") for key in ("kind", "object_id", "post_id", "group_id")},
            "planned_start": saved["planned_start"], "planned_end": saved["planned_end"]}
        if first is None:
            identity.update(date_start=saved["date_start"], date_end=saved["date_end"])
        key = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        result.append((key, saved))
    return result


@dataclass
class PersonnelExit:
    source: object
    source_key: str
    snapshot: dict
    supplement: object = None
    source_changed: bool = False

    @property
    def pk(self):
        return int(self.snapshot["source_id"])

    @property
    def employee_id(self):
        return int(self.snapshot["employee_id"])

    @property
    def employee_name(self):
        return self.snapshot["employee_name"]

    @property
    def placement(self):
        return self.snapshot["placement"]

    @property
    def start_at(self):
        return instant(self.snapshot["planned_start"])

    @property
    def end_at(self):
        return instant(self.snapshot["planned_end"])

    @property
    def business_date(self):
        return Clock.to_local(self.start_at).date() if self.start_at else date.fromisoformat(self.snapshot["date_start"])

    @property
    def created_at(self):
        return instant(self.snapshot["created_at"])

    @property
    def updated_at(self):
        return self.supplement.updated_at if self.supplement else instant(self.snapshot["updated_at"])


def _points(first, last, projections):
    # The winner can change only at one of these boundaries, even for a long
    # imported period. Never loop through centuries of calendar days.
    return {first, *[row[key] for row in projections for key in ("date_start", "date_end") if first < row[key] <= last]}


def canonical(exit, projections, catalog, first, last):
    source = exit.source
    if source is None or source.state == "cancelled" or source.status_type not in DUTY_CODES or source.employee_id != exit.employee_id:
        return False
    if source.employee is None or not source.employee.is_active:
        return False
    end = source.actual_end_date or source.end_date
    if end is None:
        return False
    exact = exit.start_at is not None
    begin_day = Clock.to_local(exit.start_at).date() if exact else max(first, source.start_date)
    end_day = Clock.to_local(exit.end_at - timedelta(microseconds=1)).date() if exact else min(last, end)
    if begin_day > end_day or begin_day < source.start_date or end_day > end:
        return False
    winners = []
    for day in _points(begin_day, end_day, projections):
        winner = resolve_status_row(projections, day, catalog)
        winners.append(winner is not None and catalog.column[winner["status_type_code"]] == "ON_DUTY"
            and winner.get("source_ref") == f"personnel:{source.pk}")
    return all(winners) if exact else any(winners)


def _bounded(query):
    rows = list(query[:MAX_SOURCE_ROWS + 1])
    if len(rows) > MAX_SOURCE_ROWS:
        raise DomainError("DUTY_REGISTER_LIMIT", 422, message="Слишком много кадровых выходов. Уточните период или подразделение.")
    return rows


def exits(first, last, *, read_scope=None, employee_id=None, source_id=None):
    """Bound by period and authority before canonical projection work."""
    lower = datetime.combine(first, time.min, _local_tz())
    upper = datetime.combine(last + timedelta(days=1), time.min, _local_tz())
    supplements = OpsDutyRecordSupplement.objects.filter(source_type="STATUS")
    if read_scope is not None:
        supplements = supplements.filter(division_id__in=read_scope)
    if employee_id is not None:
        supplements = supplements.filter(employee_id=employee_id)
    if source_id is not None:
        supplements = supplements.filter(source_id=source_id)
    supplements = _bounded(supplements.filter(
        Q(source_snapshot__date_start__lte=last.isoformat(), source_snapshot__date_end__gte=first.isoformat())
        | Q(actual_start__lt=upper, actual_end__gt=lower)
        | Q(actual_start__lt=upper, actual_end__isnull=True)))
    saved = {(row.source_id, row.source_key): row for row in supplements}
    sources = EmployeeStatus.objects.select_related("employee__staff_unit__division", "employee__staff_unit__position").filter(duty_assignment__isnull=False)
    if employee_id is not None:
        sources = sources.filter(employee_id=employee_id)
    if source_id is not None:
        sources = sources.filter(pk=source_id)
    current = Q(start_date__lte=last) & (Q(actual_end_date__gte=first) | Q(actual_end_date__isnull=True, end_date__gte=first))
    if read_scope is not None:
        current &= Q(employee__staff_unit__division_id__in=read_scope)
    sources = _bounded(sources.filter(current | Q(pk__in={pk for pk, _ in saved})))
    by_id = {row.pk: row for row in sources}
    candidates, identities = {}, {}
    for source in sources:
        identities[source.pk] = set()
        for key, value in snapshots(source):
            identities[source.pk].add(key)
            candidates[source.pk, key] = PersonnelExit(source, key, value)
            if len(candidates) > MAX_SOURCE_ROWS:
                raise DomainError("DUTY_REGISTER_LIMIT", 422, message="Слишком много кадровых выходов. Уточните период или подразделение.")
    for (pk, key), supplement in saved.items():
        candidates[pk, key] = PersonnelExit(by_id.get(pk), key, supplement.source_snapshot, supplement)
    employee_ids = {row.employee_id for row in candidates.values()}
    if not employee_ids:
        return []
    projections = defaultdict(list)
    first_day = min(Clock.to_local(row.start_at).date() if row.start_at else max(first, date.fromisoformat(row.snapshot["date_start"])) for row in candidates.values())
    last_day = max(Clock.to_local(row.end_at - timedelta(microseconds=1)).date() if row.end_at else min(last, date.fromisoformat(row.snapshot["date_end"])) for row in candidates.values())
    for row in _bounded(OpsEmployeeStatus.objects.filter(employee_id__in=employee_ids, cancelled_at__isnull=True,
            date_start__lte=last_day, date_end__gt=first_day).order_by("pk").values(
        "id", "employee_id", "status_type_code", "date_start", "date_end", "source_ref")):
        projections[row["employee_id"]].append(row)
    catalog = StatusCatalog.from_rows(StatusType.objects.values("code", "priority", "report_column_code", "counts_in_staff"))
    result = []
    for row in candidates.values():
        # A frozen affiliation grants this historical record only. It never
        # exposes another, newly edited placement of a transferred employee.
        if read_scope is not None and not in_scope(read_scope, row.snapshot.get("division_id")):
            continue
        row.source_changed = row.source_key not in identities.get(row.pk, set()) or not canonical(row, projections[row.employee_id], catalog, first, last)
        if row.source_changed and row.supplement is None:
            continue
        planned_here = ((row.start_at < upper and row.end_at > lower) if row.start_at else
            (row.snapshot["date_start"] <= last.isoformat() and row.snapshot["date_end"] >= first.isoformat()))
        facts = row.supplement
        actual_here = facts is not None and facts.actual_start is not None and facts.actual_start < upper and (facts.actual_end or Clock.now()) > lower
        if planned_here or actual_here:
            result.append(row)
    if len(result) > MAX_SOURCE_ROWS:
        raise DomainError("DUTY_REGISTER_LIMIT", 422, message="Слишком много кадровых выходов. Уточните период или подразделение.")
    return result


def resolve(source_id, key, *, scope=None):
    rows = exits(date.min, date.max - timedelta(days=1), read_scope=scope, source_id=source_id)
    return next((row for row in rows if row.source_key == key), None)


def sql_rows(rows):
    result = []
    for row in rows:
        person = row.source.employee if row.source else None
        live = employee_data(person)
        facts = row.supplement
        result.append({**row.snapshot, "source_id": row.pk, "source_key": row.source_key,
            "employee_known": person is not None, "source_changed": row.source_changed,
            "live_division_id": live["division_id"], "business_date": row.business_date.isoformat(),
            "service_duty_code": facts.service_duty_code if facts else "",
            "service_duty_label": facts.service_duty_label if facts else "",
            **{key: stamp(getattr(facts, key)) if facts else None for key in ("acknowledged_at", "actual_start", "actual_end")},
            "updated_at": stamp(row.updated_at),
            "location_label": placement_label(row.placement)})
    return result
