"""Read-only evidence of workload; date-only records never become hours.

The journal owns duty normalization. Participation dates come from recorded
statuses, not from a mutable event card. This is partial source coverage, not
an availability decision or a replacement for assignment validation.
"""
import json
import re
from collections import defaultdict
from datetime import date, timedelta, timezone

from django.core.exceptions import ValidationError
from django.db import connection
from django.db.models import CharField, Exists, OuterRef, Q, Subquery, Value
from django.db.models.functions import Cast, Concat

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import OpsEmployeeStatus, OpsStatusParticipation
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.ops.duty_register_query import register_cte
from organization_management.apps.ops.security_events import personnel_full_name
from organization_management.apps.statuses.duty_assignments import DUTY_CODES, identifier
from organization_management.apps.statuses.duty_intervals import normalize_schedule
from organization_management.apps.statuses.models import EmployeeStatus

MAX_RECORDS = 2000
MAX_DAYS = 31
SOURCE_LABELS = {"LOG": "Журнал дежурств", "DISPATCH": "Расстановка дежурств",
    "PLAN": "План дежурств", "STATUS_DUTY": "Выход из кадрового статуса",
    "STATUS": "Статус сотрудника", "OM": "Участие в ОМ по статусу"}
LIMITATIONS = [
    "Показаны записи действующих сотрудников в текущей доступной области. Историческая принадлежность дежурства также проверяется.",
    "Точные пересекающиеся интервалы одного сотрудника учитываются один раз, отдельно для плана и подтверждённого факта.",
    "Даты статусов и участия в ОМ не задают длительность. Незавершённый выход не считается подтверждённым временем.",
    "ОМ включены только по зарегистрированным участиям в статусах. Резерв и расстановка без такой связи не включены.",
    "Сводка не подтверждает доступность для нового назначения и не складывается с оценкой по типам смен.",
]


def _scope(actor, code):
    return PermissionService.visible_division_ids(str(actor), code) if actor is not None and str(actor) else set()


def _intersection(first, second):
    if first is None:
        return second
    if second is None:
        return first
    return first & second


def _in_scope(scope, division_id):
    return scope is None or division_id in scope


