"""Persistent egress must preserve installed Compose bytes and fail before downtime."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
LEGACY = b'''name: network-review
x-backend: &backend
  image: backend:installed
  environment:
    DJANGO_SECRET_KEY: keep-this-server-value
services:
  backend:
    <<: *backend
    # Keep server settings and comments exactly.
    restart: unless-stopped
  worker:
    <<: *backend
    command: [celery, worker]
  proxy:
    image: proxy:installed
    networks: [default, ingress]
networks:
  default: {internal: true}
  ingress: {driver: bridge}
'''
EXPECTED = LEGACY.replace(b'  backend:\n', b'  backend:\n    networks: [default, ingress]\n').replace(
    b'  worker:\n', b'  worker:\n    networks: [default, ingress]\n')


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class ComposeFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.available = shutil.which('docker') and subprocess.run(
            ['docker', 'compose', 'version'], capture_output=True).returncode == 0

    def setUp(self):
        self.assertTrue((HERE / 'compose-network-transition.py').exists(),
                        'The updater has no durable installed-Compose network transition')
        self.helper = load('compose-network-transition')
        if not self.available:
            self.skipTest('Docker Compose CLI is required; no Docker daemon is used')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / 'docker-compose.yml'
        self.path.write_bytes(LEGACY)
        self.path.chmod(0o640)

    def render(self, raw):
        result = subprocess.run(['docker', 'compose', '--project-directory', str(self.root),
            '-f', '-', 'config', '--format', 'json'], input=raw, capture_output=True)
        if result.returncode:
            raise RuntimeError('Compose rejected candidate')
        return json.loads(result.stdout)

    def plan(self, raw=LEGACY, render=None):
        self.path.write_bytes(raw)
        return self.helper.NetworkTransition(self.path, self.render(raw), render or self.render)

    def backup(self, raw=LEGACY):
        folder = self.root / 'backup'
        folder.mkdir(mode=0o700)
        (folder / 'docker-compose.yml').write_bytes(raw)
        (folder / 'docker-compose.yml').chmod(0o600)
        return folder


class NetworkTransitionTests(ComposeFixture):
    def test_old_compose_gets_only_two_persistent_network_connections(self):
        plan = self.plan()
        self.assertEqual(plan.updated, EXPECTED)
        self.assertEqual(self.path.read_bytes(), LEGACY, 'Planning must be read-only')
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['docker-compose.yml'])
        before = self.render(LEGACY)
        after = self.render(plan.updated)
        for name in ('backend', 'worker'):
            self.assertEqual(after['services'][name]['networks'], {'default': None, 'ingress': None})
            before['services'][name]['networks']['ingress'] = None
        self.assertEqual(before, after)

    def test_current_compose_is_a_byte_exact_noop(self):
        raw = EXPECTED.replace(b'\n', b'\r\n')
        plan = self.plan(raw)
        self.assertEqual(plan.updated, raw)
        inode = self.path.stat().st_ino
        plan.apply(self.backup(raw))
        self.assertEqual(self.path.read_bytes(), raw)
        self.assertEqual(self.path.stat().st_ino, inode)

    def test_existing_backend_network_does_not_hide_legacy_worker(self):
        raw = LEGACY.replace(b'  backend:\n', b'  backend:\n    networks: [default, ingress]\n')
        self.assertEqual(self.plan(raw).updated, EXPECTED)

    def test_explicit_default_list_preserves_comment_and_line_endings(self):
        raw = LEGACY.replace(b'  worker:\n', b'  worker:\n    networks: [default] # server comment\n').replace(b'\n', b'\r\n')
        expected = EXPECTED.replace(b'  worker:\n    networks: [default, ingress]\n',
            b'  worker:\n    networks: [default, ingress] # server comment\n').replace(b'\n', b'\r\n')
        self.assertEqual(self.plan(raw).updated, expected)

    def test_unsupported_topology_or_target_syntax_is_rejected_without_writes(self):
        cases = (
            LEGACY.replace(b'default: {internal: true}', b'default: {driver: bridge}'),
            LEGACY.replace(b'ingress: {driver: bridge}', b'ingress: {internal: true}'),
            LEGACY.replace(b'ingress: {driver: bridge}', b'ingress: {driver: bridge, driver_opts: {com.docker.network.bridge.enable_ip_masquerade: "false"}}'),
            LEGACY.replace(b'  worker:\n', b'  worker:\n    networks: {default: {aliases: [jobs]}}\n'),
            LEGACY.replace(b'  worker:\n', b'  worker: &jobs\n'),
        )
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                self.plan(raw)
            self.assertEqual(self.path.read_bytes(), raw)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['docker-compose.yml'])

    def test_semantic_drift_outside_networks_is_rejected(self):
        def changed(raw):
            value = self.render(raw)
            value['services']['backend']['environment']['DJANGO_SECRET_KEY'] = 'unexpected'
            return value
        with self.assertRaisesRegex(RuntimeError, 'settings'):
            self.plan(render=changed)
        self.assertEqual(self.path.read_bytes(), LEGACY)

    def test_apply_requires_exact_original_backup_and_preserves_file_permissions(self):
        plan = self.plan()
        folder = self.backup()
        before = self.path.stat()
        plan.apply(folder)
        self.assertEqual(self.path.read_bytes(), EXPECTED)
        self.assertEqual((folder / 'docker-compose.yml').read_bytes(), LEGACY)
        after = self.path.stat()
        self.assertEqual((stat.S_IMODE(after.st_mode), after.st_uid, after.st_gid),
                         (stat.S_IMODE(before.st_mode), before.st_uid, before.st_gid))
        report = json.loads((folder / 'compose-network-transition.json').read_text())
        self.assertEqual(report['changed_services'], ['backend', 'worker'])
        self.assertNotIn('keep-this-server-value', json.dumps(report))
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE((folder / 'compose-network-transition.json').stat().st_mode), 0o600)

    def test_missing_or_mismatched_backup_never_changes_compose(self):
        plan = self.plan()
        with self.assertRaises((RuntimeError, OSError)):
            plan.apply(self.root / 'missing')
        folder = self.backup(b'wrong backup')
        with self.assertRaises(RuntimeError):
            plan.apply(folder)
        self.assertEqual(self.path.read_bytes(), LEGACY)

    def test_configuration_changed_after_preflight_is_refused(self):
        plan = self.plan()
        self.path.write_bytes(LEGACY + b'# operator edit\n')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            plan.require_original()
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            plan.apply(self.backup())
        self.assertEqual(self.path.read_bytes(), LEGACY + b'# operator edit\n')

    def test_safe_rollback_restores_original_bytes_and_permissions(self):
        plan = self.plan()
        before = self.path.stat()
        plan.apply(self.backup())
        plan.rollback()
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), stat.S_IMODE(before.st_mode))

    def test_operator_change_after_apply_is_not_overwritten_by_rollback(self):
        plan = self.plan()
        plan.apply(self.backup())
        altered = EXPECTED + b'# new operator configuration\n'
        self.path.write_bytes(altered)
        with self.assertRaises(RuntimeError):
            plan.rollback()
        self.assertEqual(self.path.read_bytes(), altered)

    def test_failed_atomic_replace_keeps_original_and_removes_own_temporary_file(self):
        plan = self.plan()
        with patch.object(self.helper.os, 'replace', side_effect=OSError('read-only destination')):
            with self.assertRaises(OSError):
                plan.apply(self.backup())
        plan.rollback()
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['backup', 'docker-compose.yml'])

    def test_utf8_bom_survives_minimum_patch(self):
        self.assertEqual(self.plan(b'\xef\xbb\xbf' + LEGACY).updated, b'\xef\xbb\xbf' + EXPECTED)

    def test_duplicate_network_keys_and_anchor_lists_are_refused(self):
        for networks in (b'    networks: [default]\n    networks: [default]\n',
                         b'    networks: &worker-networks [default]\n',
                         b'    networks:\n      - default\n'):
            raw = LEGACY.replace(b'  worker:\n', b'  worker:\n' + networks)
            with self.subTest(networks=networks), self.assertRaises(RuntimeError):
                self.plan(raw)
            self.assertEqual(self.path.read_bytes(), raw)

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink ownership is verified on Linux')
    def test_symlink_compose_is_rejected(self):
        target = self.root / 'target.yml'
        self.path.rename(target)
        self.path.symlink_to(target)
        with self.assertRaises(RuntimeError):
            self.helper.NetworkTransition(self.path, self.render(LEGACY), self.render)


class LifecycleNetworkTests(ComposeFixture):
    def exercise(self, *, pending=False, failure=None):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.stack, obj.base = self.root, ['docker', 'compose']
        obj.ids = {'db': 'db-id', 'worker': 'worker-id'}
        obj.db = {'Id': 'db-id', 'Mounts': [{'Name': 'original-volume'}]}
        obj.volume, obj.schedulers = 'original-volume', []
        obj.old_backend, obj.old_frontend, obj.old_proxy = 'old-backend', 'old-front', 'old-proxy'
        obj.new_backend, obj.new_frontend, obj.new_proxy = 'new-backend', 'new-front', 'new-proxy'
        obj.proxy_configuration_sha256 = None
        obj.manifest = {'source_revision': 'c' * 40}
        obj.network_transition = self.plan()
        if failure == 'network-write':
            obj.network_transition._replace = Mock(side_effect=RuntimeError('network file write failed'))
        obj.require_transition = Mock(return_value=list(updater.checks.APPROVED_PLAN) if pending else [])
        obj.require_current_schema = Mock(return_value=[])
        obj.check_space = Mock()
        obj.wrap_image = Mock(side_effect=lambda value: value + '-no-migrations')
        obj.database_snapshot = Mock(return_value={})
        obj.upload_snapshot = Mock(return_value={})
        obj.verify_database_identity = Mock()
        obj.readonly = Mock(return_value={})
        events = []
        (self.root / 'images.env').write_bytes(b'BACKEND_IMAGE=old-backend\nFRONTEND_IMAGE=old-front\n')
        def backup(folder, **kwargs):
            folder.mkdir(mode=0o700)
            (folder / 'docker-compose.yml').write_bytes(self.path.read_bytes())
            events.append('backup')
        obj.backup = backup
        def rehearse(*args, **kwargs):
            events.append('rehearsal')
            if failure == 'rehearsal':
                raise RuntimeError('rehearsal failed')
            return {'schema': {}} if pending else {}
        obj.rehearse_transition = obj.clone_check = rehearse
        def migrate(*args, **kwargs):
            events.append('migration')
            self.assertEqual(self.path.read_bytes(), EXPECTED)
            if failure == 'migration':
                raise RuntimeError('migration interrupted')
            return {}
        obj.migrate_live = migrate
        if failure == 'drift':
            self.path.write_bytes(LEGACY + b'# operator edit\n')
        startup_bytes = []
        def run(command, **kwargs):
            events.append(command)
            if 'up' in command and command[-2:] == ['backend', 'frontend']:
                startup_bytes.append(self.path.read_bytes())
                if failure == 'startup' and len(startup_bytes) == 1:
                    raise RuntimeError('startup failed')
            return ''
        with patch.object(updater.base, 'run', side_effect=run), patch.object(updater.base, 'inspect',
                side_effect=lambda cid: obj.db if cid == 'db-id' else {'State': {'ExitCode': 0}}):
            if failure:
                with self.assertRaises(RuntimeError):
                    obj.apply_transition(self.root / 'backup')
            else:
                obj.apply_transition(self.root / 'backup')
        return obj, events, startup_bytes

    def test_no_pending_migrations_still_persist_worker_egress_before_startup(self):
        obj, events, startup = self.exercise()
        self.assertEqual(startup, [EXPECTED])
        self.assertEqual(self.path.read_bytes(), EXPECTED)
        self.assertEqual((self.root / 'backup/docker-compose.yml').read_bytes(), LEGACY)
        self.assertNotIn('migration', events)
        self.assertFalse(obj.recovery_required)

    def test_pending_migrations_use_same_backed_up_transition(self):
        obj, events, startup = self.exercise(pending=True)
        self.assertEqual(startup, [EXPECTED])
        self.assertLess(events.index('rehearsal'), events.index('migration'))
        self.assertEqual((self.root / 'backup/docker-compose.yml').read_bytes(), LEGACY)
        self.assertFalse(obj.recovery_required)

    def test_preflight_drift_never_stops_any_service(self):
        obj, events, startup = self.exercise(pending=True, failure='drift')
        self.assertEqual(events, [])
        self.assertFalse((self.root / 'backup').exists())
        self.assertFalse(obj.recovery_required)

    def test_health_failure_without_database_changes_restores_original_compose(self):
        obj, events, startup = self.exercise(failure='startup')
        self.assertEqual(startup, [EXPECTED, LEGACY])
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertTrue((self.root / 'backup/ROLLED_BACK.json').exists())
        self.assertFalse(obj.recovery_required)

    def test_rehearsal_failure_never_patches_compose(self):
        obj, events, startup = self.exercise(pending=True, failure='rehearsal')
        self.assertEqual(startup, [LEGACY])
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertNotIn('migration', events)
        self.assertFalse(obj.recovery_required)

    def test_interrupted_migration_retains_config_and_fails_closed(self):
        obj, events, startup = self.exercise(pending=True, failure='migration')
        self.assertEqual(startup, [])
        self.assertEqual(self.path.read_bytes(), EXPECTED)
        self.assertTrue(obj.recovery_required)
        self.assertTrue((self.root / 'backup/RECOVERY_REQUIRED.json').exists())
        self.assertFalse(any('up' in command for command in events if isinstance(command, list)))

    def test_network_write_failure_rolls_back_before_attempting_live_migration(self):
        obj, events, startup = self.exercise(pending=True, failure='network-write')
        self.assertEqual(startup, [LEGACY])
        self.assertNotIn('migration', events)
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertFalse(obj.recovery_required)

    def test_check_only_verifies_candidate_without_changing_stack_files(self):
        updater = load('update-with-migrations')
        case = self
        class CheckUpdate(updater.TransitionUpdate):
            def __init__(self, args):
                self.stack = args.stack
                self.config = case.render(case.path.read_bytes())
                self.base = ['docker', 'compose', '--project-directory', str(args.stack),
                             '-f', str(args.stack / 'docker-compose.yml')]
            def load(self):
                self.prepare_network_transition()
            def require_transition(self):
                return []
        commands = []
        def run(command, **kwargs):
            commands.append(command)
            if command[:2] == ['docker', 'info']:
                return 'linux/amd64'
            if command[-3:] == ['config', '--format', 'json']:
                return json.dumps(self.render(kwargs['stdin'].read()))
            raise AssertionError('Unexpected check command')
        previous_umask = os.umask(0o077)
        try:
            with patch.object(updater, 'TransitionUpdate', CheckUpdate), patch.object(updater.base, 'run', side_effect=run):
                updater.execute(SimpleNamespace(stack=self.root, apply=False, backup_root=None))
        finally:
            os.umask(previous_umask)
        self.assertEqual(self.path.read_bytes(), LEGACY)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['docker-compose.yml'])
        self.assertFalse(any('stop' in command or 'up' in command for command in commands))


if __name__ == '__main__':
    unittest.main()
