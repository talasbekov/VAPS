"""Portable delivery guards: changes survive recreation, unsafe versions fail."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "portable", Path(__file__).parents[1] / "runtime.py"
)
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)

CTL = '#!/usr/bin/env bash\nset -euo pipefail\ncd -- "$(dirname -- "$0")"\nexec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"\n'


class Guards(unittest.TestCase):
    def test_only_expected_launcher_is_patched(self):
        patched = portable.patched_ctl(CTL, CTL)
        self.assertIn('-f docker-compose.staffing.yml "$@"', patched)
        self.assertEqual(portable.patched_ctl(patched, CTL), patched)
        with self.assertRaises(portable.InstallError):
            portable.patched_ctl(CTL + "# custom\n", CTL)

    def test_all_python_consumers_get_persistent_readonly_files(self):
        config = portable.overlay_config(
            ["organization_management/apps/employees/models.py"]
        )
        self.assertEqual(set(config["services"]), {"backend", "worker", "beat"})
        for service in config["services"].values():
            mount = service["volumes"][0]
            self.assertTrue(mount["read_only"])
            self.assertFalse(mount["bind"]["create_host_path"])
            self.assertEqual(
                mount["target"], "/app/organization_management/apps/employees/models.py"
            )
            self.assertTrue(mount["source"].startswith("./.staffing-import/files/"))

    def test_version_check_accepts_base_or_our_complete_overlay(self):
        base = {"a.py": "old", "b.py": "same"}
        new = {"a.py": "new", "c.py": "added"}
        portable.check_hashes(base, base, new, installed=False)
        portable.check_hashes(
            {"a.py": "new", "b.py": "same", "c.py": "added"}, base, new, installed=True
        )
        for actual in (
            {"a.py": "custom", "b.py": "same"},
            {"a.py": "old", "b.py": "same", "extra.py": "unknown"},
        ):
            with self.assertRaises(portable.InstallError):
                portable.check_hashes(actual, base, new, installed=False)

    def test_interrupted_overlay_is_not_mistaken_for_original(self):
        with self.assertRaises(portable.InstallError):
            portable.check_hashes(
                {"a.py": "new"},
                {"a.py": "old"},
                {"a.py": "new", "c.py": "added"},
                installed=True,
            )

    def test_private_write_does_not_replace_an_unrelated_file(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / "report"
            portable.write_private(p, b"first", exclusive=True)
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                portable.write_private(p, b"second", exclusive=True)
            self.assertEqual(p.read_bytes(), b"first")

    def test_mount_overlap_rejected(self):
        config = {
            "services": {
                "backend": {"volumes": [{"type": "bind", "target": "/app"}]},
                "worker": {},
                "beat": {},
            }
        }
        with self.assertRaises(portable.InstallError):
            portable.check_mounts(
                config,
                ["organization_management/apps/employees/models.py"],
                installed=False,
            )


class Recovery(unittest.TestCase):
    def test_checksums_only_change_ctl_entry(self):
        import hashlib

        digest = hashlib.sha256(CTL.encode()).hexdigest()
        text = digest + "  ctl.sh\n" + "0" * 64 + "  images.env\n"
        updated = portable.patched_checksums(text, CTL)
        self.assertEqual(updated.splitlines()[1], text.splitlines()[1])
        self.assertEqual(portable.patched_checksums(updated, CTL), updated)
        with self.assertRaises(portable.InstallError):
            portable.patched_checksums("0" * 64 + "  ctl.sh\n", CTL)

    def test_each_interrupted_install_stage_can_be_retried(self):
        import hashlib
        from unittest.mock import patch

        stages = [
            "ctl.sh.before",
            "sha256sums.txt.before",
            "docker-compose.staffing.yml",
            "manifest.json",
            "ctl.sh",
            "sha256sums.txt",
            "migration",
        ]
        for stage in stages:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                installer = portable.Installer.__new__(portable.Installer)
                installer.stack = root / "stack"
                installer.stack.mkdir()
                installer.home = installer.stack / ".staffing-import"
                installer.package = root / "package"
                installer.package.mkdir()
                installer.ctl = installer.stack / "ctl.sh"
                installer.ctl.write_text(CTL)
                installer.ctl.chmod(0o755)
                installer.original_ctl = CTL
                payload = installer.package / "files/a.py"
                payload.parent.mkdir()
                payload.write_text("new code")
                installer.manifest = {
                    "files": {"a.py": hashlib.sha256(payload.read_bytes()).hexdigest()}
                }
                (installer.package / "manifest.json").write_text(
                    json.dumps(installer.manifest)
                )
                (installer.stack / "sha256sums.txt").write_text(
                    hashlib.sha256(CTL.encode()).hexdigest() + "  ctl.sh\n"
                )
                fired = False
                original = portable.write_private
                migration_calls = []

                def interrupt(path, data, original=original, stage=stage, **kwargs):
                    nonlocal fired
                    original(path, data, **kwargs)
                    if path.name == stage and not fired:
                        fired = True
                        raise OSError("simulated power interruption")

                def migrate(*args, stage=stage, migration_calls=migration_calls):
                    nonlocal fired
                    migration_calls.append(args)
                    if stage == "migration" and not fired:
                        fired = True
                        raise OSError("simulated interruption after migration")

                installer.oneoff = migrate
                with (
                    patch.object(portable, "write_private", interrupt),
                    self.assertRaises(OSError),
                ):
                    installer.install()
                installer.install()
                self.assertEqual(
                    installer.ctl.read_text(), portable.patched_ctl(CTL, CTL)
                )
                self.assertEqual(installer.ctl.stat().st_mode & 0o777, 0o755)
                self.assertEqual((installer.home / "ctl.sh.before").read_text(), CTL)
                self.assertTrue(migration_calls)
                self.assertEqual(
                    (installer.home / "files/a.py").read_text(), "new code"
                )
                sums = (installer.stack / "sha256sums.txt").read_text()
                self.assertTrue(
                    sums.startswith(
                        hashlib.sha256(installer.ctl.read_bytes()).hexdigest()
                    )
                )


class PartialWrites(unittest.TestCase):
    def test_partial_original_or_marker_is_never_published(self):
        from unittest.mock import patch

        real_fdopen = portable.os.fdopen

        class BrokenWriter:
            def __init__(self, fd, mode):
                self.stream = real_fdopen(fd, mode)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stream.close()

            def write(self, data):
                self.stream.write(data[:3])
                raise OSError("simulated ENOSPC during write")

        for filename in ("pending.json", "ctl.sh.before", "sha256sums.txt.before"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as root:
                path = Path(root) / filename
                with (
                    patch.object(portable.os, "fdopen", BrokenWriter),
                    self.assertRaises(OSError),
                ):
                    portable.write_private(
                        path, b"complete backup content", exclusive=True
                    )
                self.assertFalse(path.exists())
                self.assertEqual(list(Path(root).iterdir()), [])
                portable.write_private(path, b"complete backup content", exclusive=True)
                self.assertEqual(path.read_bytes(), b"complete backup content")

    def test_partial_replacement_preserves_existing_launcher(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "ctl.sh"
            path.write_bytes(b"existing launcher")
            with (
                patch.object(portable.os, "fsync", side_effect=OSError("disk full")),
                self.assertRaises(OSError),
            ):
                portable.write_private(path, b"new launcher")
            self.assertEqual(path.read_bytes(), b"existing launcher")


if __name__ == "__main__":
    unittest.main()
