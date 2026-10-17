"""Database evidence for the reviewed September/October -> 17 October transition.

Imported without Django by unit tests; the same source is executed inside the
verified backend image. No business row values are emitted, only checksums.
"""
import hashlib
import io
import json
import re

SOURCE_REVISION = '381c21f34cad4e58d9cf29d5ee56370072a128b3'
ACCESS_PLAN = (('operations', '0144_workspace_and_digital_twin_access'),)
APPROVED_PLAN = (
    ('employees', '0006_iin_format_validation'),
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
    ('statuses', '0005_employeestatus_duty_assignment'),
)
APPROVED_PLANS = ((), ACCESS_PLAN, APPROVED_PLAN)
# Only these reviewed migrations insert rows into existing tables. Existing
# rows in these tables remain protected by their original primary keys.
SEED_TABLES = frozenset({'django_migrations', 'django_content_type', 'auth_permission', 'ops_roles',
                        'ops_permissions', 'ops_role_permissions', 'ops_status_types', 'ops_dictionary_entries'})


def canonical_constraint(table, name, definition):
    """Match the proven lossless varchar[] -> text[] dump/restore rewrite.

    PostgreSQL deparses an IN check with an array cast before pg_dump, then
    distributes that cast over the array elements when pg_restore reparses it.
    Recognize only these two enum checks, their exact column/operator/shape,
    unbounded varchar casts and non-null uppercase literals. Preserve every
    literal and its order; leave every other definition byte-for-byte intact.
    """
    column = {
        ('ops_dictionary_entries', 'chk_ops_dictionary_code'): 'dictionary_code',
        ('ops_duty_record_supplements', 'chk_duty_supplement_source'): 'source_type',
    }.get((table, name))
    if column is None:
        return definition
    head = 'CHECK (((' + column + ')::text = ANY '
    prefix, suffix = head + '((ARRAY[', '])::text[])))'
    if not definition.startswith(prefix) or not definition.endswith(suffix):
        return definition
    literals = definition[len(prefix):-len(suffix)].split(', ')
    if not all(re.fullmatch(r"'[A-Z][A-Z0-9_]*'::character varying", value) for value in literals):
        return definition
    return head + '(ARRAY[' + ', '.join('(' + value + ')::text' for value in literals) + '])))'


def require_plan(plan):
    if tuple(map(tuple, plan)) not in APPROVED_PLANS:
        raise RuntimeError('Unreviewed migration plan; expected exactly access migration0144, '
                           'the reviewed September 15 migrations or an already current schema')


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
        result['schema']['indexes'] = [list(row) for row in cursor.fetchall()]
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


def migrate_atomic(before, expected_schema=None):
    """Fence existing tables; rollback all DDL/data if original-row checks fail."""
    from django.core.management import call_command
    from django.db import connection, transaction
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout='15s'")
            cursor.execute("SET LOCAL statement_timeout='15min'")
            cursor.execute('LOCK TABLE ' + ','.join('public.' + connection.ops.quote_name(t) for t in sorted(before['tables'])) + ' IN ACCESS EXCLUSIVE MODE')
        if capture() != before:
            raise RuntimeError('Database changed before migration; no transition committed')
        plan = pending_plan()
        require_plan(plan)
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
