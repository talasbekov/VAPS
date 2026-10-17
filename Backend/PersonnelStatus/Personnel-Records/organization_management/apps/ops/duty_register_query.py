"""One PostgreSQL snapshot for rows, groups and clipped administrative hours.

Only table identifiers from Django metadata are interpolated. All user
filters, periods and scope sets are bound parameters.
"""
from datetime import datetime, time, timedelta

from django.db import connection

from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.models_duty import OpsDutyShift, OpsDutyMonthlyPlan
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.ops.duty_record_access import division_scope, READ_PERMISSIONS, WRITE_PERMISSIONS

ATTENTION_CODES = (
    "MISSING_KIND", "MISSING_ACKNOWLEDGEMENT", "MISSING_START", "MISSING_END",
    "INVALID_ACTUAL_FACTS", "SOURCE_CHANGED", "OVERLAP", "EMPLOYEE_UNKNOWN",
)


def table(model):
    return connection.ops.quote_name(model._meta.db_table)


def register_cte(actor, query):
    scope = division_scope(actor, READ_PERMISSIONS)
    write = division_scope(actor, WRITE_PERMISSIONS)
    plan_write = division_scope(actor, ("duty.manage",))
    receiver = division_scope(actor, ("duty.dispatch",))
    params = {
        "read_global": scope is None, "read_ids": sorted(scope or ()),
        "write_global": write is None, "write_ids": sorted(write or ()),
        "plan_write_global": plan_write is None, "plan_write_ids": sorted(plan_write or ()),
        "receiver_global": receiver is None, "receiver_ids": sorted(receiver or ()),
        "from_date": query["from"], "to_date": query["to"], "now": Clock.now(), "today": Clock.today_local(),
        "first": datetime.combine(query["from"], time.min, _local_tz()),
        "last": datetime.combine(query["to"] + timedelta(days=1), time.min, _local_tz()),
        "zone": str(_local_tz()), "page_size": query["page_size"], "page": query["page"],
    }
    conditions = []
    for field in ("source", "state"):
        if query.get(field):
            params[field] = query[field]
            conditions.append(field + " = %(" + field + ")s")
    if query.get("kind") == "__missing__":
        conditions.append("service_duty_code IS NULL")
    elif query.get("kind"):
        params["kind"] = query["kind"]
        conditions.append("service_duty_code = %(kind)s")
    for field in ("employee_id", "division_id"):
        if query.get(field):
            params[field] = query[field]
            conditions.append(field + " = %(" + field + ")s")
    if query.get("attention") == "ANY":
        conditions.append("needs_attention")
    elif query.get("attention"):
        params["attention"] = query["attention"]
        conditions.append("%(attention)s = ANY(attention_codes)")
    for index, word in enumerate(query.get("search", "").split()):
        params[f"word_{index}"] = word
        conditions.append(f"POSITION(LOWER(%(word_{index})s) IN LOWER(CONCAT_WS(' ', employee_name, division_name, service_duty_label, location_label, note, document_basis))) > 0")
    where = " AND ".join(conditions) or "TRUE"
    cte = f"""
WITH raw_records AS (
    SELECT 'LOG'::text AS source, l.id AS source_id, l.employee_id,
        l.employee_name, l.division_id, l.division_name,
        NULLIF(l.service_duty_code, '') AS service_duty_code, l.service_duty_label,
        (l.planned_start AT TIME ZONE %(zone)s)::date AS business_date,
        CASE WHEN l.cancelled_at IS NOT NULL THEN 'CANCELLED'
             WHEN l.actual_end IS NOT NULL THEN 'COMPLETED'
             WHEN l.actual_start IS NOT NULL THEN 'ACTIVE'
             WHEN l.acknowledged_at IS NOT NULL THEN 'ACKNOWLEDGED' ELSE 'PLANNED' END AS state,
        l.planned_start, l.planned_end, l.acknowledged_at, l.actual_start, l.actual_end,
        l.location_label, l.document_basis, l.note, l.created_at, l.updated_at, l.revision,
        NULL::integer AS receiver_department_id,
        e.id IS NOT NULL AS employee_known, FALSE AS source_changed, FALSE AS planning_locked,
        NULL::bigint AS live_plan_division_id
    FROM {table(OpsDutyLogEntry)} l
    LEFT JOIN {table(Employee)} e ON e.id=l.employee_id
    WHERE (l.planned_start < %(last)s AND l.planned_end > %(first)s)
       OR (l.actual_start < %(last)s AND COALESCE(l.actual_end, %(now)s) > %(first)s)

    UNION ALL

    SELECT 'PLAN', p.id, COALESCE(s.employee_id, e.id),
        COALESCE(NULLIF(s.employee_name, ''), p.employee_name),
        CASE WHEN s.employee_id IS NOT NULL THEN s.division_id ELSE u.division_id END,
        CASE WHEN s.employee_id IS NOT NULL THEN s.division_name ELSE COALESCE(v.name, '') END,
        NULLIF(s.service_duty_code, ''), COALESCE(NULLIF(s.service_duty_label, ''), 'Вид не указан'),
        p.business_date, p.state_code,
        NULL::timestamptz, NULL::timestamptz, p.acknowledged_at, p.actual_start, p.actual_end,
        COALESCE(p.target->>'safeLabel', ''), '', COALESCE(p.note, ''), p.created_at,
        GREATEST(p.updated_at, s.updated_at), NULL::integer, NULL::integer,
        e.id IS NOT NULL, FALSE, COALESCE(m.state_code='APPROVED', FALSE), live_u.division_id
    FROM {table(OpsDutyShift)} p
    LEFT JOIN {table(OpsDutyRecordSupplement)} s ON s.source_type='PLAN' AND s.source_id=p.id
    LEFT JOIN {table(Employee)} e ON e.id=COALESCE(s.employee_id,
        CASE WHEN p.employee_id ~ '^[0-9]+$' AND LENGTH(LTRIM(p.employee_id,'0'))<=19
            THEN CASE WHEN p.employee_id::numeric BETWEEN 1 AND 9223372036854775807 THEN p.employee_id::bigint END END)
    LEFT JOIN {table(StaffUnit)} u ON u.employee_id=e.id
    LEFT JOIN {table(Division)} v ON v.id=u.division_id
    LEFT JOIN {table(Employee)} live_e ON p.employee_id=live_e.id::text AND live_e.id>0
    LEFT JOIN {table(StaffUnit)} live_u ON live_u.employee_id=live_e.id
    LEFT JOIN {table(OpsDutyMonthlyPlan)} m ON m.month=TO_CHAR(p.business_date,'YYYY-MM')
    WHERE p.business_date BETWEEN %(from_date)s AND %(to_date)s
       OR (p.actual_start < %(last)s AND COALESCE(p.actual_end, %(now)s) > %(first)s)

    UNION ALL

    SELECT 'DISPATCH', d.id, COALESCE(s.employee_id, e.id),
        COALESCE(NULLIF(s.employee_name, ''), d.employee_name),
        CASE WHEN s.employee_id IS NOT NULL THEN s.division_id ELSE u.division_id END,
        CASE WHEN s.employee_id IS NOT NULL THEN s.division_name ELSE COALESCE(v.name, '') END,
        NULLIF(s.service_duty_code, ''), COALESCE(NULLIF(s.service_duty_label, ''), 'Вид не указан'),
        (d.start_at AT TIME ZONE %(zone)s)::date,
        CASE WHEN d.cancelled_at IS NOT NULL THEN 'CANCELLED'
             WHEN s.actual_end IS NOT NULL THEN 'COMPLETED'
             WHEN s.actual_start IS NOT NULL THEN 'ACTIVE'
             WHEN s.acknowledged_at IS NOT NULL THEN 'ACKNOWLEDGED' ELSE 'PLANNED' END,
        d.start_at, d.end_at, s.acknowledged_at, s.actual_start, s.actual_end,
        CONCAT_WS(' · ', NULLIF(d.placement->>'object_name', ''), NULLIF(d.placement->>'post_name', ''), NULLIF(d.placement->>'group_name', '')),
        '', '', d.created_at, COALESCE(s.updated_at, d.created_at), NULL::integer, d.receiver_department_id,
        e.id IS NOT NULL,
        (st.cancelled_at IS NOT NULL OR st.employee_id<>d.employee_id
          OR st.date_start>(d.start_at AT TIME ZONE %(zone)s)::date
          OR st.date_end<=((d.end_at-INTERVAL '1 microsecond') AT TIME ZONE %(zone)s)::date), FALSE, NULL::bigint
    FROM {table(OpsDutyDispatchAssignment)} d
    LEFT JOIN {table(OpsDutyRecordSupplement)} s ON s.source_type='DISPATCH' AND s.source_id=d.id
    LEFT JOIN {table(Employee)} e ON e.id=COALESCE(s.employee_id, NULLIF(d.employee_id,0))
    LEFT JOIN {table(StaffUnit)} u ON u.employee_id=e.id
    LEFT JOIN {table(Division)} v ON v.id=u.division_id
    LEFT JOIN {table(OpsEmployeeStatus)} st ON st.id=d.source_status_id
    WHERE (d.start_at < %(last)s AND d.end_at > %(first)s)
       OR (s.actual_start < %(last)s AND COALESCE(s.actual_end, %(now)s) > %(first)s)
), scoped AS (
    SELECT *, source||':'||source_id::text AS id,
        CASE WHEN employee_id IS NULL THEN source||':'||source_id::text ELSE 'EMPLOYEE:'||employee_id::text END AS subject_key,
        (state='COMPLETED' AND actual_start IS NOT NULL AND actual_end IS NOT NULL
            AND actual_end>=actual_start AND actual_end<=%(now)s) AS valid_actual,
        CASE WHEN source='DISPATCH' THEN %(receiver_global)s OR receiver_department_id=ANY(%(receiver_ids)s::bigint[])
             WHEN source='PLAN' THEN %(plan_write_global)s OR (
                division_id=ANY(%(plan_write_ids)s::bigint[])
                AND live_plan_division_id=ANY(%(plan_write_ids)s::bigint[]))
             ELSE %(write_global)s OR division_id=ANY(%(write_ids)s::bigint[]) END AS writable
    FROM raw_records
    WHERE %(read_global)s OR division_id=ANY(%(read_ids)s::bigint[])
       OR (source='DISPATCH' AND (%(receiver_global)s OR receiver_department_id=ANY(%(receiver_ids)s::bigint[])))
), overlap_intervals AS (
    SELECT id, employee_id, 'PLAN' AS phase, GREATEST(planned_start,%(first)s) AS begins, LEAST(planned_end,%(last)s) AS ends
    FROM scoped WHERE employee_id IS NOT NULL AND state<>'CANCELLED' AND planned_start<%(last)s AND planned_end>%(first)s
    UNION ALL
    SELECT id, employee_id, 'ACTUAL', GREATEST(actual_start,%(first)s), LEAST(actual_end,%(last)s)
    FROM scoped WHERE employee_id IS NOT NULL AND valid_actual AND actual_end>actual_start AND actual_start<%(last)s AND actual_end>%(first)s
), overlap_windows AS (
    SELECT *, MAX(ends) OVER (PARTITION BY employee_id,phase ORDER BY begins,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end,
        LEAD(begins) OVER (PARTITION BY employee_id,phase ORDER BY begins,id) AS next_begin
    FROM overlap_intervals
), overlap_ids AS (
    SELECT DISTINCT id FROM overlap_windows WHERE previous_end>begins OR next_begin<ends
), measured AS (
    SELECT a.*,
        CASE WHEN planned_start IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM planned_end-planned_start)/60, 2) END AS planned_minutes,
        CASE WHEN valid_actual THEN ROUND(EXTRACT(EPOCH FROM actual_end-actual_start)/60, 2) END AS actual_minutes,
        CASE WHEN state='CANCELLED' THEN 0 WHEN planned_start IS NOT NULL
            THEN ROUND(GREATEST(0, EXTRACT(EPOCH FROM LEAST(planned_end,%(last)s)-GREATEST(planned_start,%(first)s)))/60, 2) END AS period_planned_minutes,
        CASE WHEN valid_actual THEN ROUND(GREATEST(0, EXTRACT(EPOCH FROM LEAST(actual_end,%(last)s)-GREATEST(actual_start,%(first)s)))/60, 2) END AS period_actual_minutes,
        a.id IN (SELECT id FROM overlap_ids) AS has_overlap
    FROM scoped a
), marked AS (
    SELECT *, ARRAY_REMOVE(ARRAY[
        CASE WHEN service_duty_code IS NULL AND state<>'CANCELLED' THEN 'MISSING_KIND' END,
        CASE WHEN acknowledged_at IS NULL AND state IN ('PLANNED','ACKNOWLEDGED') THEN 'MISSING_ACKNOWLEDGEMENT' END,
        CASE WHEN actual_start IS NULL AND state IN ('PLANNED','ACKNOWLEDGED')
            AND (planned_start<%(now)s OR (source='PLAN' AND business_date<%(today)s)) THEN 'MISSING_START' END,
        CASE WHEN actual_end IS NULL AND state='ACTIVE'
            AND (planned_end<%(now)s OR (source='PLAN' AND business_date<%(today)s)) THEN 'MISSING_END' END,
        CASE WHEN (state='COMPLETED' AND NOT valid_actual) OR (state='ACTIVE' AND (actual_start IS NULL OR actual_start>%(now)s)) THEN 'INVALID_ACTUAL_FACTS' END,
        CASE WHEN source_changed AND state<>'CANCELLED' THEN 'SOURCE_CHANGED' END,
        CASE WHEN has_overlap THEN 'OVERLAP' END,
        CASE WHEN NOT employee_known AND state<>'CANCELLED' THEN 'EMPLOYEE_UNKNOWN' END
    ], NULL)::text[] AS attention_codes
    FROM measured
), period_records AS (
    SELECT *, attention_codes && ARRAY['MISSING_START','MISSING_END','INVALID_ACTUAL_FACTS','SOURCE_CHANGED','OVERLAP','EMPLOYEE_UNKNOWN'] AS needs_attention,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN writable AND state='PLANNED' THEN 'acknowledge' END,
            CASE WHEN writable AND state='ACKNOWLEDGED' AND (source<>'PLAN' OR business_date<=%(today)s) THEN 'start' END,
            CASE WHEN writable AND state='ACTIVE' AND actual_start IS NOT NULL AND actual_start<=%(now)s AND (source<>'PLAN' OR business_date<=%(today)s) THEN 'complete' END,
            CASE WHEN writable AND state IN ('PLANNED','ACKNOWLEDGED') AND NOT planning_locked THEN 'cancel' END,
            CASE WHEN writable AND state<>'CANCELLED' THEN 'classify' END,
            CASE WHEN writable AND source='LOG' AND state IN ('PLANNED','ACKNOWLEDGED') THEN 'edit' END
        ], NULL)::text[] AS actions
    FROM marked
), filtered AS (
    SELECT * FROM period_records WHERE {where}
), actual_ranges AS (
    SELECT subject_key, range_agg(tstzrange(GREATEST(actual_start,%(first)s),LEAST(actual_end,%(last)s),'[)')) AS ranges
    FROM filtered WHERE valid_actual AND actual_start<%(last)s AND actual_end>%(first)s GROUP BY subject_key
), actual_net AS (
    SELECT subject_key, ROUND(SUM(EXTRACT(EPOCH FROM UPPER(r)-LOWER(r)))/60, 2) AS actual_minutes
    FROM actual_ranges CROSS JOIN LATERAL UNNEST(ranges) r GROUP BY subject_key
)
"""
    return cte, params


