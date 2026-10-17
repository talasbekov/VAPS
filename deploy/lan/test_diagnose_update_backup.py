import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class BackupDiagnosticTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('diagnose-update-backup.py')
        self.assertTrue(path.is_file(), 'The restore diagnostic is missing')
        spec = importlib.util.spec_from_file_location('backup_diagnostic', path)
        self.diagnostic = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.diagnostic)
        self.before = {
            'schema': {'columns': [['alpha', 'id', 'int8'], ['beta', 'id', 'int8']],
                       'constraints': [['alpha', 'alpha_pk', 'PRIMARY KEY (id)']], 'indexes': []},
            'tables': {'alpha': {'columns': ['id'], 'rows': 2, 'sha256': 'aaa'}},
            'sequences': {'alpha_id_seq': {'last_value': 2, 'is_called': True}},
            'seed_keys': {'ops_roles': {'column': 'code', 'sequence': None, 'values': ['private-role']}}
        }

    def test_identical_backup_is_equal(self):
        report = self.diagnostic.summarize(self.before, copy.deepcopy(self.before))
        self.assertTrue(report['equal'])
        self.assertEqual(report['changed_sections'], [])

    def test_order_only_metadata_is_reported_without_weakening_equality(self):
        restored = copy.deepcopy(self.before)
        restored['schema']['columns'].reverse()
        report = self.diagnostic.summarize(self.before, restored)
        self.assertFalse(report['equal'])
        self.assertTrue(report['schema']['columns']['order_only'])
        restored['schema']['columns'][0][2] = 'text'
        self.assertFalse(self.diagnostic.summarize(self.before, restored)['schema']['columns']['order_only'])

    def test_real_changes_are_not_hidden_and_values_are_redacted(self):
        restored = copy.deepcopy(self.before)
        restored['tables']['alpha']['sha256'] = 'bbb'
        restored['sequences']['alpha_id_seq']['is_called'] = False
        restored['seed_keys']['ops_roles']['values'].append('another-private-role')
        restored['schema']['constraints'][0][2] = "CHECK (secret = 'confidential literal')"
        report = self.diagnostic.summarize(self.before, restored)
        self.assertEqual(set(report['changed_sections']), {'tables', 'sequences', 'seed_keys', 'schema'})
        self.assertEqual(report['tables']['alpha']['rows_before'], 2)
        self.assertFalse(report['tables']['alpha']['hash_equal'])
        self.assertFalse(report['sequences']['alpha_id_seq']['restored']['is_called'])
        self.assertEqual(report['seed_keys']['ops_roles']['keys_restored'], 2)
        serialized = json.dumps(report)
        for secret in ('private-role', 'another-private-role', 'confidential literal'):
            self.assertNotIn(secret, serialized)

    def test_missing_objects_and_duplicate_metadata_are_reported(self):
        restored = copy.deepcopy(self.before)
        del restored['tables']['alpha']
        restored['tables']['beta'] = {'columns': ['id'], 'rows': 1, 'sha256': 'bbb'}
        restored['schema']['columns'].append(restored['schema']['columns'][0])
        report = self.diagnostic.summarize(self.before, restored)
        self.assertEqual(report['tables']['alpha']['presence'], 'before_only')
        self.assertEqual(report['tables']['beta']['presence'], 'restored_only')
        self.assertFalse(report['schema']['columns']['order_only'])

    def test_source_probe_runs_with_compose_217_and_remains_read_only(self):
        image = 'sha256:verified-backend'
        environment = {'POSTGRES_DB': 'fixture', 'POSTGRES_USER': 'fixture', 'POSTGRES_PASSWORD': 'fixture-secret'}
        database = {'Id': 'original-db', 'Image': 'original-pg', 'State': {'Running': True},
                    'Mounts': [{'Destination': '/var/lib/postgresql/data', 'Name': 'original-volume'}],
                    'Config': {'Env': [key + '=' + value for key, value in environment.items()]}}
        probes = []

        def compose_217(command, **kwargs):
            if command[:2] == ['docker', 'compose']:
                if 'run' in command:
                    if '--pull' in command:
                        raise RuntimeError('unknown flag: --pull (Compose 2.17.2, exit 16)')
                    probes.append(command)
                    return json.dumps({'database_bytes': 100})
                return json.dumps({'name': 'original-project', 'services': {'backend': {
                    'image': image, 'environment': {**environment, 'POSTGRES_HOST': 'db'}}}})
            if command[:2] == ['docker', 'exec'] and 'df' in command:
                return 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 10 10 0 100% /data\n'
            self.fail('Unexpected command: ' + repr(command[:3]))

        base = SimpleNamespace(inspect=Mock(side_effect=[database, {'Id': image}]),
            validate_container_owner=Mock(), running_image_id=Mock(return_value='original-pg'),
            exported_config_ids=Mock(return_value={'backend': image}), verify_loaded_image=Mock(), save_json=Mock())
        manifest = {'images': {'backend': {'tag': 'verified-backend'}}}
        with tempfile.TemporaryDirectory() as temporary:
            stack = Path(temporary)
            backup = stack / 'backups/updates/schema-fixture'
            backup.mkdir(parents=True)
            (backup / 'database.dump').write_bytes(b'frozen fixture')
            (backup / 'checksums.json').write_text(json.dumps({'database.dump': self.diagnostic.file_sha(backup / 'database.dump')}))
            (backup / 'database-before.json').write_text(json.dumps(self.before))
            (backup / 'before.json').write_text(json.dumps({'project': 'original-project',
                'database_volume': 'original-volume', 'containers': {'db': {'id': 'original-db', 'image': 'original-pg'}}}))
            with patch.object(self.diagnostic, 'load_driver', return_value=(SimpleNamespace(base=base), manifest)), \
                 patch.object(self.diagnostic, 'PrivateRunner', return_value=compose_217), \
                 patch.dict(os.environ, {}, clear=True):
                # Stop at the real capacity guard, before creating diagnostic resources.
                with self.assertRaisesRegex(RuntimeError, 'Insufficient Docker space'):
                    self.diagnostic.execute(SimpleNamespace(backup=backup, stack=stack))
        self.assertEqual(len(probes), 1)
        self.assertIn('--no-deps', probes[0])
        self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000', probes[0])
        self.assertEqual(probes[0][probes[0].index('--entrypoint') + 1], 'python')
        base.verify_loaded_image.assert_called_once()


if __name__ == '__main__':
    unittest.main()
