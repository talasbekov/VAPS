import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def sha(data):
    return hashlib.sha256(data).hexdigest()


class CheckRepairTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('repair-check-roundtrip.py')
        self.assertTrue(path.is_file(), 'A version-checked package repair is missing')
        spec = importlib.util.spec_from_file_location('check_repair', path)
        self.repair = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.repair)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        self.backup = self.root / 'stack/backups/updates/schema-fixture'
        self.backup.mkdir(parents=True)
        source = path.with_name('schema-transition-checks.py').read_text(encoding='utf-8')
        # This historical repair consumes the embedded 17 October policy, not a
        # newer release's generated revision/graph binding.
        source += "\nSOURCE_REVISION='381c21f34cad4e58d9cf29d5ee56370072a128b3'\n"
        source += "APPROVED_PLANS=((),ACCESS_PLAN,tuple(item for item in APPROVED_PLAN if item[1] not in ('0007_employee_service_profile','0145_personnel_duty_execution')))\n"
        scope = {}
        exec(source, scope)
        self.original = {name: ('original ' + name).encode() for name in (
            'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py',
            'update-with-migrations.py', 'schema-transition-checks.py')}
        transition = {'source_revision': scope['SOURCE_REVISION'], 'images': {'backend': {'id': 'same-backend'}, 'frontend': {'id': 'same-frontend'}},
                      'plans': [[list(item) for item in plan] for plan in scope['APPROVED_PLANS']],
                      'files': {name: sha(self.original[name]) for name in ('update-with-migrations.py', 'schema-transition-checks.py')}}
        transition_text = json.dumps(transition, indent=2) + '\n'
        self.original['schema-transition.json'] = transition_text.encode()
        release = {'source_revision': scope['SOURCE_REVISION'], 'images': copy.deepcopy(transition['images']),
                   'compatibility_overlay': False, 'files': {name: sha(data) for name, data in self.original.items()}}
        release_text = json.dumps(release, indent=2) + '\n'
        self.original['release.json'] = release_text.encode()
        self.configuration = {'release_text': release_text, 'transition_text': transition_text, 'checks_source': source}
        for name, data in self.original.items():
            (self.package / name).write_bytes(data)
        self.before = {'schema': {'constraints': [['ops_duty_record_supplements', 'chk_duty_supplement_source',
            "CHECK (((source_type)::text = ANY ((ARRAY['DISPATCH'::character varying, 'PLAN'::character varying])::text[])))"]]},
            'tables': {'employees': {'columns': ['id'], 'rows': 2, 'sha256': 'original-rows'}},
            'sequences': {'employees_id_seq': {'last_value': 2, 'is_called': True}}, 'seed_keys': {}}
        self.restored = copy.deepcopy(self.before)
        self.restored['schema']['constraints'][0][2] = "CHECK (((source_type)::text = ANY (ARRAY[('DISPATCH'::character varying)::text, ('PLAN'::character varying)::text])))"
        (self.backup / 'database.dump').write_bytes(b'frozen backup')
        (self.backup / 'checksums.json').write_text(json.dumps({'database.dump': sha(b'frozen backup')}))
        (self.backup / 'database-before.json').write_text(json.dumps(self.before))
        self.evidence = self.backup / 'diagnostic-fixture/restored-before.json'
        self.evidence.parent.mkdir()
        self.evidence.write_text(json.dumps(self.restored))

    def assert_original(self):
        for name, data in self.original.items():
            self.assertEqual((self.package / name).read_bytes(), data, name)

    def test_repairs_only_three_files_and_updates_all_manifest_hashes(self):
        self.repair.repair(self.package, self.backup, self.configuration)
        expected = self.repair.prepared_files(self.configuration)
        self.assertEqual(set(expected), {'schema-transition-checks.py', 'schema-transition.json', 'release.json'})
        for name, old in self.original.items():
            self.assertEqual((self.package / name).read_bytes(), expected.get(name, old))
        release = json.loads((self.package / 'release.json').read_text())
        for name, digest in release['files'].items():
            self.assertEqual(sha((self.package / name).read_bytes()), digest)
        saved = list(self.package.glob('.check-roundtrip-fix-*/release.json'))
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].read_bytes(), self.original['release.json'])
        self.assertFalse((self.root / 'stack/.offline-update-lock').exists())
        self.assertEqual((self.backup / 'database.dump').read_bytes(), b'frozen backup')

    def test_repeat_is_idempotent_without_new_backups(self):
        self.repair.repair(self.package, self.backup, self.configuration)
        saved = set(self.package.glob('.check-roundtrip-fix-*'))
        self.repair.repair(self.package, self.backup, self.configuration)
        self.assertEqual(set(self.package.glob('.check-roundtrip-fix-*')), saved)

    def test_wrong_or_tampered_package_is_refused_before_replacement(self):
        (self.package / 'update-with-migrations.py').write_bytes(b'tampered')
        with self.assertRaises(RuntimeError):
            self.repair.repair(self.package, self.backup, self.configuration)
        self.assertEqual((self.package / 'schema-transition-checks.py').read_bytes(), self.original['schema-transition-checks.py'])
        self.assertEqual((self.package / 'release.json').read_bytes(), self.original['release.json'])

    def test_real_data_sequence_or_constraint_changes_are_refused(self):
        for section in ('tables', 'sequences', 'schema'):
            value = copy.deepcopy(self.restored)
            if section == 'tables':
                value['tables']['employees']['sha256'] = 'actual-changed-row'
            elif section == 'sequences':
                value['sequences']['employees_id_seq']['is_called'] = False
            else:
                value['schema']['constraints'][0][2] = value['schema']['constraints'][0][2].replace("'PLAN'", "'OTHER'")
            self.evidence.write_text(json.dumps(value))
            with self.subTest(section=section), self.assertRaises(RuntimeError):
                self.repair.repair(self.package, self.backup, self.configuration)
            self.assert_original()

    def test_existing_update_lock_is_preserved(self):
        lock = self.root / 'stack/.offline-update-lock'
        lock.mkdir()
        (lock / 'owner.json').write_text('{"marker":"someone-else"}')
        with self.assertRaises(RuntimeError):
            self.repair.repair(self.package, self.backup, self.configuration)
        self.assertEqual((lock / 'owner.json').read_text(), '{"marker":"someone-else"}')
        self.assert_original()

    def test_interrupted_replacement_restores_original_tools(self):
        original_install = self.repair.atomic_install
        calls = 0

        def interrupted(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated filesystem failure')
            return original_install(*args)

        with patch.object(self.repair, 'atomic_install', side_effect=interrupted):
            with self.assertRaises(OSError):
                self.repair.repair(self.package, self.backup, self.configuration)
        self.assert_original()
        self.assertFalse((self.root / 'stack/.offline-update-lock').exists())


if __name__ == '__main__':
    unittest.main()
