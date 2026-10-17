import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class Org0111CliTests(unittest.TestCase):
    def module(self):
        file = Path(__file__).resolve().parents[1] / 'repair-org-0111.py'
        self.assertTrue(file.is_file(), 'Standalone guarded data repair CLI is missing')
        spec = importlib.util.spec_from_file_location('repair_cli', file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_existing_update_lock_refuses_before_any_inspection(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.offline-update-lock').mkdir()
            args = SimpleNamespace(stack=root, current_package=root, apply=False, output=root / 'plan.json')
            with patch.object(module, 'make_update') as inspect:
                with self.assertRaisesRegex(RuntimeError, 'update|lock'):
                    module.execute(args)
                inspect.assert_not_called()

    def test_default_check_only_reads_and_clears_its_lock(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(stack=root, current_package=root, apply=False, output=root / 'plan.json')
            update = SimpleNamespace(require_current_schema=lambda: None)
            plan = {'create': [1, 2, 3], 'changes': [1] * 8}
            with patch.object(module, 'make_update', return_value=(SimpleNamespace(), update)), \
                 patch.object(module, 'probe', return_value={'plan': plan}) as reads, \
                 patch.object(module, 'apply_repair') as apply:
                module.execute(args)
            self.assertFalse((root / '.offline-update-lock').exists())
            self.assertEqual(json.loads(args.output.read_text())['plan'], plan)
            self.assertEqual(reads.call_args.args[1], 'plan')
            apply.assert_not_called()

    def test_known_already_repaired_state_does_not_stop_services(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(stack=root, current_package=root, apply=True, output=root / 'plan.json')
            update = SimpleNamespace(require_current_schema=lambda: None)
            with patch.object(module, 'make_update', return_value=(SimpleNamespace(), update)), \
                 patch.object(module, 'probe', return_value={'plan': {'create': [], 'changes': []}}), \
                 patch.object(module, 'apply_repair') as apply:
                module.execute(args)
            self.assertFalse((root / '.offline-update-lock').exists())
            apply.assert_not_called()

    def test_uncertain_write_retains_lock_and_recovery_owner(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(stack=root, current_package=root, apply=True, output=root / 'plan.json')
            update = SimpleNamespace(require_current_schema=lambda: None, recovery_required=False)
            def uncertain(*args):
                update.recovery_required = True
                raise RuntimeError('write outcome unknown')
            with patch.object(module, 'make_update', return_value=(SimpleNamespace(), update)), \
                 patch.object(module, 'probe', return_value={'plan': {'create': [1], 'changes': [1]}}), \
                 patch.object(module, 'apply_repair', side_effect=uncertain):
                with self.assertRaises(RuntimeError):
                    module.execute(args)
            owner = json.loads((root / '.offline-update-lock' / 'owner.json').read_text())
            self.assertEqual(owner['phase'], 'recovery-required')

    def test_rehearsal_attaches_json_stdin_to_every_python_container(self):
        module = self.module()
        base = Mock()
        base.run.return_value = '[{"Labels":{}}]'
        base.inspect.return_value = {'Config': {'Labels': {}}}
        update = SimpleNamespace(old_backend='sha256:backend', database_image='sha256:postgres')
        def json_call(_base, command, action, **kwargs):
            self.assertIn('-i', command, 'Docker must forward the repair JSON on stdin')
            return {'snapshot': True}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'database.dump').write_bytes(b'fixture')
            with patch.object(module, 'run_json', side_effect=json_call), \
                 patch.object(module.checks, 'verify_preserved'):
                module.rehearse(SimpleNamespace(base=base), update, root, {'snapshot': True}, {})

    def test_configured_raw_backend_or_worker_is_refused_before_downtime(self):
        module = self.module()
        update = SimpleNamespace(old_backend='sha256:wrapper', old_frontend='sha256:front', schedulers=['beat'],
            services={name: {'image': name} for name in ('backend', 'worker', 'beat', 'frontend')})
        for changed in ('backend', 'worker', 'beat', 'frontend'):
            app = SimpleNamespace(base=SimpleNamespace(inspect=lambda ref: {
                'Id': 'sha256:raw' if ref == changed else
                      ('sha256:front' if ref == 'frontend' else 'sha256:wrapper')}))
            with self.subTest(service=changed), self.assertRaisesRegex(RuntimeError, 'configured|Configured'):
                module.validate_resume_images(app, update)

    def test_failed_prewrite_resume_closes_services_and_retains_recovery(self):
        module = self.module()
        base = Mock()
        base.inspect.return_value = {'State': {'ExitCode': 0}}
        update = SimpleNamespace(base=['docker', 'compose'], schedulers=['beat'], ids={'worker': 'worker'},
            check_space=Mock(), backup=Mock(side_effect=RuntimeError('backup disk failure')),
            recovery_required=False)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            root.mkdir(exist_ok=True)
            with patch.object(module, 'start_application'), \
                 patch.object(module, 'start_writers', side_effect=RuntimeError('proxy failed after worker started')), \
                 patch.object(module, 'close_for_recovery', return_value=True) as close:
                with self.assertRaises(RuntimeError):
                    module.apply_repair(SimpleNamespace(base=base), update, {}, root, {}, root)
            close.assert_called_once()
            self.assertTrue(update.recovery_required)
            self.assertTrue(update.closed_verified)
            receipt = json.loads((root / 'ORG-RECOVERY-REQUIRED.json').read_text())
            self.assertTrue(receipt['services_stopped'])

    def test_resume_pins_verified_immutable_application_images(self):
        module = self.module()
        app = SimpleNamespace(base=Mock())
        update = SimpleNamespace(org_app=app, base=['docker', 'compose'], schedulers=['beat'],
            old_backend='sha256:wrapper', old_frontend='sha256:front')
        module.start_application(update)
        module.start_writers(update)
        self.assertEqual(app.base.run.call_count, 3)
        for call in app.base.run.call_args_list:
            self.assertEqual(call.kwargs['env']['BACKEND_IMAGE'], update.old_backend)
            self.assertEqual(call.kwargs['env']['FRONTEND_IMAGE'], update.old_frontend)


if __name__ == '__main__':
    unittest.main()
