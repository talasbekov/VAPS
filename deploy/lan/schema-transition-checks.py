"""Database evidence for the reviewed September/October -> 27 October transition.

Imported without Django by unit tests; the same source is executed inside the
verified backend image. No business row values are emitted, only checksums.
"""
import hashlib
import importlib
import io
import json
from pathlib import Path
import re

RELEASE_POLICY = 'smart-20261027-guided-v1'
ACCESS_PLAN = (('operations', '0144_workspace_and_digital_twin_access'),)
APPROVED_PLAN = (
    ('employees', '0006_iin_format_validation'),
    ('employees', '0007_employee_service_profile'),
    ('employees', '0008_employee_service_profile_verbose_names'),
    ('operations', '0132_group_evaluation_targets'),
    ('operations', '0133_recon_materials'),
    ('operations', '0134_duty_status_variants'),
    ('operations', '0135_service_summary_view_permission'),
    ('operations', '0136_duty_dispatch'),
    ('operations', '0137_legal_document_files'),
    ('operations', '0138_service_duty_register'),
    ('operations', '0139_duty_source_execution'),
    ('operations', '0140_duty_log_idempotency'),
    ('operations', '0141_duty_log_revision'),
    ('operations', '0142_duty_register_big_identifiers'),
    ('operations', '0143_duty_creation_closure'),
    *ACCESS_PLAN,
    ('operations', '0145_personnel_duty_execution'),
    ('operations', '0146_om_assistant_tasks'),
    ('operations', '0147_resource_calculation'),
    ('operations', '0148_assistant_connection'),
    ('operations', '0149_duty_templates'),
    ('operations', '0150_employee_qualifications'),
    ('operations', '0151_object_inspections'),
    ('operations', '0152_assistant_dialogue'),
    ('operations', '0153_assistant_connection_check'),
    ('operations', '0154_assistant_credential_format'),
    ('statuses', '0005_employeestatus_duty_assignment'),
)
# Only these reviewed migrations insert rows into existing tables. Existing
# rows in these tables remain protected by their original primary keys.
SEED_TABLES = frozenset({'django_migrations', 'django_content_type', 'auth_permission', 'ops_roles',
                        'ops_permissions', 'ops_role_permissions', 'ops_status_types', 'ops_dictionary_entries'})


_ROUNDTRIP_ENUM_COLUMNS = {
    ('ops_dictionary_entries', 'chk_ops_dictionary_code'): 'dictionary_code',
    ('ops_duty_record_supplements', 'chk_duty_supplement_source'): 'source_type',
    ('operations_opsforeignvisit', 'chk_ops_foreign_visit_status'): 'status',
    ('operations_opslegaldocument', 'chk_ops_legal_document_kind'): 'kind',
    ('operations_opslegaldocument', 'chk_ops_legal_document_status'): 'status',
    ('operations_opsprotectedperson', 'chk_ops_protected_person_category'): 'category',
    ('ops_analytics_metric_definitions', 'chk_ops_metric_unit'): 'unit',
    ('ops_attention_detectors', 'chk_ops_detector_measure'): 'measure',
    ('ops_attention_detectors', 'chk_ops_detector_severity'): 'base_severity',
    ('ops_attention_detectors', 'chk_ops_detector_title'): 'title_code',
    ('ops_daily_submissions', 'chk_ops_submission_event'): 'event',
    ('ops_duty_conflict_policy', 'chk_ops_duty_policy_mode'): 'rest_after_duty_mode',
    ('ops_duty_monthly_plans', 'chk_ops_duty_plan_state'): 'state_code',
    ('ops_duty_shifts', 'chk_ops_duty_shift_state'): 'state_code',
    ('ops_duty_types', 'chk_ops_duty_type_target'): 'target_type',
    ('ops_employee_statuses', 'excl_hard_status_overlap'): 'status_type_code',
    ('ops_evaluation_work_items', 'chk_ops_work_item_direction'): 'evaluation_direction',
    ('ops_evaluation_work_items', 'chk_ops_work_item_status'): 'status',
    ('ops_event_evaluations', 'chk_ops_evaluation_direction'): 'evaluation_direction',
    ('ops_event_evaluations', 'chk_ops_evaluation_method'): 'method',
    ('ops_issued_documents', 'chk_ops_issued_document_status'): 'status',
    ('ops_notifications', 'chk_ops_notif_kind'): 'kind',
    ('ops_placement_document_versions', 'chk_ops_placement_document_version_status'): 'status',
    ('ops_policy_section_versions', 'chk_ops_section_version_code'): 'section_code',
    ('ops_policy_settings', 'chk_ops_setting_kind'): 'kind',
    ('ops_policy_settings', 'chk_ops_setting_section'): 'section_code',
    ('ops_rating_audit_entries', 'chk_ops_rating_audit_event_code'): 'event_code',
    ('ops_rating_audit_entries', 'chk_ops_rating_audit_outcome'): 'outcome',
    ('ops_rating_dynamics_points', 'chk_ops_dynamics_data_state'): 'data_state',
    ('ops_rating_export_jobs', 'chk_ops_rating_export_scope'): 'scope',
    ('ops_rating_export_jobs', 'chk_ops_rating_export_state'): 'state',
    ('ops_security_event_transitions', 'chk_ops_event_transition_kind'): 'kind',
    ('ops_security_event_transitions', 'chk_ops_event_transition_to_stage'): 'to_stage',
    ('ops_security_event_visit_objects', 'chk_ops_event_visit_object_stage'): 'stage',
    ('ops_security_events', 'chk_ops_security_event_approval'): 'approval_status',
    ('ops_security_events', 'chk_ops_security_event_kind'): 'kind',
    ('ops_security_events', 'chk_ops_security_event_stage'): 'stage',
    ('ops_security_objects', 'chk_ops_security_object_ownership'): 'ownership',
    ('ops_security_objects', 'chk_ops_security_object_passport_state'): 'passport_state',
    ('ops_security_objects', 'chk_ops_security_object_state'): 'object_state',
    ('ops_service_report_jobs', 'chk_ops_report_job_state'): 'state',
}


