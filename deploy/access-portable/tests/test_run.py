import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RUN = Path(__file__).resolve().parents[1] / 'run.py'


class RunnerTests(unittest.TestCase):
    def test_backup_is_saved_before_ack_and_no_raw_usernames_in_console(self):
        self.assertTrue(RUN.exists(), 'host runner is missing')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'roles.json').write_text('{}')
            (root/'ctl.sh').write_text('''#!/bin/bash
exec python3 -c '
import json,sys
request=json.loads(sys.stdin.readline())
print(json.dumps({"backup": {"users":[{"username":"PRIVATE_LOGIN"}]}}),flush=True)
assert sys.stdin.readline().strip()=="continue"
print(json.dumps({"result":{"applied":True,"matched":2,"changed_users":2,"missing_users":["PRIVATE_LOGIN"]}}),flush=True)
'
''')
            res = subprocess.run([sys.executable,str(RUN),'--data',str(root/'roles.json'),'--apply'],
                                 cwd=root,capture_output=True,text=True,check=False)
            self.assertEqual(res.returncode,0,res.stderr+res.stdout)
            self.assertNotIn('PRIVATE_LOGIN',res.stdout+res.stderr)
            backups = list(root.glob('.access-transfer/*/before.json'))
            self.assertEqual(len(backups),1)
            self.assertIn('PRIVATE_LOGIN',backups[0].read_text())
            self.assertEqual(backups[0].stat().st_mode & 0o777,0o600)

    def test_parent_directories_are_durable_before_backend_launch(self):
        spec = importlib.util.spec_from_file_location('access_runner', RUN)
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'roles.json').write_text('{}')
            (root/'ctl.sh').write_text('placeholder')
            synced = []
            actual = os.fsync
            def sync(fd):
                synced.append(Path(os.readlink('/proc/self/fd/'+str(fd))))
                actual(fd)
            def launch(*args, **kwargs):
                self.assertIn(root, synced)
                self.assertIn(root/'.access-transfer', synced)
                raise OSError('stop after verifying fsync order')
            with patch.object(Path, 'cwd', return_value=root), patch.object(sys, 'argv',
                    ['run.py','--data',str(root/'roles.json')]), patch.object(os, 'fsync', sync), \
                    patch.object(runner.subprocess, 'Popen', launch), self.assertRaises(OSError):
                runner.main()

    def test_failed_or_incomplete_backend_is_not_success(self):
        self.assertTrue(RUN.exists(), 'host runner is missing')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'roles.json').write_text('{}')
            (root/'ctl.sh').write_text('#!/bin/bash\nexit 0\n')
            res=subprocess.run([sys.executable,str(RUN),'--data',str(root/'roles.json')],
                               cwd=root,capture_output=True,text=True,check=False)
            self.assertNotEqual(res.returncode,0)


if __name__=='__main__':
    unittest.main()
