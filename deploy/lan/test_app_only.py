"""Application-only updates must preserve every database table and skip migrations."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('app_only_update', Path(__file__).with_name('update-app-only.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class ApplicationOnlyTests(unittest.TestCase):
    def test_repeat_update_reuses_valid_wrapper_without_retargeting_running_tag(self):
        obj = updater.ApplicationUpdate.__new__(updater.ApplicationUpdate)
        source = {'Id': 'sha256:base', 'Os': 'linux', 'Architecture': 'amd64',
            'RootFS': {'Layers': ['base-layer']}, 'Config': {'Entrypoint': ['/entrypoint.sh'], 'Cmd': ['gunicorn'], 'Labels': {}}}
        cached = {'Id': 'sha256:cached-immutable-index', 'Os': 'linux', 'Architecture': 'amd64',
            'RootFS': {'Layers': ['base-layer', 'entrypoint-layer']}, 'Config': {
                'Entrypoint': ['/bin/sh', '/sj-app-only-entrypoint.sh'], 'Cmd': ['gunicorn'],
                'Labels': {'smart-josparlau.app-only-entrypoint': hashlib.sha256(updater.ENTRYPOINT.encode()).hexdigest()}}}
        commands = []
        with patch.object(updater.base, 'inspect', side_effect=lambda ref: source if ref == 'source-image' else cached), patch.object(
                updater.base, 'run', side_effect=lambda cmd, **kw: commands.append(cmd) or ''):
            self.assertEqual(obj.wrap_image('source-image'), 'sha256:cached-immutable-index')
        self.assertEqual(commands, [], 'A repeat update must not rebuild or retag a running wrapper')

    def test_missing_archive_checksum_refuses_before_docker_load(self):
        obj = updater.ApplicationUpdate.__new__(updater.ApplicationUpdate)
        obj.manifest = {'files': {}, 'images': {}}
        with patch.object(updater.base, 'run', return_value='') as run:
            with self.assertRaises((RuntimeError, OSError)):
                obj.load()
        self.assertEqual(run.call_count, 0)

    def make_update(self, root, separate_beat=False):
        obj = updater.ApplicationUpdate.__new__(updater.ApplicationUpdate)
        obj.stack = root
        obj.base = ['docker', 'compose']
        obj.new_backend = 'new-backend'
        obj.new_frontend = 'new-frontend'
        obj.new_proxy = 'new-proxy'
        obj.old_backend = 'old-backend-id'
        obj.old_frontend = 'sha256:old-frontend-id'
        obj.old_proxy = 'sha256:old-proxy-id'
        obj.proxy_configuration_sha256 = None
        obj.schedulers = ['beat'] if separate_beat else []
        obj.ids = {'db': 'db-id', 'worker': 'worker-id'}
        obj.db = {'Id': 'db-id', 'Mounts': [{'Name': 'original-volume'}]}
        obj.volume = 'original-volume'
        obj.services = {'frontend': {'image': 'old-frontend'}}
        (root / 'images.env').write_text('BACKEND_IMAGE=old-backend\nFRONTEND_IMAGE=old-frontend\nPOSTGRES_IMAGE=original-postgres\n')
        obj.wrap_image = Mock(side_effect=lambda image: image + '-no-migrations')
        def backup(folder, **kwargs):
            folder.mkdir()
        obj.backup = Mock(side_effect=backup)
        obj.check_space = Mock()
        obj.clone_check = Mock(side_effect=lambda folder, **kw: json.loads((folder / 'database-before.json').read_text()))
        return obj

    def test_pending_migration_refuses_before_backup_or_service_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(return_value=[['employees', '0006_iin_format_validation']])
            original = (root / 'images.env').read_bytes()
            with patch.object(updater.base, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'schema migrations are required'):
                    obj.apply_without_database_changes(root / 'backup')
            run.assert_not_called()
            obj.backup.assert_not_called()
            obj.wrap_image.assert_not_called()
            self.assertEqual((root / 'images.env').read_bytes(), original)

    def test_probes_enforce_readonly_session_and_override_startup_entrypoint(self):
        with tempfile.TemporaryDirectory() as directory:
            obj = self.make_update(Path(directory))
            with patch.object(updater.base, 'run', return_value='[]') as run:
                self.assertEqual(obj.readonly(updater.base.PLAN), [])
            command = run.call_args.args[0]
            self.assertIn('PGOPTIONS=-c default_transaction_read_only=on', command)
            self.assertIn('SHOW transaction_read_only', command[-1])
            self.assertIn('--no-deps', command)
            self.assertEqual(command[command.index('--entrypoint') + 1], 'python')

    def test_custom_migrating_startup_is_refused_without_any_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            obj = self.make_update(Path(directory))
            obj.services['backend'] = {'entrypoint': ['sh', '-c', 'python manage.py migrate && exec gunicorn']}
            obj.readonly = Mock()
            with self.assertRaisesRegex(RuntimeError, 'Custom backend startup'):
                obj.require_current_schema()
            obj.readonly.assert_not_called()

    def test_success_checks_full_database_before_resuming_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root, separate_beat=True)
            snapshot = {'django_migrations': {'rows': 250}, 'ops_permissions': {'rows': 50}, '__schema__': [], '__sequences__': []}
            obj.readonly = Mock(side_effect=[[], [], snapshot, snapshot])
            calls = []
            def execute(command, **kwargs):
                calls.append(command)
                return ''
            with patch.object(updater.base, 'run', execute), patch.object(updater.base, 'inspect', side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
                obj.apply_without_database_changes(root / 'backup')
            success = json.loads((root / 'backup/SUCCESS.json').read_text())
            self.assertFalse(success['migrations_executed'])
            self.assertTrue(success['all_database_tables_schema_and_sequences_match'])
            self.assertIn('POSTGRES_IMAGE=original-postgres', (root / 'images.env').read_text())
            self.assertIn('BACKEND_IMAGE=new-backend-no-migrations', (root / 'images.env').read_text())
            ups = [command for command in calls if 'up' in command]
            self.assertEqual(ups[0][-2:], ['backend', 'frontend'])
            self.assertEqual(ups[1][-2:], ['worker', 'beat'])
            self.assertTrue(all('--no-deps' in command for command in ups))
            self.assertFalse(any('migrate' in command or 'pg_restore' in command or 'down' in command for command in calls))

    def test_health_failure_rolls_back_application_without_database_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(side_effect=[[], [], {}, {}, {}])
            calls = []
            failed = False
            def execute(command, **kwargs):
                nonlocal failed
                calls.append(command)
                if 'up' in command and command[-2:] == ['backend', 'frontend'] and not failed:
                    failed = True
                    raise RuntimeError('health failure')
                return ''
            with patch.object(updater.base, 'run', execute), patch.object(updater.base, 'inspect', side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
                with self.assertRaisesRegex(RuntimeError, 'health failure'):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertIn('BACKEND_IMAGE=old-backend-id-no-migrations', (root / 'images.env').read_text())
            self.assertIn('FRONTEND_IMAGE=sha256:old-frontend-id', (root / 'images.env').read_text())
            self.assertFalse(any('migrate' in command or 'pg_restore' in command or 'volume' in command for command in calls))
            self.assertFalse((root / 'backup/SUCCESS.json').exists())

    def test_corrupt_backup_never_starts_new_application(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(return_value=[])
            obj.clone_check.side_effect = RuntimeError('restore failed')
            with patch.object(updater.base, 'run', return_value=''), patch.object(
                    updater.base, 'inspect', side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
                with self.assertRaisesRegex(RuntimeError, 'restore failed'):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertNotIn('BACKEND_IMAGE=new-backend', (root / 'images.env').read_text())
            self.assertFalse((root / 'backup/SUCCESS.json').exists())

    def test_database_drift_keeps_ingress_and_writers_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(side_effect=[[], [], {'people': 2000}, {'people': 1999}])
            commands = []
            with patch.object(updater.base, 'run', side_effect=lambda cmd, **kw: commands.append(cmd) or ''), patch.object(
                    updater.base, 'inspect', side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
                with self.assertRaises(RuntimeError):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertFalse(any('start' in c or ('up' in c and 'worker' in c) for c in commands))
            self.assertTrue(obj.recovery_required)
            self.assertTrue((root / 'backup/RECOVERY_REQUIRED.json').exists())

    def test_insufficient_backup_or_docker_space_refuses_before_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(return_value=[])
            obj.check_space.side_effect = RuntimeError('Insufficient space')
            commands = []
            with patch.object(updater.base, 'run', side_effect=lambda cmd, **kw: commands.append(cmd) or ''), patch.object(
                    updater.base, 'inspect', side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
                with self.assertRaisesRegex(RuntimeError, 'Insufficient space'):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertEqual(commands, [])
            self.assertFalse((root / 'backup').exists())

    def test_failed_health_with_database_drift_refuses_rollback_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = self.make_update(root)
            obj.readonly = Mock(side_effect=[[], [], {'people': 2000}, {'people': 1999}])
            commands = []
            def execute(cmd, **kwargs):
                commands.append(cmd)
                if 'up' in cmd:
                    raise RuntimeError('health failed')
                return ''
            with patch.object(updater.base, 'run', execute), patch.object(updater.base, 'inspect', return_value={'State': {'ExitCode': 0}}):
                with self.assertRaises(RuntimeError):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertEqual(sum('up' in c for c in commands), 1)
            self.assertTrue(obj.recovery_required)

    def test_startup_does_not_run_migrate_and_static_collection_is_readonly(self):
        self.assertNotIn('manage.py migrate', updater.ENTRYPOINT)
        self.assertIn('PGOPTIONS="-c default_transaction_read_only=on" python manage.py collectstatic', updater.ENTRYPOINT)
        self.assertIn('exec "$@"', updater.ENTRYPOINT)

    def test_fingerprint_includes_migration_and_permission_tables(self):
        self.assertNotIn("skip={'django_migrations'", updater.FULL_FINGERPRINT)
        self.assertIn('skip=set()', updater.FULL_FINGERPRINT)
        self.assertIn('pg_sequences', updater.FULL_FINGERPRINT)
        compile(updater.FULL_FINGERPRINT, '<full-fingerprint>', 'exec')


if __name__ == '__main__':
    unittest.main()
