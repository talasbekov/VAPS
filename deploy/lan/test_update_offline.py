"""Safety checks for both integrated and separate Celery beat deployments."""
import importlib.util
import hashlib
import io
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
import subprocess
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('offline_update', Path(__file__).with_name('update-offline.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdateLifecycleTests(unittest.TestCase):
    def exercise(self, separate_beat, fail_at=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'images.env').write_text('BACKEND_IMAGE=old-backend\nFRONTEND_IMAGE=old-frontend\nPOSTGRES_IMAGE=unchanged\n')
            obj = updater.Update.__new__(updater.Update)
            obj.stack = root
            obj.base = ['docker', 'compose']
            obj.schedulers = ['beat'] if separate_beat else []
            obj.ids = {'db': 'db-id', 'worker': 'worker-id'}
            obj.db = {'Id': 'db-id', 'Mounts': [{'Name': 'original-volume'}]}
            obj.volume = 'original-volume'
            obj.new_backend = 'new-backend'
            obj.new_frontend = 'new-frontend'
            calls = []

            def run(command, **kwargs):
                calls.append(command)
                if 'migrate' in command and fail_at == 'migrate':
                    raise RuntimeError('migration failed')
                return '{}' if '-c' in command else ''

            def backup(folder, **kwargs):
                calls.append(['backup'])
                folder.mkdir()

            def clone(folder):
                if fail_at == 'rehearsal':
                    raise RuntimeError('rehearsal failed')
                (folder / 'verified-business-data.json').write_text('{}')
                (folder / 'migration-plan.json').write_text('[]')

            obj.backup = backup
            obj.clone_check = clone
            state = lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}
            with patch.object(updater, 'run', run), patch.object(updater, 'inspect', state):
                if fail_at:
                    with self.assertRaises(RuntimeError):
                        obj.apply(root / 'backup')
                else:
                    obj.apply(root / 'backup')
            result = root / 'backup/application.override.json'
            override = json.loads(result.read_text()) if result.exists() else None
            return calls, override

    def test_separate_beat_stops_before_backup_and_updates_after_worker(self):
        calls, override = self.exercise(True)
        stop_beat = calls.index(['docker', 'compose', 'stop', '-t', '120', 'beat'])
        stop_worker = calls.index(['docker', 'compose', 'stop', '-t', '600', 'worker'])
        self.assertLess(stop_beat, stop_worker)
        self.assertLess(stop_worker, calls.index(['backup']))
        self.assertEqual(override['services']['beat']['image'], 'new-backend')
        starts = [c for c in calls if 'up' in c]
        self.assertEqual(starts[0][-3:], ['backend', 'frontend', 'worker'])
        self.assertEqual(starts[1][-1], 'beat')
        self.assertTrue(all('--no-deps' in c and '--pull' in c and 'never' in c for c in starts))

    def test_integrated_beat_does_not_create_separate_service(self):
        calls, override = self.exercise(False)
        self.assertNotIn('beat', override['services'])
        self.assertFalse(any('beat' in c for c in calls))

    def test_rehearsal_failure_resumes_old_scheduler_without_live_migration(self):
        calls, _ = self.exercise(True, 'rehearsal')
        self.assertFalse(any('migrate' in c for c in calls))
        self.assertEqual(calls[-1], ['docker', 'compose', 'start', 'backend', 'frontend', 'worker', 'beat', 'proxy'])

    def test_live_failure_stops_scheduler_without_restoring_or_deleting_database(self):
        calls, _ = self.exercise(True, 'migrate')
        self.assertEqual(calls[-1], ['docker', 'compose', 'stop', '-t', '120', 'proxy', 'frontend', 'backend', 'beat', 'worker'])
        self.assertFalse(any('down' in c or 'pg_restore' in c or 'volume' in c for c in calls))


class PortableImageTests(unittest.TestCase):
    def test_exported_config_digest_is_derived_from_actual_config(self):
        config = b'{"architecture":"amd64","os":"linux"}'
        digest = hashlib.sha256(config).hexdigest()
        item = {'tag': 'test:release', 'id': 'sha256:index'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'images.tar'
            config_path = 'blobs/sha256/' + digest
            manifest = json.dumps([{'Config': config_path, 'RepoTags': [item['tag']]}]).encode()
            with tarfile.open(path, 'w') as tar:
                for name, data in [('manifest.json', manifest), (config_path, config)]:
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    tar.addfile(member, io.BytesIO(data))
            self.assertEqual(updater.exported_config_ids(path, {'backend': item}), {'backend': 'sha256:' + digest})

    def test_classic_docker_and_containerd_ids_are_accepted(self):
        item = {'tag': 'test:release', 'id': 'sha256:index'}
        for identity in ('sha256:index', 'sha256:config'):
            updater.verify_loaded_image({'Id': identity, 'Os': 'linux', 'Architecture': 'amd64'}, item, 'sha256:config')

    def test_wrong_identity_or_platform_is_rejected(self):
        item = {'tag': 'test:release', 'id': 'sha256:index'}
        for identity, arch in [('sha256:unrelated', 'amd64'), ('sha256:config', 'arm64')]:
            with self.assertRaises(RuntimeError):
                updater.verify_loaded_image({'Id': identity, 'Os': 'linux', 'Architecture': arch}, item, 'sha256:config')


class StackOwnershipTests(unittest.TestCase):
    def test_containerd_running_image_is_resolved_without_starting_probe(self):
        self.assertTrue(hasattr(updater, 'running_image_id'), 'Runnable running-image resolution is missing')
        for matching in (True, False):
            calls = []
            probe = {}
            container = {'Image': 'sha256:running-config', 'Config': {'Image': 'app:tag'}}
            def execute(cmd, **kwargs):
                calls.append(cmd)
                if cmd[:3] == ['docker', 'image', 'inspect']:
                    if cmd[-1] == 'sha256:running-config': raise RuntimeError('unknown config digest')
                    return json.dumps([{'Id': 'sha256:runnable-index'}])
                if cmd[1] == 'create':
                    marker = cmd[cmd.index('--label') + 1].split('=', 1)[1]
                    probe.update(Image='sha256:running-config' if matching else 'sha256:other-config',
                        Config={'Labels': {'sj-image-probe': marker}})
                    return 'owned-probe-id'
                if cmd[1:3] == ['rm', '-v']: return ''
                raise AssertionError(cmd)
            with patch.object(updater, 'run', execute), patch.object(updater, 'inspect', return_value=probe):
                if matching:
                    self.assertEqual(updater.running_image_id(container), 'sha256:runnable-index')
                else:
                    with self.assertRaises(RuntimeError): updater.running_image_id(container)
            self.assertFalse(any('start' in c or c[1] == 'run' for c in calls))
            self.assertEqual(calls[-1], ['docker', 'rm', '-v', 'owned-probe-id'])

    def test_legacy_cli_cannot_start_migration_workflow(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('update-offline.py')),
            '--mode', 'apply', '--stack', 'nonexistent'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('update.py', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_copied_stack_with_same_project_cannot_target_original_containers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, copied = root / 'live', root / 'copy'
            container = {'Config': {'Labels': {
                'com.docker.compose.project': 'live', 'com.docker.compose.service': 'db',
                'com.docker.compose.project.working_dir': str(original),
                'com.docker.compose.project.config_files': str(original / 'docker-compose.yml'),
            }}}
            self.assertTrue(hasattr(updater, 'validate_container_owner'), 'Updater has no running stack ownership validation')
            updater.validate_container_owner(container, original, 'live', 'db')
            with self.assertRaises(RuntimeError):
                updater.validate_container_owner(container, copied, 'live', 'db')
            with self.assertRaises(RuntimeError):
                updater.validate_container_owner(container, original, 'other', 'db')
            with self.assertRaises(RuntimeError):
                updater.validate_container_owner(container, original, 'live', 'backend')


if __name__ == '__main__':
    unittest.main()
