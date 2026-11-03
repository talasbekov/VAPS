"""Database evidence for additive combat duty on the preserved3380 baseline.

Imported without Django by unit tests; the same source is executed inside the
verified backend image. No business row values are emitted, only checksums.
"""
import copy
import hashlib
import importlib
import io
import json
from pathlib import Path
import re
from datetime import datetime, timezone

RELEASE_POLICY = 'smart-20261102-base3380-post-maps-v1'
APPROVED_PLAN = (
    ('operations', '0150_combat_day_planning'),
    ('operations', '0151_combat_owned_places'),
    ('operations', '0152_combat_day_permissions'),
    ('operations', '0153_combat_day_labels'),
    ('operations', '0154_combat_post_history_reference'),
    ('operations', '0155_combat_optional_event_lifecycle'),
    ('operations', '0156_security_post_locations'),
)
# Django may append migration/content-type/permission metadata. Every existing
# application table, including complete role/permission tables, stays protected.
SEED_TABLES = frozenset({'django_migrations', 'django_content_type', 'auth_permission'})


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
        raise RuntimeError('Incomplete current migration graph; all reviewed combat and post-map additions are required')
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
                           'reviewed installed3380 combat delta are allowed')


def require_preserved(before, projected, expected_sequences=None):
    if before['tables'] != projected['tables']:
        raise RuntimeError('An existing table, row or original column changed; migration transaction refused')
    mutable = {item['sequence'] for item in before['seed_keys'].values() if item['sequence']}
    for name, state in before['sequences'].items():
        if name in (expected_sequences or {}):
            state = expected_sequences[name]
        elif name in mutable:
            continue
        if projected['sequences'].get(name) != state:
            raise RuntimeError('An existing business sequence changed: ' + name)


COMBAT_SEED = ('operations', '0152_combat_day_permissions')
SEED_SOURCE_SHA256 = 'ba596d829c203efde0064b3d688fdf40ecc2361cf48e73f5f43fcd182f02f0b9'
COMBAT_PERMISSIONS = {
    'duty.roster': 'Формирование боевых групп своего подразделения',
    'duty.catalog.manage': 'Справочники боевого дежурства своего подразделения',
    'duty.combat.manage': 'Управление боевыми группами и приём состава штабом',
}
COMBAT_ROLES = frozenset({'HEAD_DEPARTMENT_LINE', 'HEAD_DIRECTORATE_LINE',
                         'DIRECTORATE_HEAD', 'HEAD_OPS_UNIT', 'DUTY_PLANNER'})
COMBAT_DEFAULTS = {'DAY': ('Дневное', False), 'NIGHT': ('Ночное', False), 'DAILY': ('Суточное', True)}


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode('utf-8')).hexdigest()


def _read_seed_state(connection, type_columns=None):
    """Read locked rows; normalize only columns the reviewed schema adds."""
    with connection.cursor() as cursor:
        cursor.execute('SELECT code,name,description,is_active FROM public.ops_permissions ORDER BY code')
        permissions = cursor.fetchall()
        cursor.execute('SELECT id,role_code,permission_code,created_by,created_at,updated_at FROM public.ops_role_permissions ORDER BY id')
        grants = cursor.fetchall()
        cursor.execute('SELECT code FROM public.ops_roles ORDER BY code')
        roles = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT id FROM public.divisions WHERE is_active AND division_type IN ('department','directorate') ORDER BY id")
        divisions = [row[0] for row in cursor.fetchall()]
        defaults = {'division_id': 'NULL', 'shift_kind': "'DAY'", 'rest_day_after': 'FALSE', 'is_active': 'TRUE'}
        names = ('id', 'division_id', 'duty_type_code', 'safe_label', 'shift_kind', 'rest_day_after',
                 'supports_multiple_routes', 'is_active', 'created_by', 'created_at', 'updated_at')
        fields = [defaults[name] if type_columns is not None and name not in type_columns and name in defaults
                  else connection.ops.quote_name(name) for name in names]
        cursor.execute('SELECT ' + ','.join(fields) + ' FROM public.ops_combat_duty_types ORDER BY id')
        return {'permissions': permissions, 'grants': grants, 'roles': roles,
                'divisions': divisions, 'types': cursor.fetchall()}


def _seed_sequence(connection, table):
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_get_serial_sequence(%s,%s)', ['public.' + table, 'id'])
        owned = cursor.fetchone()[0]
        if not owned:
            raise RuntimeError('Seed table requires an owned sequence: ' + table)
        cursor.execute('SELECT c.relname,s.seqincrement,s.seqcache,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid WHERE s.seqrelid=%s::regclass', [owned])
        name, increment, cache, cycle = cursor.fetchone()
        if (increment, cache, cycle) != (1, 1, False):
            raise RuntimeError('Unsupported seed sequence configuration: ' + table)
        return name