def canonical_constraint(table, name, definition):
    """Normalize only observed PostgreSQL literal-array cast distribution.

    Keep the reviewed table/name/column, complete expression frame, non-null
    uppercase literals and unbounded varchar type exact. The exclusion index
    repeats the same predicate and needs the same lossless representation.
    No values, operators, NULL guards, flags or other definitions are omitted.
    """
    column = _ROUNDTRIP_ENUM_COLUMNS.get((table, name))
    if column is None:
        return definition
    prefix, suffix = 'CHECK (((' + column + ')::text = ANY ', '))'
    if (table, name) == ('ops_security_events', 'chk_ops_security_event_kind'):
        prefix, suffix = 'CHECK ((((kind)::text = ANY ', ') OR (kind IS NULL)))'
    elif (table, name) == ('ops_employee_statuses', 'excl_hard_status_overlap'):
        if definition.startswith('CREATE INDEX '):
            prefix = 'CREATE INDEX excl_hard_status_overlap ON public.ops_employee_statuses USING gist (employee_id, period) WHERE (((status_type_code)::text = ANY '
            suffix = ') AND (cancelled_at IS NULL))'
        else:
            prefix = 'EXCLUDE USING gist (employee_id WITH =, period WITH &&) WHERE ((((status_type_code)::text = ANY '
            suffix = ') AND (cancelled_at IS NULL)))'
    if not definition.startswith(prefix) or not definition.endswith(suffix):
        return definition
    operand = definition[len(prefix):-len(suffix)]
    if not operand.startswith('((ARRAY[') or not operand.endswith('])::text[])'):
        return definition
    literals = operand[len('((ARRAY['):-len('])::text[])')].split(', ')
    if not all(re.fullmatch(r"'[A-Z][A-Z0-9_]*'::character varying", value) for value in literals):
        return definition
    return prefix + '(ARRAY[' + ', '.join('(' + value + ')::text' for value in literals) + '])' + suffix