def json_identifier(column):
    # This JSONB scalar keeps ordinary integer DTOs and preserves larger IDs
    # as text before any browser can round them to an adjacent identifier.
    return f"CASE WHEN {column}>9007199254740991 THEN TO_JSONB({column}::text) ELSE TO_JSONB({column}) END"


ROW_COLUMNS = f"""id, source, {json_identifier('source_id')} AS source_id, {json_identifier('employee_id')} AS employee_id,
employee_name, {json_identifier('division_id')} AS division_id, division_name,
service_duty_code, service_duty_label, business_date, state, planned_start, planned_end,
planned_minutes, period_planned_minutes, acknowledged_at, actual_start, actual_end,
actual_minutes, period_actual_minutes, location_label, document_basis, note, created_at,
updated_at, revision, attention_codes, needs_attention, actions"""

SUMMARY_SQL = """
SELECT COUNT(*) AS record_count, COUNT(DISTINCT employee_id) AS employee_count,
    COUNT(*) FILTER (WHERE state='COMPLETED') AS completed_count,
    COUNT(*) FILTER (WHERE state='ACTIVE') AS active_count,
    COUNT(*) FILTER (WHERE state='CANCELLED') AS cancelled_count,
    COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND state IN ('PLANNED','ACKNOWLEDGED')) AS unconfirmed_count,
    COUNT(*) FILTER (WHERE needs_attention) AS attention_count,
    COUNT(*) FILTER (WHERE has_overlap) AS overlap_count,
    COUNT(*) FILTER (WHERE service_duty_code IS NULL AND state<>'CANCELLED') AS missing_kind_count,
    COUNT(*) FILTER (WHERE planned_start IS NULL AND state<>'CANCELLED') AS unknown_planned_count,
    COUNT(*) FILTER (WHERE state='COMPLETED' AND NOT valid_actual) AS unknown_actual_count,
    COUNT(*) FILTER (WHERE valid_actual) AS confirmed_actual_count,
    CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(period_planned_minutes) END AS planned_minutes,
    COALESCE(SUM(period_actual_minutes),0) AS actual_record_minutes,
    COALESCE((SELECT SUM(actual_minutes) FROM actual_net),0) AS actual_minutes
FROM filtered
"""