def _period(params, business_date):
    raw_from, raw_to = params.get("coverage_from"), params.get("coverage_to")
    if raw_from is None and raw_to is None:
        return business_date, business_date
    try:
        if any(not isinstance(value, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None
               for value in (raw_from, raw_to)):
            raise ValueError
        first, last = date.fromisoformat(raw_from), date.fromisoformat(raw_to)
        if first > last or (last - first).days >= MAX_DAYS or last == date.max or first == date.min:
            raise ValueError
        return first, last
    except (ValueError, TypeError):
        raise DomainError("INVALID_PERIOD", 422,
            message="Укажите корректные даты сводки: от 1 до 31 дня.") from None


def _interval(start, end, lower, upper, *, zero=False):
    if start is None or end is None or start.utcoffset() is None or end.utcoffset() is None:
        return None
    # Clipping can otherwise leave both bounds in the same ZoneInfo. Python
    # subtracts those as wall times, losing the real elapsed hour at an offset
    # change (including Almaty's historical UTC+06 -> UTC+05 transition).
    start, end, lower, upper = (value.astimezone(timezone.utc) for value in (start, end, lower, upper))
    if end < start or (end == start and not zero):
        return None
    if start >= upper or end < lower or (end == lower and start < end):
        # The interval is known and contributes no time to this window.
        # Keep that measured zero distinct from missing or invalid hours.
        return lower, lower
    clipped = max(start, lower), min(end, upper)
    return clipped if clipped[0] <= clipped[1] else None


def _minutes(interval):
    return round((interval[1] - interval[0]).total_seconds() / 60, 2) if interval is not None else None


def _union_minutes(intervals):
    if not intervals:
        return None
    ordered = sorted(intervals)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        if start <= merged[-1][1]:
            merged[-1] = merged[-1][0], max(merged[-1][1], end)
        else:
            merged.append((start, end))
    return round(sum((end - start).total_seconds() for start, end in merged) / 60, 2)


def _stamp(value):
    return Clock.to_local(value).isoformat() if value is not None else None


def _read_duties(actor, scope, people, first, last, now):
    from organization_management.apps.ops.personnel_duty_records import exits, sql_rows
    # Ask the shared builder to defer personnel exits, then supply them under
    # the narrower analytics/personal scope. The source filter affects its
    # `filtered` CTE only; this reader selects the normalized `raw_records`.
    # An unrelated broad duty grant must not load foreign personnel exits or
    # apply their source-size limit to this report.
    cte, params = register_cte(actor, {"from": first, "to": last, "page": 1, "page_size": 1, "source": "LOG"})
    params["status_records"] = json.dumps(sql_rows(exits(first, last, read_scope=scope)))
    # Broader duty/dispatch grants cannot extend this analytics read. Filter
    # both the live employee and historical affiliation before projecting rows.
    params.update(coverage_ids=list(people), coverage_global=scope is None,
        coverage_divisions=sorted(scope or ()), coverage_limit=MAX_RECORDS + 1, now=now)
    sql = cte + """SELECT source, source_id, source_key, employee_id, division_id,
        service_duty_label, business_date, state, planned_start, planned_end,
        actual_start, actual_end, source_changed
        FROM raw_records
        WHERE employee_id = ANY(%(coverage_ids)s::bigint[])
          AND (%(coverage_global)s OR division_id = ANY(%(coverage_divisions)s::bigint[]))
        ORDER BY business_date, source, source_id, source_key LIMIT %(coverage_limit)s"""
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        names = [column[0] for column in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    status_dates = {(int(row["source_id"]), row["source_key"]): (row["date_start"], row["date_end"])
        for row in json.loads(params["status_records"])}
    lower, upper = params["first"], params["last"]
    result = []
    for row in rows:
        planned = None if row["state"] == "CANCELLED" or row["source_changed"] else _interval(
            row["planned_start"], row["planned_end"], lower, upper)
        completed = row["state"] == "COMPLETED" or (row["source"] == "STATUS" and row["source_changed"])
        actual = (_interval(row["actual_start"], row["actual_end"], lower, upper, zero=True)
            if completed and row["actual_end"] is not None and row["actual_end"] <= now else None)
        source = "STATUS_DUTY" if row["source"] == "STATUS" else row["source"]
        if row["planned_start"] is not None and row["planned_end"] is not None:
            dates = (Clock.to_local(row["planned_start"]).date().isoformat(),
                Clock.to_local(row["planned_end"] - timedelta(microseconds=1)).date().isoformat())
        else:
            dates = status_dates.get((row["source_id"], row["source_key"]),
                (row["business_date"].isoformat(), row["business_date"].isoformat()))
        included = row["state"] != "CANCELLED" and not row["source_changed"]
        result.append({"id": f"{source}:{row['source_id']}:{row['source_key']}",
            "employeeId": str(row["employee_id"]), "source": source, "sourceLabel": SOURCE_LABELS[source],
            "label": row["service_duty_label"] or SOURCE_LABELS[source], "state": row["state"],
            "dateFrom": dates[0], "dateTo": dates[1],
            "plannedStartAt": _stamp(row["planned_start"]), "plannedEndAt": _stamp(row["planned_end"]),
            "actualStartAt": _stamp(row["actual_start"]), "actualEndAt": _stamp(row["actual_end"]),
            "plannedMinutes": _minutes(planned), "actualMinutes": _minutes(actual),
            "sourceChanged": row["source_changed"], "includedInPlan": included,
            "timing": "EXACT" if row["planned_start"] is not None and row["planned_end"] is not None else "DATE_ONLY",
            "_date_only_ref": f"personnel:{row['source_id']}" if row["source"] == "STATUS" and included and row["planned_start"] is None else None,
            "_planned": planned, "_actual": actual,
            "_unknown_plan": included and (row["planned_start"] is None or row["planned_end"] is None),
            "_unknown_actual": included and actual is None})
    return result


def _represented_personnel_refs(people, statuses):
    # A personnel duty already has its canonical exits in the journal, even
    # when its explicit schedule is empty. Malformed historical placements
    # are different: keep their known status dates instead of silently losing
    # evidence just because the duty reader cannot normalize an exit.
    result = set()
    sources = EmployeeStatus.objects.filter(employee_id__in=people, status_type__in=DUTY_CODES,
        duty_assignment__kind__in=("POST", "GROUP")).annotate(
            _workload_ref=Concat(Value("personnel:"), Cast("pk", CharField()))).filter(
                _workload_ref__in=Subquery(statuses.order_by().values("source_ref"))).only(
                    "pk", "start_date", "end_date", "actual_end_date", "duty_assignment")
    for source in sources.iterator(chunk_size=200):
        placement = source.duty_assignment
        end = source.end_date or source.actual_end_date
        if identifier(placement.get("object_id")) is None or end is None or end < source.start_date:
            continue
        try:
            normalize_schedule(placement, source.start_date, end)
        except ValidationError:
            continue
        result.add(f"personnel:{source.pk}")
    return result


def _read_statuses(people, status_scope, om_allowed, first, last, business_date, date_only_refs):
    if status_scope == set() and not om_allowed:
        return []
    catalog = dict(StatusType.objects.values_list("code", "name"))
    in_service_codes = set(StatusType.objects.filter(report_column_code="IN_SERVICE").values_list("code", flat=True))
    status_people = [pk for pk, person in people.items() if _in_scope(status_scope, person.staff_unit.division_id)]
    allowed = Q(_workload_om=False, employee_id__in=status_people) & ~Q(status_type_code__in=in_service_codes)
    if om_allowed:
        allowed |= Q(_workload_om=True)
    rows = OpsEmployeeStatus.objects.filter(employee_id__in=people, cancelled_at__isnull=True,
        date_start__lte=last, date_end__gt=first).annotate(
            _workload_om=Exists(OpsStatusParticipation.objects.filter(status_id=OuterRef("pk"))))
    rows = rows.filter(allowed).exclude(source_ref__in=date_only_refs)
    mirrored = _represented_personnel_refs(people, rows)
    rows = rows.exclude(source_ref__in=mirrored).prefetch_related("participations").order_by("pk")
    result, seen = [], set()
    for row in rows.iterator(chunk_size=200):
        person = people[row.employee_id]
        participation_ids = tuple(sorted(link.event_id for link in row.participations.all()))
        if participation_ids:
            if not om_allowed:
                continue
            source = "OM"
        else:
            if not _in_scope(status_scope, person.staff_unit.division_id) or row.status_type_code in in_service_codes:
                continue
            source = "STATUS"
        # The same registered participation may be attached to two statuses.
        # Identical dates are one piece of evidence, never two assignments.
        identity = (row.employee_id, source, participation_ids or (row.status_type_code,), row.date_start, row.date_end)
        if identity in seen:
            continue
        seen.add(identity)
        result.append({"id": f"{source}:{row.pk}", "employeeId": str(row.employee_id),
            "source": source, "sourceLabel": SOURCE_LABELS[source],
            "label": SOURCE_LABELS[source] if source == "OM" else catalog.get(row.status_type_code, "Статус"),
            "state": row.state_on(business_date), "dateFrom": row.date_start.isoformat(),
            "dateTo": (row.date_end - timedelta(days=1)).isoformat(), "timing": "DATE_ONLY",
            "plannedStartAt": None, "plannedEndAt": None, "actualStartAt": None, "actualEndAt": None,
            "plannedMinutes": None, "actualMinutes": None, "sourceChanged": False, "includedInPlan": True,
            "_planned": None, "_actual": None, "_unknown_plan": True, "_unknown_actual": True})
        if len(result) > MAX_RECORDS:
            break
    return result


def workload_coverage(params, *, actor, now):
    business_date = Clock.to_local(now).date()
    first, last = _period(params or {}, business_date)
    scope = _intersection(_scope(actor, "analytics.view"), _scope(actor, "analytics.personal_detail"))
    status_scope = _intersection(scope, _scope(actor, "status.view"))
    om_allowed = _scope(actor, "analytics.operations") is None
    result = {"state": "AVAILABLE", "period": {"from": first.isoformat(), "to": last.isoformat()},
        "timeZone": str(_local_tz()), "generatedAt": now.isoformat(),
        "calculationVersion": "workload-coverage-2026.10.27", "maxPeriodDays": MAX_DAYS,
        "scopeLabel": "Действующие сотрудники в доступной области", "employees": [],
        "reason": None, "limitations": LIMITATIONS,
        "sources": [
            {"code": "DUTY", "label": "Дежурства", "state": "INCLUDED", "reason": "Журнал, план, расстановка и кадровые выходы."},
            {"code": "STATUS", "label": "Статусы", "state": "INCLUDED" if status_scope is None or status_scope else "UNAVAILABLE",
                "reason": "Только в области отдельного права просмотра статусов; без комментариев и документов." if status_scope is None or status_scope
                else "Нет права просмотра статусов в доступной области. Этот источник не включён."},
            {"code": "OM", "label": "Участие в ОМ", "state": "INCLUDED" if om_allowed else "UNAVAILABLE",
                "reason": "Зарегистрированные даты участия, без сведений о мероприятии и без выдуманных часов." if om_allowed
                else "Нужно общее право аналитики ОМ. Этот источник не включён."},
        ]}
    if scope == set():
        result.update(state="PERSONAL_DETAIL_REQUIRED", reason="Для сводки по людям нужны права просмотра аналитики и персональной детализации в одной области.")
        for source in result["sources"]:
            source.update(state="UNAVAILABLE", reason=result["reason"])
        return result
    query = Employee.objects.filter(is_active=True, staff_unit__isnull=False).select_related("staff_unit__division")
    if scope is not None:
        query = query.filter(staff_unit__division_id__in=scope)
    people = {row.pk: row for row in query}
    if not people:
        return result
    try:
        records = _read_duties(actor, scope, people, first, last, now)
    except DomainError as error:
        if error.code != "DUTY_REGISTER_LIMIT":
            raise
        result.update(state="LIMIT_EXCEEDED", reason="Слишком много записей. Сократите период сводки.")
        return result
    if len(records) <= MAX_RECORDS:
        date_only_refs = {row["_date_only_ref"] for row in records if row["_date_only_ref"]}
        records.extend(_read_statuses(people, status_scope, om_allowed, first, last, business_date, date_only_refs))
    if len(records) > MAX_RECORDS:
        result.update(state="LIMIT_EXCEEDED", reason="Слишком много записей. Сократите период сводки.")
        return result
    grouped = defaultdict(list)
    for row in records:
        grouped[int(row["employeeId"])].append(row)
    for employee_id, rows in grouped.items():
        person = people[employee_id]
        result["employees"].append({"employeeId": str(employee_id), "safeLabel": personnel_full_name(person),
            "organizationUnitId": str(person.staff_unit.division_id), "divisionLabel": person.staff_unit.division.name,
            "knownPlannedMinutes": _union_minutes([row["_planned"] for row in rows if row["_planned"] is not None]),
            "confirmedActualMinutes": _union_minutes([row["_actual"] for row in rows if row["_actual"] is not None]),
            "unknownPlannedRecords": sum(row["_unknown_plan"] for row in rows),
            "unknownActualRecords": sum(row["_unknown_actual"] for row in rows),
            "records": [{key: value for key, value in row.items() if not key.startswith("_")}
                for row in sorted(rows, key=lambda item: (item["dateFrom"], item["plannedStartAt"] or "", item["id"]))]})
    result["employees"].sort(key=lambda row: (row["safeLabel"], row["employeeId"]))
    return result