def migration_graph():
    """Read the complete installed migration graph without opening a database."""
    from django.db.migrations.loader import MigrationLoader
    loader = MigrationLoader(None, ignore_no_migrations=True)
    nodes = []
    for key, migration in sorted(loader.disk_migrations.items()):
        source = Path(importlib.import_module(migration.__module__).__file__)
        parents = sorted(parent.key for parent in loader.graph.node_map[key].parents)
        nodes.append({'app': key[0], 'name': key[1],
                      'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                      'dependencies': [list(parent) for parent in parents]})
    order, seen = [], set()
    for leaf in loader.graph.leaf_nodes():
        for key in loader.graph.forwards_plan(leaf):
            if key not in seen:
                order.append(list(key))
                seen.add(key)
    return {'format': 1, 'nodes': nodes, 'order': order,
            'leaves': [list(key) for key in loader.graph.leaf_nodes()]}


def require_graph(actual, expected):
    if actual != expected or expected.get('format') != 1:
        raise RuntimeError('The complete image migration graph differs from the reviewed release')
    nodes = [(item['app'], item['name']) for item in expected['nodes']]
    order = list(map(tuple, expected['order']))
    if (len(nodes) != len(set(nodes)) or len(order) != len(set(order)) or set(nodes) != set(order)
            or not set(APPROVED_PLAN).issubset(nodes)):
        raise RuntimeError('Incomplete current migration graph; employees0008 and operations0154 are required')
    positions = {key: index for index, key in enumerate(order)}
    for item in expected['nodes']:
        key = (item['app'], item['name'])
        if not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            raise RuntimeError('Invalid migration source checksum')
        if any(tuple(parent) not in positions or positions[tuple(parent)] >= positions[key]
               for parent in item['dependencies']):
            raise RuntimeError('Migration graph dependency order is invalid')


def require_plan(plan, graph=None):
    pending = tuple(map(tuple, plan))
    allowed = set(APPROVED_PLAN)
    order = tuple(map(tuple, graph['order'])) if graph is not None else APPROVED_PLAN
    if (len(pending) != len(set(pending)) or any(item not in allowed for item in pending)
            or pending != tuple(item for item in order if item in set(pending))):
        raise RuntimeError('Unreviewed migration plan; only ordered pending migrations from the '
                           'reviewed 27 October delta are allowed')


def require_preserved(before, projected):
    if before['tables'] != projected['tables']:
        raise RuntimeError('An existing table, row or original column changed; migration transaction refused')
    mutable = {item['sequence'] for item in before['seed_keys'].values() if item['sequence']}
    for name, state in before['sequences'].items():
        if name not in mutable and projected['sequences'].get(name) != state:
            raise RuntimeError('An existing business sequence changed: ' + name)


def pending_plan():
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    executor = MigrationExecutor(connection)
    executor.loader.check_consistent_history(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    if any(backwards for _, backwards in plan):
        raise RuntimeError('Backward migrations refused')
    return [[migration.app_label, migration.name] for migration, _ in plan]


def capture(spec=None):
    """All public tables; a spec projects original columns and original seed rows."""
    from django.db import connection
    quote = connection.ops.quote_name
    result = {'schema': {}, 'tables': {}, 'sequences': {}, 'seed_keys': {}}
    with connection.cursor() as cursor:
        cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname")
        tables = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT table_name,column_name,udt_name,is_nullable,character_maximum_length,column_default,is_identity,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")
        result['schema']['columns'] = [list(row) for row in cursor.fetchall()]
        cursor.execute("SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname")
        result['schema']['constraints'] = [[table, name, canonical_constraint(table, name, definition)]
                                          for table, name, definition in cursor.fetchall()]
        cursor.execute("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")
        result['schema']['indexes'] = [[table, name, canonical_constraint(table, name, definition)]
                                      for table, name, definition in cursor.fetchall()]
        for table in tables:
            if table not in SEED_TABLES:
                continue
            cursor.execute("SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=%s::regclass AND i.indisprimary ORDER BY a.attnum", ['public.' + quote(table)])
            keys = [row[0] for row in cursor.fetchall()]
            if len(keys) != 1:
                raise RuntimeError('Expected one primary key for seed table: ' + table)
            key = keys[0]
            cursor.execute('SELECT ' + quote(key) + '::text FROM public.' + quote(table) + ' ORDER BY ' + quote(key) + '::text COLLATE "C"')
            values = [row[0] for row in cursor.fetchall()]
            cursor.execute('SELECT pg_get_serial_sequence(%s,%s)', ['public.' + quote(table), key])
            sequence = cursor.fetchone()[0]
            result['seed_keys'][table] = {'column': key, 'values': values,
                'sequence': sequence.rsplit('.', 1)[-1].strip('"') if sequence else None}
        projected_tables = sorted(spec['tables']) if spec is not None else tables
        for table in projected_tables:
            if table not in tables:
                raise RuntimeError('An existing table disappeared: ' + table)
            columns = spec['tables'][table]['columns'] if spec is not None else [row[1] for row in result['schema']['columns'] if row[0] == table]
            fields = ','.join(quote(name) for name in columns)
            clause, params = '', []
            if spec is not None and table in spec['seed_keys']:
                seed = spec['seed_keys'][table]
                clause, params = ' WHERE ' + quote(seed['column']) + '::text=ANY(%s)', [seed['values']]
            cursor.execute('SELECT md5(ROW(' + fields + ')::text) FROM public.' + quote(table) + clause + ' ORDER BY 1', params)
            digest, count = hashlib.sha256(), 0
            while True:
                rows = cursor.fetchmany(2000)
                if not rows:
                    break
                for (value,) in rows:
                    digest.update(value.encode('ascii'))
                    count += 1
            result['tables'][table] = {'columns': list(columns), 'rows': count, 'sha256': digest.hexdigest()}
        cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname")
        sequences = [row[0] for row in cursor.fetchall()]
        for name in sequences:
            cursor.execute('SELECT last_value,is_called FROM public.' + quote(name))
            last_value, is_called = cursor.fetchone()
            result['sequences'][name] = {'last_value': last_value, 'is_called': is_called}
    return result


def migrate_atomic(before, expected_schema=None, graph=None):
    """Fence existing tables; rollback all DDL/data if original-row checks fail."""
    from django.core.management import call_command
    from django.db import connection, transaction
    if graph is not None:
        require_graph(migration_graph(), graph)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout='15s'")
            cursor.execute("SET LOCAL statement_timeout='15min'")
            cursor.execute('LOCK TABLE ' + ','.join('public.' + connection.ops.quote_name(t) for t in sorted(before['tables'])) + ' IN ACCESS EXCLUSIVE MODE')
        if capture() != before:
            raise RuntimeError('Database changed before migration; no transition committed')
        plan = pending_plan()
        require_plan(plan, graph)
        if not plan:
            raise RuntimeError('Transition already applied; use the standard application updater')
        output = io.StringIO()
        call_command('migrate', interactive=False, verbosity=0, stdout=output, stderr=output)
        if pending_plan():
            raise RuntimeError('Pending migrations remain')
        require_preserved(before, capture(before))
        after = capture()
        if expected_schema is not None and after['schema'] != expected_schema:
            raise RuntimeError('Migrated schema differs from the tested restored copy')
    return after