def prepare_preservation(before, plan, graph):
    """Allow only missing bootstrap rows, without exempting any original PK."""
    require_plan(plan, graph)
    pending = set(map(tuple, plan))
    policy = {'spec': copy.deepcopy(before), 'expected': copy.deepcopy(before),
              'sequences': {}, 'officer': None, 'combat': None,
              'empty_tables': [table for table, migration in (
                  ('ops_combat_groups', APPROVED_PLAN[0]),
                  ('ops_combat_duty_members', APPROVED_PLAN[0]),
                  ('ops_combat_places', APPROVED_PLAN[1]))
                  if migration in pending and table not in before['tables']]}
    if COMBAT_SEED not in pending:
        return policy
    sources = {(node['app'], node['name']): node['sha256'] for node in graph['nodes']}
    if sources.get(COMBAT_SEED) != SEED_SOURCE_SHA256:
        raise RuntimeError('Unreviewed seed migration source: ' + COMBAT_SEED[1])
    from django.db import connection
    rows = _read_seed_state(connection, before['tables']['ops_combat_duty_types']['columns'])
    permissions = {row[0] for row in rows['permissions']}
    permitted = permissions | COMBAT_PERMISSIONS.keys()
    grants = {(role, code) for role in rows['roles'] if role in COMBAT_ROLES
              for code in ('duty.view', 'duty.roster', 'duty.catalog.manage') if code in permitted}
    if 'DUTY_OFFICER' in rows['roles']:
        grants.add(('DUTY_OFFICER', 'duty.combat.manage'))
    expected = {'permissions': set(COMBAT_PERMISSIONS) - permissions,
                'grants': grants - {(row[1], row[2]) for row in rows['grants']},
                'types': {(division, code) for division in rows['divisions'] for code in COMBAT_DEFAULTS}
                         - {(row[1], row[2]) for row in rows['types']}}
    combat = {'original': rows, 'expected': expected, 'started_at': datetime.now(timezone.utc),
              'sequence_names': {}, 'inserted_ids': {}}
    for key, table, column in (('permissions', 'ops_permissions', 'code'),
                               ('grants', 'ops_role_permissions', 'id'),
                               ('types', 'ops_combat_duty_types', 'id')):
        sequence = None
        if column == 'id':
            sequence = _seed_sequence(connection, table)
            state = copy.deepcopy(before['sequences'][sequence])
            count = len(expected[key])
            first = state['last_value'] + int(state['is_called'])
            combat['inserted_ids'][key] = set(range(first, first + count))
            if count:
                state = {'last_value': first + count - 1, 'is_called': True}
            policy['sequences'][sequence] = state
            combat['sequence_names'][key] = sequence
        policy['spec']['seed_keys'][table] = {
            'column': column, 'values': [str(row[0]) for row in rows[key]], 'sequence': sequence}
    policy['combat'] = combat
    return policy


def require_transition_effects(policy, after):
    """Check exact additions, original grant retention and both sequence states."""
    audit = {'officer_permission': None, 'permissions': None, 'role_permissions': None, 'combat_types': None}
    for table in policy.get('empty_tables', []):
        if table not in after['tables'] or after['tables'][table]['rows'] != 0:
            raise RuntimeError('New combat table must be empty: ' + table)
    combat = policy['combat']
    if combat is None:
        return audit
    from django.db import connection
    rows = _read_seed_state(connection)
    ended_at = datetime.now(timezone.utc)
    for key, audit_key in (('permissions', 'permissions'), ('grants', 'role_permissions'), ('types', 'combat_types')):
        original = {row[0]: tuple(row) for row in combat['original'][key]}
        actual = {row[0]: tuple(row) for row in rows[key]}
        if len(actual) != len(rows[key]) or any(actual.get(pk) != row for pk, row in original.items()):
            raise RuntimeError('An original seed row changed or disappeared: ' + key)
        appended = [row for row in rows[key] if row[0] not in original]
        keys = [row[0] if key == 'permissions' else (row[1], row[2]) for row in appended]
        if len(keys) != len(combat['expected'][key]) or set(keys) != combat['expected'][key]:
            raise RuntimeError('Unexpected or missing seed rows: ' + key)
        for row in appended:
            if key == 'permissions':
                if tuple(row) != (row[0], COMBAT_PERMISSIONS[row[0]], None, True):
                    raise RuntimeError('Unexpected permission defaults')
            else:
                creator, created, updated = row[-3:]
                if (creator is not None or created is None or updated is None
                        or not combat['started_at'] <= created <= updated <= ended_at):
                    raise RuntimeError('Unexpected seed creator or timestamps: ' + key)
                if key == 'types':
                    _, _, code, label, kind, rest, routes, active, *_ = row
                    if ((label, rest) != COMBAT_DEFAULTS[code] or kind != code
                            or routes is not False or active is not True):
                        raise RuntimeError('Unexpected combat type defaults')
        if key != 'permissions':
            sequence = combat['sequence_names'][key]
            if ({row[0] for row in appended} != combat['inserted_ids'][key]
                    or after['sequences'].get(sequence) != policy['sequences'][sequence]):
                raise RuntimeError('Unexpected seed sequence advancement or inserted IDs: ' + key)
        audit[audit_key] = {'migration': list(COMBAT_SEED), 'source_sha256': SEED_SOURCE_SHA256,
                            'original_count': len(original), 'inserted_count': len(appended),
                            'expected_keys_sha256': _digest(sorted(combat['expected'][key])),
                            'inserted_rows_sha256': _digest(appended)}
        if key != 'permissions':
            audit[audit_key]['sequence'] = sequence
            audit[audit_key]['sequence_after'] = after['sequences'][sequence]
    return audit


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
    actual_graph = migration_graph()
    graph = actual_graph if graph is None else graph
    require_graph(actual_graph, graph)
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
        policy = prepare_preservation(before, plan, graph)
        output = io.StringIO()
        call_command('migrate', interactive=False, verbosity=0, stdout=output, stderr=output)
        if pending_plan():
            raise RuntimeError('Pending migrations remain')
        require_preserved(policy['expected'], capture(policy['spec']), policy['sequences'])
        after = capture()
        audit = require_transition_effects(policy, after)
        if expected_schema is not None and after['schema'] != expected_schema:
            raise RuntimeError('Migrated schema differs from the tested restored copy')
    return {'snapshot': after, 'transition_audit': audit}
