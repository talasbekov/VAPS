import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("sync_export", Path(__file__).parents[1] / "sync-github-export.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sj-sync-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.target = self.root / "source", self.root / "target"
        for root in (self.source, self.target):
            root.mkdir()
            self.git(root, "init", "-q")
            self.git(root, "config", "user.email", "test@example.invalid")
            self.git(root, "config", "user.name", "Export Test")
            self.git(root, "config", "core.autocrlf", "false")
            (root / "KEEP").write_text("unmanaged", encoding="utf-8")
            self.commit(root)
        self.write("PersonnelStatus/Personnel-Records/manage.py", "current")
        self.write("PersonnelStatus/PersonalRecordFront/package.json", "{}")
        self.write("PersonnelStatus/PersonalRecordFront/personalrecordfront-frontend.tar", "excluded")
        self.write("PersonnelStatus/Personnel-Records/.env", "secret")
        self.write("deploy/lan/.env.example", "safe template")
        self.commit(self.source)

    def git(self, root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL)

    def commit(self, root):
        self.git(root, "add", "-A")
        self.git(root, "commit", "-qm", "fixture")

    def write(self, name, text):
        file = self.source / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8")

    def test_dry_run_and_immutable_revision_preserve_unmanaged_files_and_exclude_secrets(self):
        first = self.git(self.source, "rev-parse", "HEAD").decode().strip()
        result = sync.synchronize(self.source, self.target, first)
        self.assertGreater(result["changed"], 0)
        self.assertFalse((self.target / "backend").exists())
        self.write("PersonnelStatus/Personnel-Records/manage.py", "dirty working copy")
        sync.synchronize(self.source, self.target, first, True)
        self.assertEqual((self.target / "backend/manage.py").read_text(), "current")
        self.assertEqual((self.target / "KEEP").read_text(), "unmanaged")
        self.assertFalse((self.target / "backend/.env").exists())
        self.assertFalse((self.target / "frontend/personalrecordfront-frontend.tar").exists())
        self.assertTrue((self.target / "deploy/lan/.env.example").exists())
        self.commit(self.target)
        self.assertEqual(sync.synchronize(self.source, self.target, first)["changed"], 0)

    def test_dirty_destination_is_refused(self):
        (self.target / "KEEP").write_text("user change")
        with self.assertRaisesRegex(ValueError, "local changes"):
            sync.synchronize(self.source, self.target, apply=True)

    def test_deletion_only_removes_a_previously_exported_file(self):
        sync.synchronize(self.source, self.target, apply=True)
        (self.target / "backend/user-file.py").write_text("preserve")
        self.commit(self.target)
        (self.source / "PersonnelStatus/Personnel-Records/manage.py").unlink()
        self.commit(self.source)
        result = sync.synchronize(self.source, self.target, apply=True)
        self.assertEqual(result["removed"], 1)
        self.assertFalse((self.target / "backend/manage.py").exists())
        self.assertEqual((self.target / "backend/user-file.py").read_text(), "preserve")

    def test_manifest_cannot_escape_the_target(self):
        sync.synchronize(self.source, self.target, apply=True)
        manifest = self.target / sync.MANIFEST
        value = json.loads(manifest.read_text())
        value["files"]["backend/../../../outside"] = {"sha256": "bad"}
        manifest.write_text(json.dumps(value))
        self.commit(self.target)
        with self.assertRaisesRegex(ValueError, "escapes"):
            sync.synchronize(self.source, self.target, apply=True)

if __name__ == "__main__":
    unittest.main()
