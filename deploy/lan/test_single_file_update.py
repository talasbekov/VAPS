"""Exercise the Linux entrypoint, replacing only the deployment boundary."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(sys.platform == 'linux', 'Requires the target Linux shell')
class SingleFileUpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='smart launcher space ')
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.calls = self.folder / 'calls.json'

    def bundle(self, bad_sum=False, extra=False, fail=False):
        # Updater itself owns Docker, backups and transactional migration tests.
        updater = ("import json, os, sys\nfrom pathlib import Path\n"
                   "Path(os.environ['CALLS']).write_text(json.dumps(sys.argv[1:]))\n"
                   + ('sys.exit(7)\n' if fail else "print('UPDATE PASSED')\n")).encode()
        digest = '0' * 64 if bad_sum else hashlib.sha256(updater).hexdigest()
        archive = self.folder / 'payload.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('package/update-with-migrations.py', updater)
            z.writestr('package/SHA256SUMS', digest + '  update-with-migrations.py\r\n')
            if extra:
                z.writestr('../escaped', 'bad')
        launcher = self.folder / 'update smart.sh'
        result = subprocess.run([sys.executable, str(HERE / 'build-single-file.py'),
                                 str(archive), str(launcher)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return launcher

    def run_launcher(self, launcher, *args):
        return subprocess.run(['sh', str(launcher), *args], cwd=self.folder,
                              env={**os.environ, 'CALLS': str(self.calls)},
                              capture_output=True, text=True)

    def test_one_command_accepts_crlf_and_preserves_stack_argument_spaces(self):
        result = self.run_launcher(self.bundle(), '--stack', '/srv/smart production')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.calls.read_text()), ['--apply', '--stack', '/srv/smart production'])

    def test_verify_only_never_runs_updater(self):
        result = self.run_launcher(self.bundle(), '--verify-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.calls.exists())

    def test_check_does_not_apply(self):
        result = self.run_launcher(self.bundle(), '--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.calls.read_text()), ['--check'])

    def test_corrupt_payload_stops_before_updater(self):
        launcher = self.bundle()
        with launcher.open('ab') as stream:
            stream.write(b'corruption')
        result = self.run_launcher(launcher)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_bad_file_checksum_stops_before_updater(self):
        result = self.run_launcher(self.bundle(bad_sum=True))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_unsafe_archive_path_stops_before_extraction(self):
        result = self.run_launcher(self.bundle(extra=True))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.folder / 'escaped').exists())
        self.assertFalse(self.calls.exists())

    def test_updater_failure_propagates_and_retains_package(self):
        result = self.run_launcher(self.bundle(fail=True))
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertTrue(list(self.folder.glob('smart-update-*/package/update-with-migrations.py')))
        self.assertNotIn('UPDATE PASSED', result.stdout)

    def test_unknown_argument_stops_before_updater(self):
        result = self.run_launcher(self.bundle(), '--force')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())


if __name__ == '__main__':
    unittest.main()
