"""Current releases must prove their migration graph and update the ingress image."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


REVIEWED = (
    ('employees', '0006_iin_format_validation'),
    ('employees', '0007_employee_service_profile'),
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
    ('operations', '0144_workspace_and_digital_twin_access'),
    ('operations', '0145_personnel_duty_execution'),
    ('statuses', '0005_employeestatus_duty_assignment'),
)


def graph():
    order = [('employees', '0005_employee_import_identity'), *REVIEWED]
    return {'format': 1, 'nodes': [
        {'app': app, 'name': name, 'sha256': 'a' * 64, 'dependencies': []}
        for app, name in order],
        'order': [list(item) for item in order],
        'leaves': [['employees', '0007_employee_service_profile'],
                   ['operations', '0145_personnel_duty_execution'],
                   ['statuses', '0005_employeestatus_duty_assignment']]}


class CurrentPlanTests(unittest.TestCase):
    def test_current_delta_includes_both_new_migrations_and_accepts_partial_installations(self):
        checks = load('schema-transition-checks')
        for plan in (REVIEWED, REVIEWED[1:], REVIEWED[-3:], (REVIEWED[1], REVIEWED[-2]),
                     (REVIEWED[-2],), ()):
            with self.subTest(plan=plan):
                checks.require_plan([list(item) for item in plan], graph())

    def test_old_unknown_duplicate_and_reordered_plans_are_refused(self):
        checks = load('schema-transition-checks')
        for plan in ((('employees', '0005_employee_import_identity'),),
                     (('operations', '9999_unknown'),), REVIEWED + (REVIEWED[-1],),
                     tuple(reversed(REVIEWED)), (REVIEWED[-2], REVIEWED[1])):
            with self.subTest(plan=plan), self.assertRaises(RuntimeError):
                checks.require_plan([list(item) for item in plan], graph())

    def test_graph_must_include_the_current_nodes_and_match_every_file_hash(self):
        checks = load('schema-transition-checks')
        self.assertTrue(callable(getattr(checks, 'require_graph', None)), 'The release must verify the full image graph')
        checks.require_graph(graph(), graph())
        for mutation in ('old-graph', 'changed-file', 'extra-node', 'dependency'):
            actual = graph()
            if mutation == 'old-graph':
                actual['nodes'] = [item for item in actual['nodes'] if item['name'] != '0007_employee_service_profile']
            elif mutation == 'changed-file':
                actual['nodes'][0]['sha256'] = 'b' * 64
            elif mutation == 'extra-node':
                actual['nodes'].append({'app': 'operations', 'name': '9999_unknown', 'sha256': 'c' * 64, 'dependencies': []})
            else:
                actual['nodes'][0]['dependencies'] = [['operations', '9999_unknown']]
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                checks.require_graph(actual, graph())


class ReleaseArtifactTests(unittest.TestCase):
    def test_builder_binds_schema_scripts_graph_and_three_images_to_fresh_source(self):
        build = load('build')
        self.assertTrue(callable(getattr(build, 'write_application_manifest', None)),
                        'The normal builder must produce the complete schema-capable release')
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            for name in build.APPLICATION_FILES:
                if name not in ('schema-transition.json', 'migration-graph.json'):
                    (output / name).write_bytes(('reviewed ' + name).encode())
            images = {name: {'tag': 'smart/' + name, 'id': 'sha256:' + name, 'os': 'linux', 'architecture': 'amd64'}
                      for name in ('backend', 'frontend', 'proxy', 'postgres', 'redis')}
            build.write_application_manifest(output, 'f' * 40, images, graph())
            release = json.loads((output / 'release.json').read_text())
            transition = json.loads((output / 'schema-transition.json').read_text())
            self.assertEqual(set(release['images']), {'backend', 'frontend', 'proxy'})
            self.assertEqual(transition['images'], release['images'])
            self.assertEqual(release['source_revision'], 'f' * 40)
            self.assertEqual(transition['source_revision'], 'f' * 40)
            self.assertEqual(json.loads((output / 'migration-graph.json').read_text()), graph())
            self.assertEqual(transition['graph_sha256'], build.sha(output / 'migration-graph.json'))
            for name in ('update-with-migrations.py', 'schema-transition-checks.py',
                         'schema-transition.json', 'migration-graph.json'):
                self.assertEqual(release['files'][name], build.sha(output / name))


class ProxyUpdateTests(unittest.TestCase):
    @staticmethod
    def proxy_service():
        return {'image': 'old-proxy', 'pull_policy': 'never', 'volumes': [
            {'type': 'volume', 'source': name, 'target': '/data/' + name, 'read_only': True}
            for name in ('static', 'media', 'private')]}

    def test_custom_proxy_startup_and_configuration_overlays_are_refused(self):
        app = load('update-app-only')
        self.assertTrue(callable(getattr(app.base, 'validate_proxy_layout', None)),
                        'The updater must reject mounts or startup that mask reviewed nginx protections')
        app.base.validate_proxy_layout(self.proxy_service())
        timezone = self.proxy_service()
        timezone['environment'] = {'TZ': 'UTC'}
        app.base.validate_proxy_layout(timezone)
        changes = [
            {'entrypoint': ['sh', '-c', 'nginx -c /data/media/old.conf']},
            {'command': ['nginx', '-c', '/data/media/old.conf']},
            {'configs': [{'source': 'old-nginx', 'target': '/etc/nginx/nginx.conf'}]},
            {'secrets': [{'source': 'old-nginx', 'target': '/etc/nginx/conf.d/old.conf'}]},
            {'tmpfs': ['/etc/nginx']}, {'volumes_from': ['other-container']},
            {'environment': {'NGINX_ENVSUBST_TEMPLATE_DIR': '/data/media'}},
            {'environment': {'NGINX_ENVSUBST_OUTPUT_DIR': '/etc/nginx/conf.d'}},
            {'environment': {'LD_PRELOAD': '/data/media/override.so'}},
        ]
        for target in ('/etc/nginx', '/etc/nginx/conf.d/default.conf', '/docker-entrypoint.d',
                       '/usr/local/bin/contour-proxy-entrypoint', '/usr/local/lib/nginx-error-filter.awk'):
            service = self.proxy_service()
            service['volumes'].append({'type': 'bind', 'source': '/old', 'target': target, 'read_only': True})
            changes.append(service)
        for change in changes:
            service = self.proxy_service()
            service.update(change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, 'proxy'):
                app.base.validate_proxy_layout(service)

    def test_proxy_upload_mounts_must_be_named_readonly_volumes(self):
        app = load('update-app-only')
        self.assertTrue(callable(getattr(app.base, 'validate_proxy_layout', None)),
                        'The updater must retain only standard read-only upload mounts')
        for mutation in ('writable', 'bind', 'missing', 'duplicate'):
            service = self.proxy_service()
            if mutation == 'writable':
                service['volumes'][0]['read_only'] = False
            elif mutation == 'bind':
                service['volumes'][0]['type'] = 'bind'
            elif mutation == 'missing':
                service['volumes'].pop()
            else:
                service['volumes'].append(copy.deepcopy(service['volumes'][0]))
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                app.base.validate_proxy_layout(service)

    def test_proxy_file_proof_matches_reviewed_image_without_startup_or_published_ports(self):
        app = load('update-app-only')
        self.assertTrue(callable(getattr(app.ApplicationUpdate, 'verify_proxy_configuration', None)),
                        'Configured nginx and startup files must match the reviewed image')
        obj = app.ApplicationUpdate.__new__(app.ApplicationUpdate)
        obj.new_proxy, obj.base = 'reviewed-proxy', ['docker', 'compose']
        obj.services = {'proxy': self.proxy_service()}
        proof = 'a' * 64 + '  /etc/nginx/conf.d/default.conf\n' + 'b' * 64 + '  /etc/nginx/nginx.conf\n'
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return proof
        with patch.object(app.base, 'run', side_effect=run):
            obj.verify_proxy_configuration()
        self.assertEqual(len(calls), 2)
        isolated, configured = calls
        self.assertEqual(isolated[isolated.index('--network') + 1], 'none')
        self.assertIn('--read-only', isolated)
        self.assertIn('run', configured)
        self.assertIn('--no-deps', configured)
        self.assertNotIn('--service-ports', configured)
        self.assertNotIn('--publish', configured)
        self.assertNotIn('--pull', configured)
        self.assertEqual(configured[configured.index('--entrypoint') + 1], 'sh')
        self.assertEqual(len(obj.proxy_configuration_sha256), 64)
        with patch.object(app.base, 'run', side_effect=[proof, proof.replace('a' * 64, 'c' * 64)]):
            with self.assertRaisesRegex(RuntimeError, 'proxy configuration'):
                obj.verify_proxy_configuration()

    def test_three_image_keys_change_atomically_while_database_settings_remain(self):
        app = load('update-app-only')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = 'BACKEND_IMAGE=old\nFRONTEND_IMAGE=old-front\nPROXY_IMAGE=old-proxy\nPOSTGRES_IMAGE=keep-db\nREDIS_IMAGE=keep-redis\nCUSTOM=keep\n'
            (root / 'images.env').write_text(original)
            obj = app.ApplicationUpdate.__new__(app.ApplicationUpdate)
            obj.stack = root
            obj.set_images('new-back', 'new-front', 'new-proxy')
            self.assertEqual((root / 'images.env').read_text(),
                             'POSTGRES_IMAGE=keep-db\nREDIS_IMAGE=keep-redis\nCUSTOM=keep\nBACKEND_IMAGE=new-back\nFRONTEND_IMAGE=new-front\nPROXY_IMAGE=new-proxy\n')
            self.assertFalse((root / 'images.env.app-only-tmp').exists())

    def test_proxy_is_recreated_with_offline_guards_when_writers_resume(self):
        app = load('update-app-only')
        obj = app.ApplicationUpdate.__new__(app.ApplicationUpdate)
        obj.base, obj.schedulers = ['docker', 'compose'], ['beat']
        commands = []
        with patch.object(app.base, 'run', side_effect=lambda cmd, **kwargs: commands.append(cmd) or ''):
            obj.start_writers()
        proxy = [cmd for cmd in commands if cmd[-1] == 'proxy']
        self.assertEqual(len(proxy), 1)
        self.assertIn('up', proxy[0])
        self.assertIn('--no-deps', proxy[0])
        self.assertIn('--no-build', proxy[0])
        self.assertEqual(proxy[0][proxy[0].index('--pull') + 1], 'never')

    def test_application_failure_restores_original_proxy_image_without_database_restore(self):
        app = load('update-app-only')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'images.env').write_text('BACKEND_IMAGE=old\nFRONTEND_IMAGE=old-front\nPROXY_IMAGE=old-proxy\n')
            obj = app.ApplicationUpdate.__new__(app.ApplicationUpdate)
            obj.stack, obj.base, obj.schedulers = root, ['docker', 'compose'], []
            obj.old_backend, obj.old_frontend, obj.old_proxy = 'old-back', 'old-front-id', 'old-proxy-id'
            obj.new_backend, obj.new_frontend, obj.new_proxy = 'new-back', 'new-front', 'new-proxy'
            obj.ids = {'db': 'db', 'worker': 'worker'}
            obj.db, obj.volume = {'Id': 'db', 'Mounts': []}, 'db-volume'
            obj.check_space = Mock()
            obj.require_current_schema = Mock(return_value=[])
            obj.wrap_image = lambda value: value
            obj.readonly = Mock(return_value={})
            obj.clone_check = Mock(return_value={})
            obj.backup = lambda folder, **kwargs: folder.mkdir()
            attempts = 0
            commands = []
            def run(command, **kwargs):
                nonlocal attempts
                commands.append(command)
                if 'up' in command and command[-2:] == ['backend', 'frontend']:
                    attempts += 1
                    if attempts == 1:
                        raise RuntimeError('startup failed')
                return ''
            with patch.object(app.base, 'run', side_effect=run), patch.object(
                    app.base, 'inspect', side_effect=lambda name: obj.db if name == 'db' else {'State': {'ExitCode': 0}}):
                with self.assertRaisesRegex(RuntimeError, 'startup failed'):
                    obj.apply_without_database_changes(root / 'backup')
            self.assertIn('PROXY_IMAGE=old-proxy-id', (root / 'images.env').read_text())
            self.assertTrue((root / 'backup/ROLLED_BACK.json').exists())
            self.assertFalse(any('pg_restore' in cmd or 'down' in cmd for cmd in commands))


class ComposeCompatibilityTests(unittest.TestCase):
    def test_readonly_and_live_probes_do_not_use_unsupported_compose_run_pull_flag(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.base, obj.new_backend = ['docker', 'compose'], 'new-backend'
        obj.live_migration_container = 'sj-schema-live-fixture'
        commands = []
        with patch.object(updater.base, 'run', side_effect=lambda cmd, **kwargs: commands.append(cmd) or '{}'):
            obj.readonly('import django,json\ndjango.setup()\nprint("{}")')
            obj.backend_json('capture')
            obj.backend_json('migrate', before={})
        self.assertEqual(len(commands), 3)
        for command in commands:
            self.assertIn('run', command)
            self.assertNotIn('--pull', command)
            self.assertIn('--no-deps', command)

    def test_image_graph_probe_has_no_network_or_production_mounts(self):
        updater = load('update-with-migrations')
        command = updater.graph_command('sha256:reviewed-backend')
        self.assertEqual(command[command.index('--network') + 1], 'none')
        self.assertNotIn('--volumes-from', command)
        self.assertNotIn('--mount', command)
        self.assertIn('ENABLE_BACKGROUND_TASKS=0', command)
        self.assertIn('PGOPTIONS=-c default_transaction_read_only=on', command)


class CurrentSchemaRehearsalTests(unittest.TestCase):
    def test_data_rehearsal_verifies_current_restored_schema_without_migration(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.new_backend, obj.database_image = 'new-backend', 'existing-postgres'
        before = {'schema': {}, 'tables': {}, 'sequences': {}}
        actions, volume_marker = [], None
        def run(command, **kwargs):
            nonlocal volume_marker
            if command[:3] == ['docker', 'volume', 'create']:
                volume_marker = command[command.index('--label') + 1].split('=', 1)[1]
            if command[:3] == ['docker', 'volume', 'inspect']:
                return json.dumps([{'Labels': {'sj-schema-check': volume_marker}}])
            return ''
        def probe(command, action, **kwargs):
            actions.append(action)
            self.assertNotEqual(action, 'migrate', 'Data preflight must not run any migration')
            return before
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'database.dump').write_bytes(b'verified-dump')
            with patch.object(updater.base, 'run', side_effect=run), patch.object(updater, 'run_json', side_effect=probe):
                self.assertEqual(obj.rehearse_transition(folder, before, no_migrations=True), before)
            self.assertEqual(actions, ['capture', 'current'])
            self.assertEqual(json.loads((folder / 'restored-before.json').read_text()), before)

    def test_restore_difference_refuses_before_any_migration_or_current_check(self):
        updater = load('update-with-migrations')
        obj = updater.TransitionUpdate.__new__(updater.TransitionUpdate)
        obj.new_backend, obj.database_image = 'new-backend', 'existing-postgres'
        marker, actions = None, []
        def run(command, **kwargs):
            nonlocal marker
            if command[:3] == ['docker', 'volume', 'create']:
                marker = command[command.index('--label') + 1].split('=', 1)[1]
            if command[:3] == ['docker', 'volume', 'inspect']:
                return json.dumps([{'Labels': {'sj-schema-check': marker}}])
            return ''
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'database.dump').write_bytes(b'bad-dump')
            with patch.object(updater.base, 'run', side_effect=run), patch.object(
                    updater, 'run_json', side_effect=lambda cmd, action, **kwargs: actions.append(action) or {'changed': True}):
                with self.assertRaisesRegex(RuntimeError, 'Restored backup does not match'):
                    obj.rehearse_transition(folder, {'original': True}, no_migrations=True)
            self.assertEqual(actions, ['capture'])


if __name__ == '__main__':
    unittest.main()
