"""Data delivery safety without Docker, Django or a live database."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


def load():
    path = Path(__file__).with_name('import-smart-data.py')
    if not path.is_file():
        raise AssertionError('The production Smart data entry point is missing')
    spec = importlib.util.spec_from_file_location('import_smart_data', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bundle():
    return {'format': 'smart-object-transfer/v1',
            'exportId': '9966f633-3fd0-45c7-beea-4c3a7b51de53',
            'bundleSha256': 'c0f70c5817ed345493ce7dd18aaa95eea24df4f177695de8e0f4677be407dbdb',
            'source': {'namespace': '2fb942a6-a276-4359-9e09-6ab1a86305f0', 'objectId': '6', 'code': 'OBJ-005'},
            'object': {'name': 'Аккорда'},
            'sectors': [{'id': '7', 'posts': [{'id': str(i)} for i in range(31, 51)]}]}


def receipt():
    return {'format': 'smart-object-transfer-receipt/v1', 'exportId': bundle()['exportId'],
            'bundleSha256': bundle()['bundleSha256'], 'source': {k: bundle()['source'][k] for k in ('namespace', 'objectId')},
            'applied': True, 'reused': False,
            'target': {'objectId': '501', 'departmentId': '602', 'departmentName': 'Шестой департамент'},
            'sectors': {'7': {'id': '701'}},
            'posts': {str(i): {'id': str(i + 1000)} for i in range(31, 51)}}


def archive(path, *, tampered=False, unsafe=False):
    files = {'README.md': b'readme', 'OBJECT-IMPORT.md': b'import',
             'payload/object.json': json.dumps(bundle()).encode(),
             'payload/tools/object_catalog_transfer.py': b'# catalog',
             'payload/tools/initialize_service_profiles.py': b'# profiles'}
    manifest = {'format': 'akorda-server-transfer-delivery/v1', 'targetServer': 'smart',
                'files': {n: hashlib.sha256(v).hexdigest() for n, v in files.items()}, 'posts': 20}
    files['manifest.json'] = json.dumps(manifest).encode()
    sums = ''.join(hashlib.sha256(value).hexdigest() + '  ' + name + '\n' for name, value in sorted(files.items()))
    files['SHA256SUMS'] = sums.encode()
    if tampered:
        files['payload/object.json'] += b' '
    if unsafe:
        files['../outside'] = b'unsafe'
    with tarfile.open(path, 'w:gz') as output:
        for name, value in files.items():
            info = tarfile.TarInfo('SMART-AKKORDA-2026-10-20/' + name)
            info.size = len(value)
            output.addfile(info, io.BytesIO(value))
    return hashlib.sha256(path.read_bytes()).hexdigest()


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.module = load()

    def test_verified_archive_supplies_original_bundle_and_tools_in_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.tar.gz'
            digest = archive(path)
            data = self.module.read_delivery(path, expected_sha256=digest)
            self.assertEqual(data['bundle']['exportId'], '9966f633-3fd0-45c7-beea-4c3a7b51de53')
            self.assertEqual(data['catalog_source'], '# catalog')
            self.assertEqual(data['profiles_source'], '# profiles')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_outer_hash_internal_hash_and_unsafe_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.tar.gz'
            for kwargs in ({}, {'tampered': True}, {'unsafe': True}):
                digest = archive(path, **kwargs)
                if not kwargs:
                    digest = '0' * 64
                with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                    self.module.read_delivery(path, expected_sha256=digest)

    def test_only_target_applied_receipt_with_all_positive_ids_is_exportable(self):
        good = receipt()
        self.module.validate_receipt(good, bundle(), '602', 'Шестой департамент')
        for path, value in ((('applied',), False), (('target', 'departmentId'), '82'),
                            (('target', 'objectId'), None), (('posts', '31', 'id'), None),
                            (('exportId',), 'another-export')):
            bad = copy.deepcopy(good)
            cursor = bad
            for key in path[:-1]:
                cursor = cursor[key]
            cursor[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.module.validate_receipt(bad, bundle(), '602', 'Шестой департамент')


class RemoteBoundaryTests(unittest.TestCase):
    def test_read_only_check_sends_fixed_batch_and_payload_only_through_stdin(self):
        module = load()
        seen = {}

        class Owner:
            base = ['docker', 'compose', '-f', '/srv/smart/docker-compose.yml']
            new_backend = 'reviewed:20'

        def run(command, **kwargs):
            seen['command'] = command
            seen['payload'] = json.load(kwargs['stdin'])
            return '{"catalog": {"applied": false}, "profiles": {"mode": "dry-run"}}'

        with patch.object(module.engine.base, 'run', side_effect=run):
            result = module.run_remote(Owner(), 'check', {'bundle': bundle()}, readonly=True)
        self.assertFalse(result['catalog']['applied'])
        self.assertIn('PGOPTIONS=-c default_transaction_read_only=on', seen['command'])
        self.assertIn('--no-deps', seen['command'])
        self.assertEqual(seen['payload']['batch_id'], 'akorda-initial-profiles-20261020')
        self.assertEqual(seen['payload']['action'], 'check')
        self.assertNotIn(bundle()['exportId'], ' '.join(seen['command']))
        self.assertNotIn('--name', seen['command'])
        self.assertNotIn('--label', seen['command'])

    def test_apply_container_has_the_persisted_unique_name_and_ownership_label(self):
        module = load()
        owner = SimpleNamespace(base=['docker', 'compose'], new_backend='reviewed:20',
                                live_data={'container': 'sj-data-live-' + 'a' * 32,
                                           'label': 'sj-data-live=sj-data-live-' + 'a' * 32})
        seen = []
        with patch.object(module.engine.base, 'run', side_effect=lambda command, **kwargs: seen.append(command) or '{}'):
            module.run_remote(owner, 'apply', {}, readonly=False)
        command = seen[0]
        self.assertIn('--name', command, 'A detached data writer must remain identifiable after attach failure')
        self.assertEqual(command[command.index('--name') + 1], owner.live_data['container'])
        self.assertEqual(command[command.index('--label') + 1], owner.live_data['label'])

    def transaction_scene(self, *, profile_failure):
        """Only the external Django transaction/DB boundary is replaced."""
        module = load()
        state = ModuleType('smart_data_test_state')
        state.rows = {'ops_security_objects': [], 'employee_service_profiles': [], 'employees': ['existing']}
        state.snapshot = lambda: {'schema': {}, 'seed_keys': {}, 'sequences': {},
                                  'tables': {key: list(value) for key, value in state.rows.items()}}
        state.readonly = False

        class Atomic:
            def __enter__(self):
                self.before = copy.deepcopy(state.rows)

            def __exit__(self, kind, value, traceback):
                if kind is not None:
                    state.rows = self.before

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, sql, params=None):
                if 'READ ONLY' in sql:
                    state.readonly = True
                self.value = 'on' if state.readonly else 'off'
                if sql.startswith('SELECT pg_get_serial_sequence'):
                    self.value = None

            def fetchone(self):
                return [self.value]

        django = ModuleType('django')
        django.setup = lambda: None
        database = ModuleType('django.db')
        database.connection = SimpleNamespace(cursor=Cursor, ops=SimpleNamespace(quote_name=lambda key: '"' + key + '"'))
        database.transaction = SimpleNamespace(atomic=Atomic)
        modules = {'django': django, 'django.db': database, 'smart_data_test_state': state}
        for path, names in (
            ('organization_management.apps.operations.models_object', ('OpsSecurityObject', 'OpsObjectSector', 'OpsSecurityPost')),
            ('organization_management.apps.operations.models_audit', ('OpsAuditLog',)),
            ('organization_management.apps.employees.models', ('EmployeeServiceProfile',)),
            ('organization_management.apps.audit.domain.models', ('AuditLog',)),
        ):
            child = ModuleType(path)
            for name in names:
                table = {'OpsSecurityObject': 'ops_security_objects', 'EmployeeServiceProfile': 'employee_service_profiles'}.get(name, name.lower())
                setattr(child, name, SimpleNamespace(_meta=SimpleNamespace(db_table=table, pk=SimpleNamespace(column='id'))))
            modules[path] = child
        catalog_source = '''import smart_data_test_state as state
def import_bundle(bundle,**args):
    if args['apply']:
        state.rows['ops_security_objects'].append('target')
    return {**RECEIPT,'applied':args['apply']}
'''.replace('RECEIPT', repr(receipt()))
        profiles_source = '''import smart_data_test_state as state
def initialize(*,actor_id,batch_id,apply):
    if batch_id!='akorda-initial-profiles-20261020':
        raise ValueError('wrong batch')
    if apply:
        state.rows['employee_service_profiles'].append('initial values')
        FAILURE
    return {'mode':'apply' if apply else 'dry-run','batch_id':batch_id}
'''.replace('FAILURE', "raise ValueError('PRIVATE-TEST-VALUE')" if profile_failure else 'pass')
        payload = {'action': 'apply', 'batch_id': 'akorda-initial-profiles-20261020', 'actor_id': '11',
                   'department_id': '602', 'department_name': 'Шестой департамент', 'bundle': bundle(),
                   'catalog_source': catalog_source, 'profiles_source': profiles_source,
                   'checks_source': 'import smart_data_test_state as state\ndef capture(): return state.snapshot()\ndef pending_plan(): return []',
                   'before': copy.deepcopy(state.snapshot())}
        return module, state, modules, payload

    def test_combined_remote_failure_rolls_back_catalog_and_profiles_without_private_errors(self):
        module, state, modules, payload = self.transaction_scene(profile_failure=True)
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict('sys.modules', modules), patch('sys.stdin', io.StringIO(json.dumps(payload))), redirect_stdout(stdout), redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as stopped:
                exec(compile(module.REMOTE_SOURCE, '<smart-data-remote>', 'exec'), {})
        self.assertEqual(stopped.exception.code, 1)
        self.assertEqual(state.rows['ops_security_objects'], [])
        self.assertEqual(state.rows['employee_service_profiles'], [])
        self.assertNotIn('PRIVATE-TEST-VALUE', stderr.getvalue())
        self.assertEqual(stdout.getvalue(), '')

    def test_combined_remote_success_and_check_observe_outer_transaction_boundary(self):
        for action in ('check', 'apply'):
            module, state, modules, payload = self.transaction_scene(profile_failure=False)
            payload['action'] = action
            stdout = io.StringIO()
            with patch.dict('sys.modules', modules), patch('sys.stdin', io.StringIO(json.dumps(payload))), redirect_stdout(stdout):
                exec(compile(module.REMOTE_SOURCE, '<smart-data-remote>', 'exec'), {})
            result = json.loads(stdout.getvalue())
            self.assertEqual(result['catalog']['applied'], action == 'apply')
            self.assertEqual(state.rows['ops_security_objects'], ['target'] if action == 'apply' else [])
            self.assertEqual(state.rows['employee_service_profiles'], ['initial values'] if action == 'apply' else [])


class MaintenanceTests(unittest.TestCase):
    def owner(self, module, folder, *, restore_error=False):
        self.assertTrue(hasattr(module, 'DataImport'), 'Data apply must share updater discovery and maintenance safeguards')
        owner = object.__new__(module.DataImport)
        owner.base = ['docker', 'compose']
        owner.ids = {'worker': 'worker', 'db': 'db'}
        owner.schedulers = []
        owner.volume = 'existing-db-volume'
        owner.args = SimpleNamespace()
        owner.require_ready = lambda: None
        owner.check_space = lambda _: None
        owner.verify_database_identity = lambda: None
        owner.upload_snapshot = lambda: {'media': [], 'private': []}
        before = {'tables': {'employees': {'rows': 1, 'sha256': 'preserved'}}}
        after = copy.deepcopy(before)
        after['data-import'] = 'committed'
        events = []
        owner.database_snapshot = lambda: after if 'write' in events else before

        def backup(path, *, uploads):
            self.assertTrue(uploads)
            path.mkdir()
            (path / 'database.dump').write_bytes(b'BACKUP')
            events.append('backup')

        def restore(path, value, *, no_migrations=False):
            self.assertEqual((path / 'database.dump').read_bytes(), b'BACKUP')
            self.assertTrue(no_migrations, 'Data apply must refuse migrations in the restored clone')
            self.assertEqual(value, before)
            if restore_error:
                raise RuntimeError('TEST_RESTORE_FAILED')
            events.append('restored')
            return before

        def remote(current, action, payload, *, readonly):
            self.assertEqual(action, 'apply')
            self.assertFalse(readonly)
            self.assertIn('restored', events)
            self.assertEqual(payload['before'], before)
            events.append('write')
            return {'catalog': receipt(), 'profiles': {'batch_id': 'akorda-initial-profiles-20261020', 'mode': 'apply'}, 'after': after}

        owner.backup = backup
        owner.rehearse_transition = restore
        owner.start_application = lambda: events.append('application')
        owner.start_writers = lambda: events.append('writers')
        return owner, events, remote

    def test_failed_independent_restore_never_reaches_live_write(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, events, remote = self.owner(module, folder, restore_error=True)
            with patch.object(module.engine.base, 'run', return_value=''), patch.object(
                    module.engine.base, 'inspect', return_value={'State': {'ExitCode': 0}}), patch.object(
                    module, 'run_remote', side_effect=remote):
                with self.assertRaisesRegex(RuntimeError, 'TEST_RESTORE_FAILED'):
                    owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            self.assertNotIn('write', events)
            self.assertFalse((folder / 'smart-applied.json').exists())

    def test_data_mode_refuses_old_or_unprotected_running_backend(self):
        module = load()
        self.assertTrue(hasattr(module, 'DataImport'))
        owner = object.__new__(module.DataImport)
        owner.require_current_schema = lambda: []
        owner.old_backend, owner.new_backend = 'running-backend', 'new-backend'
        owner.old_frontend, owner.new_frontend = 'frontend-id', 'new-frontend'
        owner.old_proxy, owner.new_proxy = 'proxy-id', 'new-proxy'
        current = {'Id': 'base-id', 'RootFS': {'Layers': ['reviewed-layer']},
                   'Config': {'Cmd': ['gunicorn']}}
        wrapped = {'Id': 'wrapper-id', 'RootFS': {'Layers': ['reviewed-layer', 'wrapper-layer']},
                   'Config': {'Cmd': ['gunicorn'], 'Entrypoint': ['/bin/sh', '/sj-app-only-entrypoint.sh'],
                              'Labels': {'smart-josparlau.app-only-entrypoint': hashlib.sha256(module.engine.app.ENTRYPOINT.encode()).hexdigest()}}}
        images = {'new-backend': current, 'running-backend': wrapped,
                  'new-frontend': {'Id': 'frontend-id'}, 'new-proxy': {'Id': 'proxy-id'}}
        with patch.object(module.engine.base, 'inspect', side_effect=lambda key: images[key]):
            owner.require_ready()
            wrapped['RootFS']['Layers'][0] = 'old-application-layer'
            with self.assertRaises(RuntimeError):
                owner.require_ready()

    def test_missing_stack_and_half_mapping_are_rejected_before_docker(self):
        module = load()
        self.assertTrue(callable(getattr(module, 'execute', None)), 'Data commands need shared locked execution')
        for argv in (['ids'], ['--stack', '/srv/smart', 'check', '--actor-id', '11', '--department-id', '22',
                             '--department-name', 'Sixth', '--target-object-id', '501']):
            args = module.parser().parse_args(argv)
            with self.subTest(argv=argv), patch.object(module.engine.base, 'run', side_effect=AssertionError('Docker must not run')):
                with self.assertRaises(ValueError):
                    module.execute(args, {'bundle': bundle()})

    def test_backup_restore_and_frozen_compare_precede_live_write_and_target_export(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, events, remote = self.owner(module, folder)
            with patch.object(module.engine.base, 'run', return_value=''), patch.object(
                    module.engine.base, 'inspect', return_value={'State': {'ExitCode': 0}}), patch.object(
                    module, 'run_remote', side_effect=remote):
                owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            self.assertEqual(events, ['backup', 'restored', 'write', 'application', 'writers'])
            output = json.loads((folder / 'smart-applied.json').read_text(encoding='utf-8'))
            self.assertEqual(output['target']['objectId'], '501')
            self.assertEqual(output['target']['departmentId'], '602')
            self.assertTrue((folder / 'DATA-SUCCESS.json').is_file())
            self.assertFalse(owner.recovery_required)

    def test_mismatched_restored_snapshot_cannot_be_used_as_backup_proof(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, events, remote = self.owner(module, folder)
            owner.rehearse_transition = lambda *a, **k: {'different': 'database'}
            with patch.object(module.engine.base, 'run', return_value=''), patch.object(
                    module.engine.base, 'inspect', return_value={'State': {'ExitCode': 0}}), patch.object(
                    module, 'run_remote', side_effect=remote):
                with self.assertRaises(RuntimeError):
                    owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            self.assertNotIn('write', events)

    def test_uncertain_live_write_keeps_application_closed_and_preserves_backup(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, events, _ = self.owner(module, folder)
            commands = []
            with patch.object(module.engine.base, 'run', side_effect=lambda command, **kwargs: commands.append(command) or ''), patch.object(
                    module.engine.base, 'inspect', return_value={'State': {'ExitCode': 0}}), patch.object(
                    module, 'run_remote', side_effect=RuntimeError('TEST_CONNECTION_LOST')):
                with self.assertRaisesRegex(RuntimeError, 'Keep ingress closed'):
                    owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            self.assertTrue(owner.recovery_required)
            self.assertNotIn('application', events)
            self.assertNotIn('writers', events)
            self.assertTrue((folder / 'database.dump').is_file())
            self.assertTrue((folder / 'DATA-RECOVERY-REQUIRED.json').is_file())
            self.assertTrue(any('stop' in command for command in commands))

    def test_attach_failure_records_active_owned_writer_and_identity_before_launch(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, events, _ = self.owner(module, folder)
            owner.lock_owner = {'phase': 'data-apply'}
            owner.lock_path = Path(directory) / 'owner.json'
            module.engine.base.save_json(owner.lock_path, owner.lock_owner)
            launched = []

            def remote(current, action, payload, **kwargs):
                self.assertTrue((folder / 'live-data.json').is_file(), 'Writer identity must precede launch')
                identity = json.loads((folder / 'live-data.json').read_text(encoding='utf-8'))
                self.assertEqual(identity, current.live_data)
                saved_owner = json.loads(owner.lock_path.read_text(encoding='utf-8'))
                self.assertEqual(saved_owner['live_data'], identity)
                launched.append(identity)
                raise RuntimeError('TEST_ATTACH_LOST')

            def inspect(key):
                if key == 'worker':
                    return {'State': {'ExitCode': 0}}
                self.assertEqual(key, 'owned-writer-id')
                return {'Id': key, 'Config': {'Labels': {'sj-data-live': launched[0]['container']}},
                        'State': {'Running': True, 'Status': 'running', 'Restarting': False}}

            def run(command, **kwargs):
                if command[:3] == ['docker', 'ps', '-aq']:
                    self.assertIn('name=^/' + launched[0]['container'] + '$', command)
                    return 'owned-writer-id'
                return ''

            with patch.object(module.engine.base, 'run', side_effect=run), patch.object(
                    module.engine.base, 'inspect', side_effect=inspect), patch.object(module, 'run_remote', side_effect=remote):
                with self.assertRaises(RuntimeError):
                    owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            report = json.loads((folder / 'DATA-RECOVERY-REQUIRED.json').read_text(encoding='utf-8'))
            self.assertIn('live_data_writer', report, 'Recovery must identify an independent writer left after attach failure')
            writer = report['live_data_writer']
            self.assertEqual(writer['container_id'], 'owned-writer-id')
            self.assertEqual(writer['state'], 'running')
            self.assertFalse(writer['closure_confirmed'])
            self.assertEqual(report['live_data'], launched[0])
            saved_owner = json.loads(owner.lock_path.read_text(encoding='utf-8'))
            self.assertEqual(saved_owner['live_data_writer'], writer)
            self.assertNotIn('application', events)
            self.assertNotIn('writers', events)

    def test_cleanup_failure_still_records_unknown_writer_and_unconfirmed_application_closure(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'result'
            owner, _, _ = self.owner(module, folder)
            owner.lock_owner = {'phase': 'data-apply'}
            owner.lock_path = Path(directory) / 'owner.json'
            interrupted = []

            def remote(*args, **kwargs):
                interrupted.append(True)
                raise RuntimeError('TEST_ATTACH_LOST')

            def run(command, **kwargs):
                if interrupted:
                    raise RuntimeError('TEST_DOCKER_UNAVAILABLE')
                return ''

            with patch.object(module.engine.base, 'run', side_effect=run), patch.object(
                    module.engine.base, 'inspect', return_value={'State': {'ExitCode': 0}}), patch.object(
                    module, 'run_remote', side_effect=remote):
                with self.assertRaises(RuntimeError):
                    owner.apply_data(folder, {'bundle': bundle(), 'department_id': '602', 'department_name': 'Шестой департамент'})
            self.assertTrue((folder / 'DATA-RECOVERY-REQUIRED.json').is_file(), 'Failed cleanup must not suppress the recovery record')
            report = json.loads((folder / 'DATA-RECOVERY-REQUIRED.json').read_text(encoding='utf-8'))
            self.assertFalse(report['application_closure_confirmed'])
            self.assertEqual(report['live_data_writer']['state'], 'unknown')
            self.assertFalse(report['live_data_writer']['closure_confirmed'])
            saved_owner = json.loads(owner.lock_path.read_text(encoding='utf-8'))
            self.assertEqual(saved_owner['live_data'], report['live_data'])
            self.assertEqual(saved_owner['live_data_writer']['state'], 'unknown')

    def test_recovery_required_keeps_common_update_lock(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            stack = Path(directory)
            args = module.parser().parse_args(['--stack', str(stack), 'apply', '--actor-id', '11',
                '--department-id', '602', '--department-name', 'Шестой департамент'])

            class Interrupted:
                def __init__(self, args):
                    self.recovery_required = False

                def load(self):
                    pass

                def require_ready(self):
                    pass

                def apply_data(self, folder, payload):
                    self.recovery_required = True
                    raise RuntimeError('TEST_INTERRUPTION')

            with patch.object(module, 'DataImport', Interrupted), redirect_stderr(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, 'TEST_INTERRUPTION'):
                    module.execute(args, {'bundle': bundle()})
            owner = json.loads((stack / '.offline-update-lock' / 'owner.json').read_text(encoding='utf-8'))
            self.assertEqual(owner['phase'], 'data-recovery-required')


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.module = load()
        self.scope = {'source': 'employee_status', 'department_id': '602',
                      'department_name': 'Шестой департамент'}

    def test_empty_roster_still_requires_explicit_department_scope(self):
        payload = {'scope': self.scope, 'results': []}
        self.assertEqual(self.module.validate_roster(payload, receipt()), 0)
        for change in ({'scope': None}, {'next': '/page/2'}, {'count': 1}, {'page': {'next': '/page/2'}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.module.validate_roster({**payload, **change}, receipt())

    def test_overnight_intervals_are_at_placement_and_ordinary_source_stays_null(self):
        row = {'department_id': '602', 'source': None, 'service_profile': None,
               'placement': {'kind': 'POST', 'object_id': '501', 'post_id': '1031',
                             'time_zone': 'Asia/Qyzylorda',
                             'intervals': [{'start_at': '2026-10-20T23:00:00+05:00',
                                            'end_at': '2026-10-21T01:00:00+05:00'}]}}
        payload = {'scope': self.scope, 'results': [row], 'count': 1}
        self.assertEqual(self.module.validate_roster(payload, receipt()), 1)
        for changes in ({'source': 'employee_status'}, {'department_id': '82'},
                        {'placement': {**row['placement'], 'time_zone': None}},
                        {'placement': {**row['placement'], 'intervals': [{'start_at': '2026-10-20T23:00:00',
                                                                          'end_at': '2026-10-21T01:00:00'}]}}):
            bad = {**payload, 'results': [{**row, **changes}]}
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.module.validate_roster(bad, receipt())

    def test_legacy_dates_never_become_invented_intervals(self):
        row = {'department_id': '602', 'service_profile': None,
               'placement': {'kind': 'POST', 'object_id': '501', 'post_id': '1031'}}
        original = copy.deepcopy(row)
        self.assertEqual(self.module.validate_roster({'scope': self.scope, 'results': [row]}, receipt()), 1)
        self.assertEqual(row, original)

    def test_credentials_are_private_and_loopback_or_embedded_password_is_refused(self):
        for origin in ('http://localhost:8000', 'http://127.0.0.1', 'http://[::1]',
                       'http://username:password@smart.example.org', 'http://backend:8000',
                       'http://alias.localhost.', 'http://127.1', 'http://2130706433'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                self.module.validate_origin(origin)
        self.assertEqual(self.module.validate_origin('https://smart.example.org/'), 'https://smart.example.org')


if __name__ == '__main__':
    unittest.main()
