"""The reported September schema may advance without losing any existing row."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import tempfile
import hashlib
import json


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
        ]

    @staticmethod
    def forms(column, values):
        literals = ["'" + value + "'::character varying" for value in values]
        head = 'CHECK (((' + column + ')::text = ANY '
        original = head + '((ARRAY[' + ', '.join(literals) + '])::text[])))'
        restored = head + '(ARRAY[' + ', '.join('(' + value + ')::text' for value in literals) + '])))'
        return original, restored

    def test_exact_two_production_definitions_survive_roundtrip(self):
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


class ApprovedPlanTests(unittest.TestCase):
    def test_only_reviewed_full_or_access_plan_or_current_schema_is_accepted(self):
        checks = load('schema-transition-checks')
        self.assertEqual(checks.SOURCE_REVISION, '381c21f34cad4e58d9cf29d5ee56370072a128b3')
        self.assertEqual(len(checks.APPROVED_PLAN), 15)
        self.assertEqual(checks.ACCESS_PLAN, (('operations', '0144_workspace_and_digital_twin_access'),))
        checks.require_plan([list(item) for item in checks.APPROVED_PLAN])
        checks.require_plan([list(item) for item in checks.ACCESS_PLAN])
        checks.require_plan([])
        legacy = [item for item in checks.APPROVED_PLAN if item not in checks.ACCESS_PLAN]
        for plan in (legacy, checks.APPROVED_PLAN[:-1], checks.APPROVED_PLAN[1:],
                     checks.ACCESS_PLAN * 2, list(checks.APPROVED_PLAN) + [('operations', '9999_other')],
                     list(reversed(checks.APPROVED_PLAN)), [('employees', '0005_employee_import_identity')]):
            with self.subTest(plan=plan), self.assertRaises(RuntimeError):
                checks.require_plan(plan)

    def test_new_role_can_be_inserted_without_exempting_existing_role_values(self):
        checks = load('schema-transition-checks')
        self.assertIn('ops_roles', checks.SEED_TABLES)
        self.assertNotIn('ops_user_roles', checks.SEED_TABLES)
        before = {'tables': {'ops_roles': {'columns': ['code', 'name', 'is_active'], 'rows': 1, 'sha256': 'original-custom-role'}},
                  'seed_keys': {'ops_roles': {'column': 'code', 'values': ['CUSTOM'], 'sequence': None}}, 'sequences': {}}
        checks.require_preserved(before, copy.deepcopy(before))
        changed = copy.deepcopy(before)
        changed['tables']['ops_roles']['sha256'] = 'existing-custom-role-overwritten'
        with self.assertRaisesRegex(RuntimeError, 'existing table, row or original column changed'):
            checks.require_preserved(before, changed)


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
            obj.require_transition = Mock(return_value=list(updater.checks.APPROVED_PLAN if plan is None else plan))
            obj.check_space = Mock()
            obj.wrap_image = Mock(side_effect=lambda value: value + '-no-migrations')
            obj.database_snapshot = Mock(return_value={'schema': {}})
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
                return {'schema': {}}
            obj.rehearse_transition = rehearse
            def migrate(before, schema):
                events.append('live-migrate')
                if failure == 'migrate':
                    raise RuntimeError('Docker attach interrupted while migrator may still run')
                return {'schema': {}}
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
            return events, obj.recovery_required, recovery, rolled_back, success

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

    def test_access_only_transition_uses_the_same_backup_and_rehearsal_guards(self):
        events, recovery, _, _, success = self.exercise(plan=load('schema-transition-checks').ACCESS_PLAN)
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

    def test_unreviewed_plan_does_not_stop_services(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.services = {'backend': {}}
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
                     'update-with-migrations.py', 'schema-transition-checks.py')
            for name in names:
                (root / name).write_text('reviewed ' + name, encoding='utf-8')
            images = {key: {'tag': 'smart/' + key, 'id': 'sha256:' + key, 'os': 'linux', 'architecture': 'amd64'}
                      for key in ('backend', 'frontend')}
            transition = {'source_revision': updater.checks.SOURCE_REVISION, 'images': copy.deepcopy(images),
                          'plans': [[list(item) for item in plan] for plan in updater.checks.APPROVED_PLANS],
                          'files': {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                                    for name in ('update-with-migrations.py', 'schema-transition-checks.py')}}
            if change == 'old-plan':
                transition['plans'] = [list(updater.checks.APPROVED_PLAN[:-1])]
            if change == 'foreign-images':
                transition['images']['backend']['id'] = 'sha256:another-image'
            (root / 'schema-transition.json').write_text(json.dumps(transition), encoding='utf-8')
            obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
            obj.manifest = {'source_revision': updater.checks.SOURCE_REVISION, 'images': images,
                            'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}}
            if change == 'old-source':
                obj.manifest['source_revision'] = '98d594db9f45efbac183f670f915ea92d2ebda01'
            if change == 'tampered-script':
                (root / 'update-with-migrations.py').write_text('changed', encoding='utf-8')
            if change == 'missing-transition-checksum':
                del obj.manifest['files']['schema-transition.json']
            with patch.object(updater, 'HERE', root), patch.object(updater.base, 'run') as run, \
                 patch.object(updater.base, 'exported_config_ids', return_value={key: value['id'] for key, value in images.items()}), \
                 patch.object(updater.base, 'inspect', side_effect=lambda tag: next({'Id': v['id'], 'Architecture': 'amd64', 'Os': 'linux'} for v in images.values() if v['tag'] == tag)):
                if change:
                    with self.assertRaises(RuntimeError):
                        obj.load()
                else:
                    obj.load()
                run.assert_not_called()

    def test_complete_matching_package_accepts_already_loaded_images(self):
        self.exercise()

    def test_mixed_or_tampered_patch_is_refused_before_loading_images(self):
        for change in ('old-source', 'old-plan', 'foreign-images', 'tampered-script', 'missing-transition-checksum'):
            with self.subTest(change=change):
                self.exercise(change)


if __name__ == '__main__':
    unittest.main()
