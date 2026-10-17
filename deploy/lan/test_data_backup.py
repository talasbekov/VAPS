"""Run the actual Bash backup with an isolated, stateful compose controller.

The controller never invokes Docker. Cases and archives are preserved for review.
Actual Celery/PostgreSQL behavior needs the separate deployment rehearsal.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


DRIVER = r'''
import io, json, pathlib, sys, tarfile
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
state_file = pathlib.Path('controller-state.json')
state = json.loads(state_file.read_text())
args = sys.argv[1:]
state['calls'].append(args)
def finish(code=0, text='', data=None):
    state_file.write_text(json.dumps(state))
    if data is not None: sys.stdout.buffer.write(data)
    elif text: print(text)
    raise SystemExit(code)
if args == ['config', '--services']:
    finish(text='\n'.join(state['configured']))
if args[0] == 'ps':
    if '--services' in args: finish(text='\n'.join(state['active']))
    if '--format' in args and args[-1] == 'worker':
        finish(text=('running' if 'worker' in state['active'] else 'exited') + ' ' + str(state['worker_exit']))
    finish(2, 'Unsupported ps arguments')
if args[0] == 'stop':
    services = args[1:]
    if services[:1] == ['-t']: services = services[2:]
    if any(item not in state['configured'] for item in services):
        finish(1, 'No such service')
    for item in services:
        if item in state['active']: state['active'].remove(item)
    if 'worker' in services and state['queue_after_stop']: state['queue'] = 1
    finish()
if args[0] == 'start':
    if '--wait' in args and not state['supports_start_wait']: finish(1, 'unknown flag: --wait')
    if state['fail_start']: finish(7, 'Simulated restart failure')
    services = args[1:]
    if services[:3] == ['--wait', '--wait-timeout', '180']: services = services[3:]
    if any(item not in state['configured'] for item in services): finish(1, 'No such service')
    for item in services:
        if item not in state['active']: state['active'].append(item)
    finish()
if args[0] == 'up':
    if state['fail_start']: finish(7, 'Simulated restart failure')
    options = args[1:]
    services = []
    index = 0
    while index < len(options):
        item = options[index]
        if item in ('--pull', '--wait-timeout'): index += 2
        elif item.startswith('-'): index += 1
        else: services.append(item); index += 1
    if any(item not in state['configured'] for item in services): finish(1, 'No such service')
    for item in services:
        if item not in state['active']: state['active'].append(item)
    finish()
if args[0] == 'run' and '--entrypoint' in args:
    entrypoint = args[args.index('--entrypoint') + 1]
    if entrypoint == 'python':
        if 'app.control.inspect' in args[-1]:
            finish(1 if state['busy'] or 'worker' not in state['active'] else 0, 'Simulated worker inspection')
        finish(1 if state['queue'] else 0, 'Simulated broker inspection')
    if entrypoint == 'tar':
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as output:
            value = b'preserved private fixture' if '/data/private' in args else b'preserved public fixture'
            member = tarfile.TarInfo('fixture.txt'); member.size = len(value)
            output.addfile(member, io.BytesIO(value))
        finish(data=archive.getvalue())
if args[0] == 'exec':
    if 'pg_dump' in args[-1]:
        if state['fail_dump']: finish(1, 'Simulated dump failure')
        finish(data=b'PGDMP\x00fixture database\xff')
    if args[-2:] == ['postgres', '--version']: finish(text='postgres (PostgreSQL) 16.10')
finish(2, 'Unexpected controller command')
'''


class BackupLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != 'linux':
            raise unittest.SkipTest('LAN filesystem permissions require Linux; run this controller in a network-free Linux container')
        cls.bash = shutil.which('bash')
        if not cls.bash:
            raise unittest.SkipTest('Bash is required to run the deployment script')
        cls.root = Path(os.environ.get('BACKUP_TEST_EVIDENCE_ROOT', tempfile.gettempdir())).resolve()
        cls.root.mkdir(parents=True, exist_ok=True)

    def exercise(self, separate_beat=False, stopped_beat=False, **overrides):
        folder = Path(tempfile.mkdtemp(prefix='smart-backup-case-', dir=self.root))
        shutil.copyfile(Path(__file__).with_name('data.sh'), folder / 'data.sh')
        (folder / 'driver.py').write_text(DRIVER, encoding='utf-8')
        (folder / 'ctl.sh').write_text('#!/usr/bin/env bash\nexec "$BACKUP_TEST_PYTHON" ./driver.py "$@"\n', encoding='utf-8')
        (folder / 'source-revision.txt').write_text('isolated-backup-fixture\n', encoding='utf-8')
        services = ['db', 'redis', 'backend', 'worker', 'frontend', 'proxy'] + (['beat'] if separate_beat else [])
        active = [name for name in services if name != 'beat' or not stopped_beat]
        state = dict(configured=services, active=active.copy(), calls=[], worker_exit=0, queue_after_stop=False,
                     queue=0, busy=False, fail_dump=False, fail_start=False, supports_start_wait=True)
        # Override values without shadowing application/system environment variables.
        state.update(overrides)
        (folder / 'controller-state.json').write_text(json.dumps(state), encoding='utf-8')
        target = folder / 'backup'
        environment = os.environ.copy()
        environment['BACKUP_TEST_PYTHON'] = sys.executable
        result = subprocess.run([self.bash, './data.sh', 'backup', str(target)], cwd=folder, env=environment,
                                capture_output=True, text=True, encoding='utf-8', timeout=30)
        (folder / 'stdout.txt').write_text(result.stdout, encoding='utf-8')
        (folder / 'stderr.txt').write_text(result.stderr, encoding='utf-8')
        after = json.loads((folder / 'controller-state.json').read_text())
        if not state['fail_start']:
            self.assertEqual(set(after['active']), set(active), f'Services must return to their original state: {folder}')
        return result, target, after['calls']

    def assert_archive(self, target):
        names = ['database.dump', 'media.tar.gz', 'private.tar.gz', 'source-revision.txt', 'postgres-version.txt']
        self.assertEqual({item.name for item in target.iterdir()}, set(names + ['sha256sums.txt']))
        for line in (target / 'sha256sums.txt').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertEqual(hashlib.sha256((target / name).read_bytes()).hexdigest(), digest)
        self.assertEqual((target / 'database.dump').read_bytes(), b'PGDMP\x00fixture database\xff')

    def test_embedded_scheduler_backup_creates_complete_verified_archives(self):
        result, target, calls = self.exercise()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_archive(target)
        self.assertFalse(any('beat' in command[1:] for command in calls if command[0] in ('stop', 'start', 'up')))

    def test_separate_scheduler_preserves_its_original_running_or_stopped_state(self):
        for stopped in (False, True):
            with self.subTest(stopped=stopped):
                result, target, _ = self.exercise(separate_beat=True, stopped_beat=stopped)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assert_archive(target)

    def test_job_added_after_initial_drain_prevents_a_database_dump(self):
        result, target, _ = self.exercise(separate_beat=True, queue_after_stop=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((target / 'database.dump').exists())
        self.assertNotIn('Backup completed:', result.stdout)

    def test_forced_worker_exit_prevents_a_database_dump(self):
        result, target, _ = self.exercise(separate_beat=True, worker_exit=137)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((target / 'database.dump').exists())

    def test_busy_worker_and_dump_failure_resume_services_without_claiming_success(self):
        for failure in ('busy', 'fail_dump'):
            with self.subTest(failure=failure):
                result, target, _ = self.exercise(separate_beat=True, **{failure: True})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((target / 'sha256sums.txt').exists())
                self.assertNotIn('Backup completed:', result.stdout)

    def test_restart_failure_is_reported_as_failure_after_preserving_the_complete_archive(self):
        result, target, _ = self.exercise(fail_start=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Could not restart the original services', result.stderr)
        self.assertNotIn('Backup completed:', result.stdout)
        self.assert_archive(target)

    def test_compose_without_start_wait_support_resumes_original_services_and_completes_backup(self):
        result, target, calls = self.exercise(supports_start_wait=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_archive(target)
        self.assertIn('Backup completed:', result.stdout)
        restart = [command for command in calls if command[0] in ('start', 'up')]
        self.assertTrue(restart)
        for command in restart:
            self.assertEqual(command[0], 'up', 'Readiness requires compatible up --wait, not bare start')
            self.assertIn('--no-recreate', command)
            self.assertIn('--no-deps', command)
            self.assertIn('--no-build', command)
            self.assertIn('--wait', command)
            self.assertEqual(command[command.index('--wait-timeout') + 1], '180')
            self.assertEqual(command[command.index('--pull') + 1], 'never')


if __name__ == '__main__':
    unittest.main()
