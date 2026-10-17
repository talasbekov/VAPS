"""One command must lock before inspection and refuse unsafe work before downtime."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class UnifiedUpdateTests(unittest.TestCase):
    def module(self):
        file = Path(__file__).with_name('update.py')
        self.assertTrue(file.exists(), 'A single safe update entrypoint is missing')
        spec = importlib.util.spec_from_file_location('unified_update', file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def exercise(self, *, plan=(), check=False, pending_lock=False, fail=False):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / '.offline-update-lock'
            if pending_lock:
                lock.mkdir()
            events = []
            class FakeUpdate:
                recovery_required = False
                def __init__(self, args):
                    if not lock.is_dir():
                        raise AssertionError('Inspection happened before lock')
                    events.append('inspect')
                def load(self): events.append('load')
                def require_current_schema(self):
                    if plan: raise RuntimeError('pending migrations')
                def apply_without_database_changes(self, folder):
                    events.append('apply')
                    if fail:
                        self.recovery_required = True
                        raise RuntimeError('database mismatch')
            args = SimpleNamespace(stack=root, check=check, backup_root=None)
            with patch.object(module.app, 'ApplicationUpdate', FakeUpdate), patch.object(module.app.base, 'run', return_value='linux/amd64'):
                if pending_lock or plan or fail:
                    with self.assertRaises(RuntimeError): module.execute(args)
                else: module.execute(args)
            return events, lock.exists(), (lock / 'owner.json').exists()

    def test_lock_precedes_inspection_and_is_removed_on_success(self):
        events, locked, _ = self.exercise()
        self.assertEqual(events, ['inspect', 'load', 'apply'])
        self.assertFalse(locked)

    def test_existing_lock_prevents_inspection_and_loading(self):
        events, locked, _ = self.exercise(pending_lock=True)
        self.assertEqual(events, [])
        self.assertTrue(locked)

    def test_check_and_pending_schema_never_enter_apply(self):
        for options in ({'check': True}, {'plan': [('operations', '9999_future')]}):
            events, locked, _ = self.exercise(**options)
            self.assertEqual(events, ['inspect', 'load'])
            self.assertFalse(locked)

    def test_uncertain_database_retains_lock_and_recovery_metadata(self):
        events, locked, owner = self.exercise(fail=True)
        self.assertIn('apply', events)
        self.assertTrue(locked)
        self.assertTrue(owner)

    def test_release_manifest_includes_entrypoint(self):
        spec = importlib.util.spec_from_file_location('release_build', Path(__file__).with_name('build.py'))
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        self.assertIn('update.py', build.BUNDLE_FILES)
        self.assertIn('cleanup-old-releases.py', build.BUNDLE_FILES)

    def test_optional_cleanup_runs_only_after_success_and_inside_update_lock(self):
        module = self.module()
        self.assertTrue(hasattr(module, 'clean_old_releases'), 'Post-success cleanup hook is missing')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for check, fail in ((False, False), (True, False), (False, True)):
                events = []
                class FakeUpdate:
                    recovery_required = False
                    def __init__(self, args): pass
                    def load(self): pass
                    def require_current_schema(self): pass
                    def apply_without_database_changes(self, folder):
                        events.append('apply')
                        if fail: raise RuntimeError('rolled back')
                def cleanup(update, folder, updates_root):
                    self.assertTrue((root / '.offline-update-lock').is_dir())
                    events.append('cleanup')
                args = SimpleNamespace(stack=root, check=check, backup_root=None, cleanup_root=root.parent)
                with patch.object(module.app, 'ApplicationUpdate', FakeUpdate), \
                     patch.object(module.app.base, 'run', return_value='linux/amd64'), \
                     patch.object(module, 'clean_old_releases', side_effect=cleanup):
                    if fail:
                        with self.assertRaises(RuntimeError): module.execute(args)
                    else:
                        module.execute(args)
                self.assertEqual(events, [] if check else ['apply'] if fail else ['apply', 'cleanup'])

    def test_cleanup_failure_does_not_rollback_successful_update(self):
        module = self.module()
        self.assertTrue(hasattr(module, 'clean_old_releases'), 'Post-success cleanup hook is missing')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class FakeUpdate:
                recovery_required = False
                def __init__(self, args): pass
                def load(self): pass
                def require_current_schema(self): pass
                def apply_without_database_changes(self, folder): folder.mkdir(parents=True)
            args = SimpleNamespace(stack=root, check=False, backup_root=None, cleanup_root=root.parent)
            with patch.object(module.app, 'ApplicationUpdate', FakeUpdate), \
                 patch.object(module.app.base, 'run', return_value='linux/amd64'), \
                 patch.object(module, 'clean_old_releases', side_effect=ZeroDivisionError('unexpected cleanup failure')):
                module.execute(args)
            reports = list((root / 'backups' / 'updates').glob('*/CLEANUP.json'))
            self.assertEqual(len(reports), 1)
            self.assertEqual(json.loads(reports[0].read_text())['status'], 'refused')
            self.assertFalse((root / '.offline-update-lock').exists())


if __name__ == '__main__':
    unittest.main()