def snapshot_sql(cte):
    dictionary = table(OpsDictionaryEntry)
    return cte + f"""
, summary AS ({SUMMARY_SQL}),
kind_groups AS (
    SELECT f.service_duty_code, COALESCE(MAX(d.label),MAX(f.service_duty_label),'Вид не указан') AS service_duty_label,
        COUNT(*) AS record_count, COUNT(DISTINCT f.employee_id) AS employee_count,
        SUM(period_planned_minutes) AS planned_minutes,
        SUM(period_actual_minutes) AS actual_record_minutes,
        COUNT(*) FILTER (WHERE planned_start IS NULL AND state<>'CANCELLED') AS unknown_planned_count,
        COUNT(*) FILTER (WHERE state='COMPLETED' AND NOT valid_actual) AS unknown_actual_count,
        COUNT(*) FILTER (WHERE valid_actual) AS confirmed_actual_count,
        COUNT(*) FILTER (WHERE needs_attention) AS attention_count
    FROM filtered f LEFT JOIN {dictionary} d ON d.dictionary_code='SERVICE_DUTY_KINDS' AND d.code=f.service_duty_code
    GROUP BY f.service_duty_code
), employee_groups AS (
    SELECT f.subject_key, MAX(f.employee_id) AS employee_id,
        (ARRAY_AGG(f.employee_name ORDER BY f.created_at DESC, f.source_id DESC))[1] AS employee_name,
        COUNT(*) AS record_count, SUM(period_planned_minutes) AS planned_minutes,
        SUM(period_actual_minutes) AS actual_record_minutes,
        CASE WHEN COUNT(*) FILTER (WHERE valid_actual)>0 THEN COALESCE(MAX(n.actual_minutes),0) END AS actual_minutes,
        COUNT(*) FILTER (WHERE planned_start IS NULL AND state<>'CANCELLED') AS unknown_planned_count,
        COUNT(*) FILTER (WHERE state='COMPLETED' AND NOT valid_actual) AS unknown_actual_count,
        COUNT(*) FILTER (WHERE valid_actual) AS confirmed_actual_count,
        COUNT(*) FILTER (WHERE needs_attention) AS attention_count
    FROM filtered f LEFT JOIN actual_net n USING (subject_key) GROUP BY f.subject_key
), limits AS (
    SELECT record_count AS count, GREATEST(1,CEIL(record_count::numeric/%(page_size)s)::integer) AS pages,
        LEAST(%(page)s,GREATEST(1,CEIL(record_count::numeric/%(page_size)s)::integer)) AS page,
        %(page_size)s::integer AS page_size FROM summary
), paged AS (
    SELECT {ROW_COLUMNS} FROM filtered
    ORDER BY COALESCE(planned_start,business_date::timestamp AT TIME ZONE %(zone)s) DESC, source DESC, source_id DESC
    LIMIT %(page_size)s OFFSET ((SELECT page FROM limits)-1)*%(page_size)s
), division_options AS (
    SELECT division_id AS id, (ARRAY_AGG(division_name ORDER BY created_at DESC,source_id DESC))[1] AS name
    FROM period_records WHERE division_id IS NOT NULL GROUP BY division_id
), employee_options AS (
    SELECT employee_id, (ARRAY_AGG(employee_name ORDER BY created_at DESC,source_id DESC))[1] AS employee_name
    FROM period_records WHERE employee_id IS NOT NULL GROUP BY employee_id
)
SELECT JSONB_BUILD_OBJECT(
    'summary',(SELECT ROW_TO_JSON(summary) FROM summary),
    'rows',COALESCE((SELECT JSONB_AGG(ROW_TO_JSON(paged)) FROM paged),'[]'::jsonb),
    'pagination',(SELECT ROW_TO_JSON(limits) FROM limits),
    'by_kind',COALESCE((SELECT JSONB_AGG(ROW_TO_JSON(k) ORDER BY k.record_count DESC,k.service_duty_label) FROM kind_groups k),'[]'::jsonb),
    'by_employee',COALESCE((SELECT JSONB_AGG(TO_JSONB(e)||JSONB_BUILD_OBJECT('employee_id',{json_identifier('e.employee_id')}) ORDER BY e.actual_minutes DESC NULLS LAST,e.employee_name) FROM employee_groups e),'[]'::jsonb),
    'filters',JSONB_BUILD_OBJECT(
        'divisions',COALESCE((SELECT JSONB_AGG(TO_JSONB(v)||JSONB_BUILD_OBJECT('id',{json_identifier('v.id')}) ORDER BY v.name) FROM division_options v),'[]'::jsonb),
        'employees',COALESCE((SELECT JSONB_AGG(TO_JSONB(e)||JSONB_BUILD_OBJECT('employee_id',{json_identifier('e.employee_id')}) ORDER BY e.employee_name) FROM employee_options e),'[]'::jsonb)
    )
)
"""
