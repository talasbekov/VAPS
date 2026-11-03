"""Combat schema and exact bootstrap additions preserve every installed3380 row."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import tempfile
import hashlib
import json
import re
import sys
from types import SimpleNamespace
from datetime import datetime, timezone


def load(name):
    path = Path(__file__).with_name(name + '.py')
    assert path.is_file(), 'A guarded schema transition is missing'
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CheckRoundtripTests(unittest.TestCase):
    def setUp(self):
        self.checks = load('schema-transition-checks')
        self.assertTrue(callable(getattr(self.checks, 'canonical_constraint', None)),
                        'CHECK fingerprints must survive the proven PostgreSQL dump/restore rewrite')
        self.cases = [
            ('ops_dictionary_entries', 'chk_ops_dictionary_code', 'dictionary_code',
             ('SERVICE_DUTY_KINDS', 'RETURN_REASONS', 'POST_REQUIREMENTS', 'SEASONAL_CORRECTIONS',
              'JOURNAL_ENTRY_TYPES', 'POST_REQUIREMENT_GROUPS', 'PLACEMENT_ROLES',
              'EVENT_PARTICIPATION_KINDS', 'EVENT_GROUP_ROLES', 'PLACEMENT_SECTIONS')),
            ('ops_duty_record_supplements', 'chk_duty_supplement_source', 'source_type', ('DISPATCH', 'PLAN')),
            ('ops_duty_record_supplements', 'chk_duty_supplement_source', 'source_type', ('DISPATCH', 'PLAN', 'STATUS')),
        ]

    @staticmethod
    def forms(column, values):
        literals = ["'" + value + "'::character varying" for value in values]
        head = 'CHECK (((' + column + ')::text = ANY '
        original = head + '((ARRAY[' + ', '.join(literals) + '])::text[])))'
        restored = head + '(ARRAY[' + ', '.join('(' + value + ')::text' for value in literals) + '])))'
        return original, restored

    def test_production_and_current_release_definitions_survive_roundtrip(self):
        for table, name, column, values in self.cases:
            original, restored = self.forms(column, values)
            with self.subTest(table=table):
                self.assertNotEqual(original, restored)
                self.assertEqual(self.checks.canonical_constraint(table, name, original), restored)
                self.assertEqual(self.checks.canonical_constraint(table, name, restored), restored)

    def test_changed_allowed_values_still_compare_different(self):
        for table, name, column, values in self.cases:
            original, restored = self.forms(column, values)
            canonical = self.checks.canonical_constraint(table, name, original)
            for changed in (values[:-1], values + ('UNEXPECTED',), ('OTHER',) + values[1:], tuple(reversed(values))):
                for definition in self.forms(column, changed):
                    with self.subTest(table=table, changed=changed):
                        self.assertNotEqual(canonical, self.checks.canonical_constraint(table, name, definition))

    def test_other_constraints_and_columns_are_not_rewritten(self):
        for table, name, column, values in self.cases:
            original, _ = self.forms(column, values)
            for actual_table, actual_name, definition in (
                ('other_table', name, original), (table, 'other_check', original),
                (table, name, original.replace(column, 'other_column')),
            ):
                self.assertEqual(self.checks.canonical_constraint(actual_table, actual_name, definition), definition)

    def test_type_limits_nulls_flags_and_extra_logic_are_not_normalized(self):
        table, name, column, values = self.cases[1]
        original, _ = self.forms(column, values)
        for definition in (
            original + ' NOT VALID', original + ' NO INHERIT', original.replace(' = ANY ', ' <> ANY '),
            original.replace(' = ANY ', ' = ALL '), original.replace('character varying', 'character varying(3)'),
            original.replace("'PLAN'::character varying", 'NULL::character varying'),
            original.replace("'PLAN'::character varying", "lower('PLAN')::character varying"),
            original.replace("'PLAN'::character varying", "'plan'::character varying"),
            original[:-1] + ' OR true)',
        ):
            with self.subTest(definition=definition):
                self.assertEqual(self.checks.canonical_constraint(table, name, definition), definition)


class CurrentSchemaRoundtripTests(unittest.TestCase):
    def setUp(self):
        self.checks = load('schema-transition-checks')
        self.rows = json.loads((Path(__file__).parent / 'testdata/schema-cast-roundtrip.json').read_text())['rows']

    def test_all_observed_current_schema_forms_survive_postgresql_roundtrip(self):
        self.assertEqual(len(self.rows), 40)
        for row in self.rows:
            with self.subTest(kind=row['kind'], table=row['table'], name=row['name']):
                self.assertNotEqual(row['original'], row['restored'])
                self.assertEqual(self.checks.canonical_constraint(row['table'], row['name'], row['original']), row['restored'])
                self.assertEqual(self.checks.canonical_constraint(row['table'], row['name'], row['restored']), row['restored'])

    def test_actual_values_operators_and_predicates_remain_protected(self):
        for row in self.rows:
            original = row['original']
            canonical = self.checks.canonical_constraint(row['table'], row['name'], original)
            first = re.search(r"'[A-Z][A-Z0-9_]*'", original).group()
            for changed in (original.replace(first, "'UNEXPECTED_VALUE'", 1), original.replace(' = ANY ', ' <> ANY '),
                    original.replace(' = ANY ', ' = ALL '), original.replace('character varying', 'character varying(3)'),
                    original.replace('IS NULL', 'IS NOT NULL'), original.replace('period WITH &&', 'period WITH =')):
                if changed == original:
                    continue
                with self.subTest(kind=row['kind'], table=row['table'], changed=changed):
                    self.assertNotEqual(canonical, self.checks.canonical_constraint(row['table'], row['name'], changed))
            for table, name in (('unreviewed_table', row['name']), (row['table'], 'unreviewed_definition')):
                self.assertEqual(self.checks.canonical_constraint(table, name, original), original)

    def test_catalog_capture_normalizes_the_supporting_exclusion_index_too(self):
        row = next(row for row in self.rows if row['kind'] == 'indexes')
        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def execute(self, sql, *_):
                self.values = [(row['table'], row['name'], row['original'])] if 'FROM pg_indexes' in sql else []
            def fetchall(self): return self.values
        connection = SimpleNamespace(cursor=Cursor, ops=SimpleNamespace(quote_name=lambda name: '"' + name + '"'))
        with patch.dict(sys.modules, {'django.db': SimpleNamespace(connection=connection)}):
            captured = self.checks.capture()
        self.assertEqual(captured['schema']['indexes'], [[row['table'], row['name'], row['restored']]])


class PreservationTests(unittest.TestCase):
    def setUp(self):
        self.checks = load('schema-transition-checks')
        self.before = {'tables': {
            'employees': {'columns': ['id', 'external_id', 'birth_date'], 'rows': 2, 'sha256': 'original'},
            'ops_permissions': {'columns': ['code', 'name'], 'rows': 1, 'sha256': 'custom name'},
        }, 'seed_keys': {'ops_permissions': {'column': 'code', 'values': ['existing'], 'sequence': None},
                         'django_migrations': {'column': 'id', 'values': ['1'], 'sequence': 'django_migrations_id_seq'}},
            'sequences': {'employees_id_seq': {'last_value': 9007199254740993, 'is_called': True},
                          'django_migrations_id_seq': {'last_value': 300, 'is_called': True}}}

    def test_identical_original_projection_accepts_additive_metadata_sequence(self):
        after = copy.deepcopy(self.before)
        after['sequences']['django_migrations_id_seq']['last_value'] += 14
        after['sequences']['new_table_id_seq'] = {'last_value': 1, 'is_called': False}
        self.checks.require_preserved(self.before, after)

    def test_every_original_row_and_column_including_permissions_must_match(self):
        for table in self.before['tables']:
            for change in ('sha256', 'rows', 'columns'):
                after = copy.deepcopy(self.before)
                after['tables'][table][change] = 'changed'
                with self.subTest(table=table, change=change), self.assertRaises(RuntimeError):
                    self.checks.require_preserved(self.before, after)

    def test_removed_original_table_is_refused(self):
        after = copy.deepcopy(self.before)
        del after['tables']['employees']
        with self.assertRaises(RuntimeError):
            self.checks.require_preserved(self.before, after)

    def test_business_sequence_value_and_is_called_are_preserved(self):
        for key, value in [('last_value', 1), ('is_called', False)]:
            after = copy.deepcopy(self.before)
            after['sequences']['employees_id_seq'][key] = value
            with self.assertRaises(RuntimeError):
                self.checks.require_preserved(self.before, after)

    def test_added_assistant_fields_cannot_exempt_existing_keys_tasks_or_assignments(self):
        before = {'tables': {
            'ops_assistant_connection': {'columns': ['id', 'api_key'], 'rows': 1, 'sha256': 'original-key'},
            'ops_assistant_tasks': {'columns': ['id', 'payload'], 'rows': 1, 'sha256': 'original-task'},
            'ops_user_roles': {'columns': ['id', 'user_id', 'role_id'], 'rows': 1, 'sha256': 'original-assignment'},
        }, 'seed_keys': {}, 'sequences': {}}
        self.checks.require_preserved(before, copy.deepcopy(before))
        for table in before['tables']:
            for change in ('changed-row', 'removed-row', 'removed-column'):
                projected = copy.deepcopy(before)
                if change == 'changed-row':
                    projected['tables'][table]['sha256'] = 'changed'
                elif change == 'removed-row':
                    projected['tables'][table]['rows'] = 0
                else:
                    projected['tables'][table]['columns'].pop()
                with self.subTest(table=table, change=change), self.assertRaises(RuntimeError):
                    self.checks.require_preserved(before, projected)


class ApprovedPlanTests(unittest.TestCase):
    def test_only_ordered_subsets_of_the_current_reviewed_delta_are_accepted(self):
        checks = load('schema-transition-checks')
        checks.require_plan([list(item) for item in checks.APPROVED_PLAN])
        checks.require_plan([])
        checks.require_plan(checks.APPROVED_PLAN[:-1])
        checks.require_plan(checks.APPROVED_PLAN[1:])
        self.assertEqual(checks.APPROVED_PLAN, (
            ('operations', '0150_combat_day_planning'),
            ('operations', '0151_combat_owned_places'),
            ('operations', '0152_combat_day_permissions'),
            ('operations', '0153_combat_day_labels'),
            ('operations', '0154_combat_post_history_reference'),
            ('operations', '0155_combat_optional_event_lifecycle'),
            ('operations', '0156_security_post_locations')))
        for plan in (checks.APPROVED_PLAN * 2, list(checks.APPROVED_PLAN) + [('operations', '9999_other')],
                     list(reversed(checks.APPROVED_PLAN)), [('employees', '0005_employee_import_identity')],
                     [('operations', '0148_assistant_connection')], [('operations', '0155_merge_r7_combat')]):
            with self.subTest(plan=plan), self.assertRaises(RuntimeError):
                checks.require_plan(plan)

    def test_post_locations_only_has_no_seed_or_business_row_exceptions(self):
        checks = load('schema-transition-checks')
        plan = [('operations', '0156_security_post_locations')]
        before = {'tables': {'ops_security_posts': {'columns': ['id', 'name'], 'rows': 7, 'sha256': 'original'}},
                  'seed_keys': {}, 'sequences': {}}
        graph = {'order': [list(item) for item in checks.APPROVED_PLAN]}
        policy = checks.prepare_preservation(before, plan, graph)
        self.assertEqual(policy['spec'], before)
        self.assertEqual(policy['expected'], before)
        self.assertEqual(policy['sequences'], {})
        self.assertIsNone(policy['combat'])
        self.assertEqual(policy['empty_tables'], [])

    def test_no_role_or_business_permission_rows_are_exempted(self):
        checks = load('schema-transition-checks')
        self.assertEqual(checks.SEED_TABLES, {'django_migrations', 'django_content_type', 'auth_permission'})
        before = {'tables': {'ops_roles': {'columns': ['code', 'name', 'is_active'], 'rows': 1, 'sha256': 'original-custom-role'}},
                  'seed_keys': {}, 'sequences': {}}
        checks.require_preserved(before, copy.deepcopy(before))
        for field, value in [('sha256', 'existing-custom-role-overwritten'), ('rows', 2)]:
            changed = copy.deepcopy(before)
            changed['tables']['ops_roles'][field] = value
            with self.assertRaisesRegex(RuntimeError, 'existing table, row or original column changed'):
                checks.require_preserved(before, changed)


class CombatSeedTests(unittest.TestCase):
    """Only locked, missing bootstrap rows may be appended; old grants stay exact."""
    def setUp(self):
        self.checks = load('schema-transition-checks')
        self.seed = ('operations', '0152_combat_day_permissions')
        self.graph = {'nodes': [{'app': 'operations', 'name': self.seed[1],
            'sha256': 'ba596d829c203efde0064b3d688fdf40ecc2361cf48e73f5f43fcd182f02f0b9'}],
            'order': [list(self.seed)]}
        old = datetime(2020, 1, 1, tzinfo=timezone.utc)
        self.rows = {
            'permissions': [('duty.view', 'Custom view', None, True),
                            ('duty.manage', 'Custom management', None, True)],
            'roles': ['DUTY_OFFICER', 'DUTY_PLANNER', 'CUSTOM_ADMIN'],
            'grants': [(41, 'DUTY_OFFICER', 'duty.manage', 'admin', old, old),
                       (42, 'DUTY_PLANNER', 'duty.view', 'admin', old, old)],
            'divisions': [7],
            'types': [(9, None, 'OLD', 'Custom legacy', 'DAY', False, True, True, 'admin', old, old)],
        }
        self.before = {'tables': {
            'ops_permissions': {'columns': ['code', 'name', 'description', 'is_active'], 'rows': 2, 'sha256': 'permissions'},
            'ops_role_permissions': {'columns': ['id', 'role_code', 'permission_code', 'created_by', 'created_at', 'updated_at'], 'rows': 2, 'sha256': 'grants'},
            'ops_combat_duty_types': {'columns': ['id', 'duty_type_code', 'safe_label', 'supports_multiple_routes', 'created_by', 'created_at', 'updated_at'], 'rows': 1, 'sha256': 'types'},
            'ops_roles': {'columns': ['code'], 'rows': 3, 'sha256': 'roles'},
            'ops_user_roles': {'columns': ['id'], 'rows': 3, 'sha256': 'assignments'},
        }, 'seed_keys': {}, 'sequences': {
            'ops_role_permissions_id_seq': {'last_value': 42, 'is_called': True},
            'ops_combat_duty_types_id_seq': {'last_value': 9, 'is_called': True},
        }}

    def prepare(self, rows=None, before=None, plan=None):
        with patch.dict(sys.modules, {'django.db': SimpleNamespace(connection=object())}), \
             patch.object(self.checks, '_read_seed_state', return_value=copy.deepcopy(rows or self.rows), create=True), \
             patch.object(self.checks, '_seed_sequence', side_effect=lambda connection, table: table + '_id_seq', create=True):
            return self.checks.prepare_preservation(before or self.before, [self.seed] if plan is None else plan, self.graph)

    def added(self, policy):
        rows = copy.deepcopy(self.rows)
        stamp = policy['combat']['started_at']
        rows['permissions'] += [
            ('duty.roster', 'Формирование боевых групп своего подразделения', None, True),
            ('duty.catalog.manage', 'Справочники боевого дежурства своего подразделения', None, True),
            ('duty.combat.manage', 'Управление боевыми группами и приём состава штабом', None, True)]
        rows['grants'] += [(43, 'DUTY_PLANNER', 'duty.roster', None, stamp, stamp),
                           (44, 'DUTY_PLANNER', 'duty.catalog.manage', None, stamp, stamp),
                           (45, 'DUTY_OFFICER', 'duty.combat.manage', None, stamp, stamp)]
        rows['types'] += [(10, 7, 'DAY', 'Дневное', 'DAY', False, False, True, None, stamp, stamp),
                          (11, 7, 'NIGHT', 'Ночное', 'NIGHT', False, False, True, None, stamp, stamp),
                          (12, 7, 'DAILY', 'Суточное', 'DAILY', True, False, True, None, stamp, stamp)]
        after = copy.deepcopy(self.before)
        after['sequences']['ops_role_permissions_id_seq']['last_value'] = 45
        after['sequences']['ops_combat_duty_types_id_seq']['last_value'] = 12
        return rows, after

    def verify(self, policy, rows, after):
        with patch.dict(sys.modules, {'django.db': SimpleNamespace(connection=object())}), \
             patch.object(self.checks, '_read_seed_state', return_value=rows, create=True):
            return self.checks.require_transition_effects(policy, after)

    def test_exact_appends_preserve_all_old_keys_and_report_no_revokes(self):
        original = copy.deepcopy(self.before)
        policy = self.prepare()
        self.assertEqual(self.before, original)
        self.assertEqual(policy['expected'], original)
        self.assertEqual(policy['spec']['seed_keys']['ops_role_permissions']['values'], ['41', '42'])
        self.assertNotIn('ops_roles', policy['spec']['seed_keys'])
        self.assertNotIn('ops_user_roles', policy['spec']['seed_keys'])
        rows, after = self.added(policy)
        audit = self.verify(policy, rows, after)
        self.assertIsNone(audit['officer_permission'])
        self.assertEqual(audit['permissions']['inserted_count'], 3)
        self.assertEqual(audit['role_permissions']['inserted_count'], 3)
        self.assertEqual(audit['combat_types']['inserted_count'], 3)
        projected = copy.deepcopy(original)
        projected['sequences'] = after['sequences']
        self.checks.require_preserved(policy['expected'], projected, policy['sequences'])
        projected['tables']['ops_role_permissions']['sha256'] = 'officer-right-revoked'
        with self.assertRaises(RuntimeError):
            self.checks.require_preserved(policy['expected'], projected, policy['sequences'])

    def test_missing_unexpected_duplicate_and_changed_seed_rows_are_refused(self):
        policy = self.prepare()
        for table in ('permissions', 'grants', 'types'):
            for mutation in ('missing', 'unexpected', 'duplicate', 'changed'):
                rows, after = self.added(policy)
                if mutation == 'missing':
                    rows[table].pop()
                elif mutation == 'duplicate':
                    rows[table].append(rows[table][-1])
                elif mutation == 'unexpected':
                    row = list(rows[table][-1])
                    row[0] = 'unreviewed.permission' if table == 'permissions' else 999
                    if table != 'permissions':
                        row[1] = 'CUSTOM_ADMIN' if table == 'grants' else 999
                    rows[table].append(tuple(row))
                else:
                    row = list(rows[table][-1])
                    row[1 if table == 'permissions' else 3] = 'unexpected-value'
                    rows[table][-1] = tuple(row)
                with self.subTest(table=table, mutation=mutation), self.assertRaises(RuntimeError):
                    self.verify(policy, rows, after)

    def test_both_business_sequences_and_inserted_ids_are_exact(self):
        policy = self.prepare()
        for sequence in self.before['sequences']:
            for field, value in [('last_value', 500), ('is_called', False)]:
                rows, after = self.added(policy)
                after['sequences'][sequence][field] = value
                with self.subTest(sequence=sequence, field=field), self.assertRaises(RuntimeError):
                    self.verify(policy, rows, after)
        for table in ('grants', 'types'):
            rows, after = self.added(policy)
            row = list(rows[table][-1]); row[0] = 999
            rows[table][-1] = tuple(row)
            with self.subTest(table=table), self.assertRaises(RuntimeError):
                self.verify(policy, rows, after)

    def test_already_existing_custom_defaults_are_not_reseeded(self):
        policy = self.prepare()
        rows, after = self.added(policy)
        rows['permissions'][-1] = ('duty.combat.manage', 'Admin custom label', 'Keep description', False)
        type_row = list(rows['types'][-1]); type_row[3] = 'Admin custom daily'; type_row[7] = False
        rows['types'][-1] = tuple(type_row)
        before = copy.deepcopy(after)
        before['tables']['ops_combat_duty_types']['columns'] += ['division_id', 'shift_kind', 'rest_day_after', 'is_active']
        repeated = self.prepare(rows=rows, before=before)
        self.assertEqual(repeated['sequences'], after['sequences'])
        audit = self.verify(repeated, rows, after)
        self.assertEqual([audit[key]['inserted_count'] for key in ('permissions', 'role_permissions', 'combat_types')], [0, 0, 0])

    def test_schema_only_plan_cannot_exempt_business_rows_or_sequences(self):
        policy = self.prepare(plan=[])
        self.assertEqual(policy['spec'], self.before)
        self.assertEqual(policy['expected'], self.before)
        self.assertEqual(policy['sequences'], {})
        changed = copy.deepcopy(self.before)
        changed['tables']['ops_permissions']['rows'] += 1
        with self.assertRaises(RuntimeError):
            self.checks.require_preserved(policy['expected'], changed)

    def test_unreviewed_seed_source_is_refused(self):
        self.graph['nodes'][0]['sha256'] = 'a' * 64
        with self.assertRaisesRegex(RuntimeError, 'seed migration source'):
            self.prepare()

    def test_original_grant_deletion_and_legacy_new_column_backfill_are_refused(self):
        policy = self.prepare()
        for key in ('permissions', 'grants', 'types'):
            rows, after = self.added(policy)
            rows[key].pop(0)
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.verify(policy, rows, after)
        rows, after = self.added(policy)
        row = list(rows['types'][0]); row[1] = 7
        rows['types'][0] = tuple(row)
        with self.assertRaises(RuntimeError):
            self.verify(policy, rows, after)

    def test_missing_roles_and_eligible_divisions_do_not_gain_grants_or_types(self):
        original = copy.deepcopy(self.rows)
        original['roles'] = ['CUSTOM_ADMIN']
        original['divisions'] = []
        policy = self.prepare(rows=original)
        rows, _ = self.added(policy)
        rows['grants'] = original['grants']
        rows['types'] = original['types']
        after = copy.deepcopy(self.before)
        audit = self.verify(policy, rows, after)
        self.assertEqual(audit['role_permissions']['inserted_count'], 0)
        self.assertEqual(audit['combat_types']['inserted_count'], 0)
        self.assertEqual(policy['sequences'], self.before['sequences'])

    def test_unavailable_duty_view_is_not_created_or_granted(self):
        original = copy.deepcopy(self.rows)
        original['permissions'] = [row for row in original['permissions'] if row[0] != 'duty.view']
        original['grants'] = original['grants'][:1]
        policy = self.prepare(rows=original)
        rows, after = self.added(policy)
        rows['permissions'] = [row for row in rows['permissions'] if row[0] != 'duty.view']
        rows['grants'] = [row for row in rows['grants'] if row[2] != 'duty.view']
        audit = self.verify(policy, rows, after)
        self.assertEqual(audit['role_permissions']['inserted_count'], 3)

    def test_uncalled_sequence_consumes_its_current_value_first(self):
        original = copy.deepcopy(self.rows)
        original['grants'] = []
        original['types'] = []
        before = copy.deepcopy(self.before)
        before['sequences'] = {name: {'last_value': 1, 'is_called': False} for name in before['sequences']}
        policy = self.prepare(rows=original, before=before)
        self.assertEqual(policy['sequences'], {
            'ops_role_permissions_id_seq': {'last_value': 4, 'is_called': True},
            'ops_combat_duty_types_id_seq': {'last_value': 3, 'is_called': True}})

    def test_new_combat_tables_must_remain_empty_even_without_data_seed(self):
        schema = ('operations', '0150_combat_day_planning')
        self.graph['order'] = [list(schema)]
        policy = self.prepare(plan=[schema])
        after = copy.deepcopy(self.before)
        for table in ('ops_combat_groups', 'ops_combat_duty_members'):
            after['tables'][table] = {'rows': 0}
        self.verify(policy, {}, after)
        for table in ('ops_combat_groups', 'ops_combat_duty_members'):
            changed = copy.deepcopy(after)
            changed['tables'][table]['rows'] = 1
            with self.subTest(table=table), self.assertRaises(RuntimeError):
                self.verify(policy, {}, changed)

    def test_seed_pin_matches_the_actual_reviewed_migration(self):
        root = Path(__file__).resolve().parents[2]
        migration = root / 'PersonnelStatus/Personnel-Records/organization_management/apps/operations/migrations/0152_combat_day_permissions.py'
        self.assertEqual(hashlib.sha256(migration.read_bytes()).hexdigest(), self.checks.SEED_SOURCE_SHA256)

    def test_seed_timestamp_outside_the_transaction_window_is_refused(self):
        policy = self.prepare()
        for key in ('grants', 'types'):
            rows, after = self.added(policy)
            row = list(rows[key][-1]); row[-2] = datetime(2020, 1, 1, tzinfo=timezone.utc)
            rows[key][-1] = tuple(row)
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.verify(policy, rows, after)

    def test_sequence_reader_refuses_unowned_cached_incrementing_or_cycling_sequences(self):
        cursor = Mock()
        connection = SimpleNamespace(cursor=lambda: SimpleNamespace())
        class Context:
            def __enter__(self): return cursor
            def __exit__(self, *_): return False
        connection.cursor = Context
        for config in (('seq', 2, 1, False), ('seq', 1, 2, False), ('seq', 1, 1, True)):
            cursor.fetchone.side_effect = [('public.seq',), config]
            with self.subTest(config=config), self.assertRaises(RuntimeError):
                self.checks._seed_sequence(connection, 'ops_combat_duty_types')
        cursor.fetchone.side_effect = [(None,)]
        with self.assertRaises(RuntimeError):
            self.checks._seed_sequence(connection, 'ops_combat_duty_types')
        cursor.fetchone.side_effect = [('public.seq',), ('seq', 1, 1, False)]
        self.assertEqual(self.checks._seed_sequence(connection, 'ops_combat_duty_types'), 'seq')


class LifecycleTests(unittest.TestCase):
    def exercise(self, failure=None, plan=None):
        updater = load('update-with-migrations')
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'images.env').write_text('BACKEND_IMAGE=old\nFRONTEND_IMAGE=old-front\n')
            obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
            obj.stack, obj.base = root, ['docker', 'compose']
            obj.ids = {'db': 'db-id', 'worker': 'worker-id'}
            obj.db = {'Id': 'db-id', 'Mounts': [{'Name': 'original-volume'}]}
            obj.volume, obj.schedulers = 'original-volume', ['beat']
            obj.old_backend, obj.old_frontend = 'old-backend', 'old-front'
            obj.new_backend, obj.new_frontend = 'new-backend', 'new-front'
            obj.old_proxy, obj.new_proxy = 'old-proxy', 'new-proxy'
            obj.proxy_configuration_sha256 = None
            obj.manifest = {'source_revision': 'c' * 40}
            obj.require_transition = Mock(return_value=list(updater.checks.APPROVED_PLAN if plan is None else plan))
            obj.check_space = Mock()
            obj.wrap_image = Mock(side_effect=lambda value: value + '-no-migrations')
            obj.database_snapshot = Mock(return_value={'schema': {}})
            if failure == 'startup-mutation':
                obj.database_snapshot = Mock(side_effect=[{'schema': {}}, {'schema': {}}, {'schema': {'unexpected': True}}])
            obj.upload_snapshot = Mock(return_value={})
            obj.verify_database_identity = Mock()
            def backup(folder, **kwargs):
                folder.mkdir()
                events.append('backup')
            obj.backup = backup
            def rehearse(folder, before):
                events.append('rehearse')
                if failure == 'rehearse':
                    raise RuntimeError('Rehearsal refused')
                return {'snapshot': {'schema': {}}, 'transition_audit': {'officer_permission': None, 'role_permissions': {'inserted_count': 3}, 'combat_types': {'inserted_count': 3}}}
            obj.rehearse_transition = rehearse
            def migrate(before, schema):
                events.append('live-migrate')
                if failure == 'migrate':
                    raise RuntimeError('Docker attach interrupted while migrator may still run')
                return {'snapshot': {'schema': {}}, 'transition_audit': {'officer_permission': None, 'role_permissions': {'inserted_count': 3}, 'combat_types': {'inserted_count': 3}}}
            obj.migrate_live = migrate
            obj.set_images = Mock(side_effect=lambda *args: events.append('set-images'))
            def start():
                events.append('start-application')
                if failure == 'startup':
                    raise RuntimeError('New startup failed')
            obj.start_application = start
            obj.start_writers = Mock(side_effect=lambda: events.append('start-writers'))
            def run(command, **kwargs):
                events.append(command)
                return ''
            with patch.object(updater.base, 'run', side_effect=run), patch.object(updater.base, 'inspect', return_value={'State': {'ExitCode': 0}}):
                if failure:
                    with self.assertRaises(RuntimeError):
                        obj.apply_transition(root / 'backup')
                else:
                    obj.apply_transition(root / 'backup')
            recovery = (root / 'backup/RECOVERY_REQUIRED.json').is_file()
            rolled_back = (root / 'backup/ROLLED_BACK.json').is_file()
            success = (root / 'backup/SUCCESS.json').is_file()
            self.success_record = json.loads((root / 'backup/SUCCESS.json').read_text()) if success else None
            return events, obj.recovery_required, recovery, rolled_back, success

    def test_seed_audit_is_separate_from_raw_startup_snapshot_and_reports_exact_exception(self):
        self.exercise()
        self.assertTrue(self.success_record['all_other_original_rows_preserved'])
        self.assertTrue(self.success_record['reviewed_seed_effects_verified'])
        self.assertIsNone(self.success_record['transition_audit']['officer_permission'])
        self.assertEqual(self.success_record['transition_audit']['role_permissions']['inserted_count'], 3)
        self.assertNotIn('all_original_rows_and_columns_preserved', self.success_record)
        self.assertNotIn('business_sequences_preserved', self.success_record)

    def test_separate_beat_is_stopped_before_worker_backup_and_live_migration(self):
        events, recovery, _, _, success = self.exercise()
        stop = next(i for i, value in enumerate(events) if isinstance(value, list) and 'beat' in value)
        worker = next(i for i, value in enumerate(events) if isinstance(value, list) and value[-1] == 'worker')
        self.assertLess(stop, worker)
        self.assertLess(worker, events.index('backup'))
        self.assertLess(events.index('backup'), events.index('rehearse'))
        self.assertLess(events.index('rehearse'), events.index('live-migrate'))
        self.assertLess(events.index('live-migrate'), events.index('start-application'))
        self.assertFalse(recovery)
        self.assertTrue(success)

    def test_schema_only_remaining_transition_uses_the_same_backup_and_rehearsal_guards(self):
        events, recovery, _, _, success = self.exercise(plan=load('schema-transition-checks').APPROVED_PLAN[-2:])
        self.assertLess(events.index('backup'), events.index('rehearse'))
        self.assertLess(events.index('rehearse'), events.index('live-migrate'))
        self.assertLess(events.index('live-migrate'), events.index('start-writers'))
        self.assertFalse(recovery)
        self.assertTrue(success)

    def test_current_schema_routes_to_application_only_update(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.require_transition = Mock(return_value=[])
        obj.apply_without_database_changes = Mock(return_value='app-only')
        obj.rehearse_transition = Mock()
        self.assertEqual(obj.apply_transition(Path('unused')), 'app-only')
        obj.rehearse_transition.assert_not_called()
        obj.apply_without_database_changes.assert_called_once()

    def test_rehearsal_failure_never_migrates_live_and_resumes_original_application(self):
        events, recovery, _, rolled_back, success = self.exercise('rehearse')
        self.assertNotIn('live-migrate', events)
        self.assertIn('start-writers', events)
        self.assertFalse(recovery)
        self.assertTrue(rolled_back)
        self.assertFalse(success)

    def test_failure_after_migration_keeps_ingress_closed_and_lock_for_recovery(self):
        events, recovery, record, rolled_back, success = self.exercise('startup')
        self.assertIn('live-migrate', events)
        self.assertNotIn('start-writers', events)
        self.assertTrue(recovery and record)
        self.assertFalse(rolled_back or success)
        commands = [value for value in events if isinstance(value, list)]
        self.assertTrue(all('pg_restore' not in cmd and 'down' not in cmd for cmd in commands))

    def test_raw_startup_mutation_is_refused_even_when_seed_audit_passed(self):
        events, recovery, record, rolled_back, success = self.exercise('startup-mutation')
        self.assertIn('start-application', events)
        self.assertNotIn('start-writers', events)
        self.assertTrue(recovery and record)
        self.assertFalse(rolled_back or success)

    def test_unreviewed_plan_does_not_stop_services(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.services = {'backend': {}}
        obj.graph = {'order': [list(item) for item in updater.checks.APPROVED_PLAN]}
        obj.readonly = Mock(return_value=[['operations', '9999_other']])
        with patch.object(updater.base, 'run') as run:
            with self.assertRaises(RuntimeError):
                obj.apply_transition(Path('unused'))
            run.assert_not_called()

    def test_interrupted_live_migrator_never_reopens_original_app_on_unchanged_probe(self):
        events, recovery, record, rolled_back, success = self.exercise('migrate')
        self.assertIn('live-migrate', events)
        self.assertNotIn('start-writers', events)
        self.assertTrue(recovery and record)
        self.assertFalse(rolled_back or success)


class PackageIntegrityTests(unittest.TestCase):
    def exercise(self, change=None):
        updater = load('update-with-migrations')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = ('application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py',
                     'update-with-migrations.py', 'schema-transition-checks.py', 'compose-network-transition.py')
            for name in names:
                (root / name).write_text('reviewed ' + name, encoding='utf-8')
            images = {key: {'tag': 'smart/' + key, 'id': 'sha256:' + key, 'os': 'linux', 'architecture': 'amd64'}
                      for key in ('backend', 'frontend', 'proxy')}
            graph = {'format': 1, 'nodes': [{'app': app, 'name': name, 'sha256': 'a' * 64, 'dependencies': []}
                        for app, name in updater.checks.APPROVED_PLAN],
                     'order': [list(item) for item in updater.checks.APPROVED_PLAN], 'leaves': []}
            (root / 'migration-graph.json').write_text(json.dumps(graph), encoding='utf-8')
            (root / 'source-revision.txt').write_text('c' * 40 + '\n', encoding='utf-8')
            transition = {'source_revision': 'c' * 40, 'images': copy.deepcopy(images),
                          'policy': updater.checks.RELEASE_POLICY,
                          'reviewed_migrations': [list(item) for item in updater.checks.APPROVED_PLAN],
                          'graph_sha256': hashlib.sha256((root / 'migration-graph.json').read_bytes()).hexdigest(),
                          'files': {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                                    for name in ('update-with-migrations.py', 'schema-transition-checks.py',
                                                 'compose-network-transition.py')}}
            if change == 'old-plan':
                transition['reviewed_migrations'] = [list(item) for item in updater.checks.APPROVED_PLAN[:-1]]
            if change == 'old-policy':
                transition['policy'] = 'smart-20261024-ai-v2'
            if change == 'foreign-images':
                transition['images']['backend']['id'] = 'sha256:another-image'
            (root / 'schema-transition.json').write_text(json.dumps(transition), encoding='utf-8')
            obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
            obj.manifest = {'source_revision': 'c' * 40, 'images': images,
                            'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}}
            obj.new_backend = 'smart/backend'
            obj.prepare_network_transition = Mock()
            obj.new_proxy, obj.base = 'smart/proxy', ['docker', 'compose']
            obj.services = {'proxy': {'volumes': [
                {'type': 'volume', 'source': name, 'target': '/data/' + name, 'read_only': True}
                for name in ('static', 'media', 'private')]}}
            if change == 'old-source':
                obj.manifest['source_revision'] = '98d594db9f45efbac183f670f915ea92d2ebda01'
            if change == 'tampered-script':
                (root / 'update-with-migrations.py').write_text('changed', encoding='utf-8')
            if change == 'missing-transition-checksum':
                del obj.manifest['files']['schema-transition.json']
            proof = 'a' * 64 + '  /etc/nginx/nginx.conf\n'
            with patch.object(updater, 'HERE', root), patch.object(updater.base, 'run', return_value=proof) as run, \
                 patch.object(updater, 'run_json', return_value=graph), \
                 patch.object(updater.base, 'exported_config_ids', return_value={key: value['id'] for key, value in images.items()}), \
                 patch.object(updater.base, 'inspect', side_effect=lambda tag: next({'Id': v['id'], 'Architecture': 'amd64', 'Os': 'linux'} for v in images.values() if v['tag'] == tag)):
                if change:
                    with self.assertRaises(RuntimeError):
                        obj.load()
                else:
                    obj.load()
                self.assertEqual(run.call_count, 0 if change else 2)

    def test_complete_matching_package_accepts_already_loaded_images(self):
        self.exercise()

    def test_mixed_or_tampered_patch_is_refused_before_loading_images(self):
        for change in ('old-source', 'old-plan', 'old-policy', 'foreign-images', 'tampered-script', 'missing-transition-checksum'):
            with self.subTest(change=change):
                self.exercise(change)


if __name__ == '__main__':
    unittest.main()
