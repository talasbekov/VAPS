"""Portable delivery guards: changes survive recreation, unsafe versions fail."""

import argparse
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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


class PortableUpdates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = self.root / "stack"
        self.stack.mkdir()
        self.package = self.root / "package"
        self.package.mkdir()
        self.shell = self.root / "transferred" / "import-staffing.sh"
        self.shell.parent.mkdir()
        self.shell.touch()
        self.xlsx = self.root / "input.xlsx"
        self.xlsx.touch()
        self.args = argparse.Namespace(
            stack=self.stack,
            xlsx=self.xlsx,
            config=None,
            photos_dir=None,
            missing_parent_code="6769",
            apply=True,
            skip_invalid_iin=False,
            sheet=None,
        )
        self.old_files = {"a.py": b"old a", "b.py": b"old b"}
        self.new_files = {"a.py": b"new a", "b.py": b"new b", "c.py": b"added"}
        self.old = {
            "ctl": CTL,
            "source_commit": "historical",
            "base_files": {
                "a.py": self.digest(b"base"),
                "untouched.py": self.digest(b"base untouched"),
            },
            "base_variants": [{}],
            "files": self.hashes(self.old_files),
        }
        self.old_bytes = json.dumps(self.old, sort_keys=True, indent=2).encode()
        self.old_hash = self.digest(self.old_bytes)
        self.new = {
            **self.old,
            "source_commit": "current",
            "files": self.hashes(self.new_files),
            "previous_versions": [
                {"manifest_sha256": self.old_hash, "files": self.old["files"]}
            ],
        }
        self.new_bytes = json.dumps(self.new, sort_keys=True, indent=2).encode()
        (self.package / "manifest.json").write_bytes(self.new_bytes)
        for rel, data in self.new_files.items():
            portable.write_private(self.package / "files" / rel, data)
        for name in ("docker-compose.yml", "images.env", ".env"):
            (self.stack / name).write_text("secret must not be backed up")
        (self.stack / "ctl.sh").write_text(CTL)
        self.events = []

    @staticmethod
    def digest(data):
        return hashlib.sha256(data).hexdigest()

    def hashes(self, files):
        return {p: self.digest(data) for p, data in files.items()}

    def installed_old(self):
        home = self.stack / ".staffing-import"
        portable.write_private(home / "manifest.json", self.old_bytes)
        for rel, data in self.old_files.items():
            portable.write_private(home / "files" / rel, data)
        (self.stack / "ctl.sh").write_text(portable.patched_ctl(CTL, CTL))
        portable.write_private(
            self.stack / "docker-compose.staffing.yml",
            json.dumps(portable.overlay_config(self.old_files)).encode(),
        )

    def installer(self):
        with (
            patch.object(portable, "__file__", str(self.package / "runtime.py")),
            patch.dict(
                portable.os.environ, {"STAFFING_ORIGINAL_SHELL": str(self.shell)}
            ),
        ):
            obj = portable.Installer(self.args)

        def config():
            services = {
                name: {"image": "same", "pull_policy": "never", "volumes": []}
                for name in ("backend", "worker", "beat", "db", "frontend", "proxy")
            }
            if obj.ctl.read_text() != CTL:
                overlay = json.loads(
                    (self.stack / "docker-compose.staffing.yml").read_text()
                )
                for name, service in overlay["services"].items():
                    for volume in service["volumes"]:
                        volume["source"] = str(
                            (self.stack / volume["source"]).resolve()
                        )
                    services[name]["volumes"] = service["volumes"]
            return {"services": services}

        def compose(*args, **kwargs):
            self.events.append(args)
            if args[0] == "config":
                return json.dumps(config()).encode()

        def oneoff(*args, **kwargs):
            self.events.append(args)
            if args[0].endswith("fingerprint.py"):
                actual = dict(self.old["base_files"])
                for mount in config()["services"]["backend"]["volumes"]:
                    actual[mount["target"][5:]] = self.digest(
                        Path(mount["source"]).read_bytes()
                    )
                return json.dumps(actual).encode()

        def backup():
            self.events.append(("backup",))
            path = obj.home / "backups" / "database.dump"
            portable.write_private(path, b"verified database archive")
            return path

        obj.compose, obj.oneoff, obj.backup = compose, oneoff, backup
        return obj

    def test_missing_parent_target_is_passed_to_command(self):
        args = self.installer().roster_args()
        self.assertIn("--missing-parent-code", args)
        self.assertEqual(args[args.index("--missing-parent-code") + 1], "6769")

    def test_photos_discovered_next_to_original_shell_and_only_source_mounts(self):
        photos = self.shell.parent / "photos"
        photos.mkdir()
        # Neither the current directory nor the extracted payload determines discovery.
        obj = self.installer()
        self.assertEqual(obj.photos_dir, photos)
        self.assertIn("--photos-dir", obj.roster_args())
        portable.Installer.oneoff(obj, "probe", source=True)
        self.assertIn(str(photos) + ":/opt/staffing-photos:ro", self.events[-1])
        portable.Installer.oneoff(obj, "fingerprint", source=False)
        self.assertNotIn(str(photos) + ":/opt/staffing-photos:ro", self.events[-1])

    def test_explicit_missing_photos_is_an_error_and_absent_default_is_optional(self):
        self.assertNotIn("--photos-dir", self.installer().roster_args())
        self.args.photos_dir = self.root / "missing"
        with self.assertRaises(portable.InstallError):
            self.installer()
        self.args.photos_dir = self.xlsx
        with self.assertRaises(portable.InstallError):
            self.installer()

    def test_upgrade_backs_up_prior_overlay_and_recreates_consumers(self):
        self.installed_old()
        obj = self.installer()
        obj.run()
        snapshot = obj.home / "backups" / ("overlay-" + self.old_hash)
        self.assertEqual((snapshot / "manifest.json").read_bytes(), self.old_bytes)
        for rel, data in self.old_files.items():
            self.assertEqual((snapshot / "files" / rel).read_bytes(), data)
        self.assertEqual(
            json.loads((snapshot / "docker-compose.staffing.yml").read_text()),
            portable.overlay_config(self.old_files),
        )
        self.assertFalse((snapshot / ".env").exists())
        self.assertEqual((obj.home / "manifest.json").read_bytes(), self.new_bytes)
        starts = [event for event in self.events if event[0] == "up"]
        self.assertIn("--force-recreate", starts[0])
        self.assertLess(
            self.events.index(("backup",)),
            self.events.index(("manage.py", "migrate", "--noinput")),
        )
        self.assertFalse(obj.pending_path.exists())
        self.installer().run()  # exact version repeat import
        self.assertNotIn(
            "--force-recreate", [e for e in self.events if e[0] == "up"][-1]
        )

    def test_upgrade_preview_does_not_run_old_import_command_or_write(self):
        self.installed_old()
        self.args.apply = False
        self.installer().run()
        self.assertFalse(
            any(event[0] in ("backup", "stop", "manage.py") for event in self.events)
        )
        self.assertEqual(
            (self.stack / ".staffing-import/manifest.json").read_bytes(), self.old_bytes
        )

    def test_unknown_manifest_or_modified_prior_file_fails_closed(self):
        self.installed_old()
        home = self.stack / ".staffing-import"
        (home / "files/a.py").write_bytes(b"custom")
        with self.assertRaises(portable.InstallError):
            self.installer().run()
        (home / "files/a.py").write_bytes(self.old_files["a.py"])
        (home / "manifest.json").write_bytes(self.old_bytes + b" ")
        with self.assertRaises(portable.InstallError):
            self.installer().run()
        self.assertFalse(any(event[0] in ("stop", "backup") for event in self.events))

    def test_other_package_pending_is_rejected_even_for_allowlisted_old(self):
        self.installed_old()
        portable.write_private(
            self.stack / ".staffing-import/pending.json",
            json.dumps({"package_sha256": self.old_hash}).encode(),
        )
        with self.assertRaises(portable.InstallError):
            self.installer().run()

    def test_each_upgrade_stage_resumes_after_restart(self):
        self.installed_old()
        original = portable.write_private
        stages = [
            "a.py",
            "b.py",
            "c.py",
            "docker-compose.staffing.yml",
            "manifest.json",
            "ctl.sh",
        ]
        # Restart with a fresh stack for every atomic publication boundary.
        for stage in stages:
            with self.subTest(stage=stage):
                import shutil

                shutil.rmtree(self.stack / ".staffing-import", ignore_errors=True)
                self.installed_old()
                obj = self.installer()
                fired = False

                def interrupt(path, data, stage=stage, **kwargs):
                    nonlocal fired
                    original(path, data, **kwargs)
                    if path.name == stage and "backups" not in path.parts and not fired:
                        fired = True
                        raise OSError("power loss")

                with (
                    patch.object(portable, "write_private", interrupt),
                    self.assertRaises(OSError),
                ):
                    obj.run()
                self.assertTrue(fired)
                self.installer().run()
                self.assertEqual(
                    (obj.home / "manifest.json").read_bytes(), self.new_bytes
                )
                self.assertFalse(obj.pending_path.exists())

    def test_initial_install_resumes_through_verify_at_each_publication(self):
        import shutil

        original = portable.write_private
        for stage in (
            "a.py",
            "pending.json",
            "docker-compose.staffing.yml",
            "manifest.json",
            "ctl.sh",
        ):
            with self.subTest(stage=stage):
                shutil.rmtree(self.stack / ".staffing-import", ignore_errors=True)
                (self.stack / "docker-compose.staffing.yml").unlink(missing_ok=True)
                (self.stack / "ctl.sh").write_text(CTL)
                obj = self.installer()
                fired = False

                def interrupt(path, data, stage=stage, **kwargs):
                    nonlocal fired
                    original(path, data, **kwargs)
                    if path.name == stage and "backups" not in path.parts and not fired:
                        fired = True
                        raise OSError("power loss")

                with (
                    patch.object(portable, "write_private", interrupt),
                    self.assertRaises(OSError),
                ):
                    obj.run()
                self.installer().run()
                self.assertFalse(obj.pending_path.exists())

    def interrupt_upgrade(self):
        self.installed_old()
        obj = self.installer()
        original = portable.write_private

        def interrupt(path, data, **kwargs):
            original(path, data, **kwargs)
            if path == obj.home / "files/a.py":
                # Both backups must exist before the first old byte is replaced.
                snapshot = obj.home / "backups" / ("overlay-" + self.old_hash)
                self.assertEqual((snapshot / "files/a.py").read_bytes(), b"old a")
                self.assertTrue((obj.home / "backups/database.dump").is_file())
                raise OSError("power loss")

        with (
            patch.object(portable, "write_private", interrupt),
            self.assertRaises(OSError),
        ):
            obj.run()
        return obj

    def test_pending_cannot_authorize_unknown_code_or_missing_prior_file(self):
        obj = self.interrupt_upgrade()
        marker = json.loads(obj.pending_path.read_text())
        self.assertEqual(marker["package_sha256"], self.digest(self.new_bytes))
        self.assertEqual(marker["previous_sha256"], self.old_hash)
        (obj.home / "files/b.py").write_bytes(b"unknown")
        with self.assertRaises(portable.InstallError):
            self.installer().verify()
        (obj.home / "files/b.py").unlink()
        with self.assertRaises(portable.InstallError):
            self.installer().verify()

    def test_pending_requires_intact_backup_and_allowlisted_metadata(self):
        obj = self.interrupt_upgrade()
        snapshot = obj.home / "backups" / ("overlay-" + self.old_hash)
        (snapshot / "files/a.py").write_bytes(b"damaged")
        with self.assertRaises(portable.InstallError):
            self.installer().verify()
        (snapshot / "files/a.py").write_bytes(b"old a")
        (obj.home / "backups/database.dump").unlink()
        with self.assertRaises(portable.InstallError):
            self.installer().verify()
        marker = json.loads(obj.pending_path.read_text())
        marker["previous_sha256"] = "f" * 64
        obj.pending_path.write_text(json.dumps(marker))
        with self.assertRaises(portable.InstallError):
            self.installer().verify()

    def test_interrupted_start_keeps_marker_and_resume_recreates_again(self):
        self.installed_old()
        obj = self.installer()
        original = obj.compose

        def fail_start(*args, **kwargs):
            if args[0] == "up":
                raise portable.InstallError("container failed health check")
            return original(*args, **kwargs)

        obj.compose = fail_start
        with self.assertRaises(portable.InstallError):
            obj.run()
        self.assertTrue(obj.pending_path.exists())
        self.installer().run()
        self.assertFalse(obj.pending_path.exists())
        self.assertIn("--force-recreate", [e for e in self.events if e[0] == "up"][-1])

    def test_database_backup_is_durable_before_it_is_returned(self):
        import stat
        import subprocess

        obj = self.installer()
        synced = []
        real_fsync = portable.os.fsync

        def fsync(fd):
            mode = portable.os.fstat(fd).st_mode
            synced.append("file" if stat.S_ISREG(mode) else "directory")
            real_fsync(fd)

        def dump(*args, output=None, **kwargs):
            output.write(b"database archive")

        obj.compose = dump
        with (
            patch.object(portable.os, "fsync", fsync),
            patch.object(
                portable.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0),
            ),
        ):
            result = portable.Installer.backup(obj)
        self.assertEqual(result.read_bytes(), b"database archive")
        self.assertEqual(synced, ["file", "directory"])
        self.assertEqual(result.stat().st_mode & 0o777, 0o600)

    def test_source_oneoff_rejects_photos_removed_after_preflight(self):
        photos = self.shell.parent / "photos"
        photos.mkdir()
        obj = self.installer()
        photos.rmdir()
        with self.assertRaises(portable.InstallError):
            portable.Installer.oneoff(obj, "probe", source=True)

    def test_unknown_mixture_without_own_pending_is_rejected(self):
        self.installed_old()
        (self.stack / ".staffing-import/files/a.py").write_bytes(self.new_files["a.py"])
        with self.assertRaises(portable.InstallError):
            self.installer().verify()


class BuilderHistory(unittest.TestCase):
    def test_previous_maps_come_from_pinned_git_and_match_delivered_manifest(self):
        spec = importlib.util.spec_from_file_location(
            "builder", Path(__file__).parents[1] / "build.py"
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        versions = builder.previous_versions()
        self.assertEqual(len(versions), 3)
        self.assertEqual(
            {v["manifest_sha256"] for v in versions},
            {
                "70b30e60678355315604ba093ae13683680a4c23bdca6d8a85382da1cccf5a41",
                "b0881be67dc144a6cb2d2cf2eb3e33660af40ff6ec4cda9c06e64395fd75ae8d",
                "b3c9deee03303eae8d5bf0a9d147f8bf4941c4cf06b8958c665a31826b00fe80",
            },
        )
        self.assertEqual(
            {v["manifest_sha256"]: len(v["files"]) for v in versions},
            {
                "70b30e60678355315604ba093ae13683680a4c23bdca6d8a85382da1cccf5a41": 13,
                "b0881be67dc144a6cb2d2cf2eb3e33660af40ff6ec4cda9c06e64395fd75ae8d": 12,
                "b3c9deee03303eae8d5bf0a9d147f8bf4941c4cf06b8958c665a31826b00fe80": 12,
            },
        )

    def test_built_launcher_preserves_original_location_from_different_cwd(self):
        import base64
        import io
        import subprocess
        import zipfile

        spec = importlib.util.spec_from_file_location(
            "builder", Path(__file__).parents[1] / "build.py"
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            output = root / "delivery with spaces" / "import-staffing.sh"
            real_check_output = subprocess.check_output

            def no_docker(command, **kwargs):
                if command[0] == "docker":
                    self.assertEqual(command.count("--pull=never"), 1)
                    return b'{"base.py": "known fingerprint"}'
                return real_check_output(command, **kwargs)

            with (
                patch.object(builder.subprocess, "check_output", no_docker),
                patch("sys.argv", ["build.py", "--output", str(output)]),
            ):
                builder.main()
            shell, payload = output.read_bytes().split(b"\n__STAFFING_PAYLOAD__\n", 1)
            archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(payload)))
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["previous_versions"], builder.previous_versions())
            # Exercise the real generated launcher with a recorder instead of Docker runtime.
            replacement = io.BytesIO()
            with zipfile.ZipFile(replacement, "w") as z:
                z.writestr(
                    "runtime.py",
                    "import os, sys, json; print(json.dumps([os.environ['STAFFING_ORIGINAL_SHELL'], sys.argv[1:]]))",
                )
            old_hash = hashlib.sha256(base64.b64decode(payload)).hexdigest().encode()
            new_hash = hashlib.sha256(replacement.getvalue()).hexdigest().encode()
            output.write_bytes(
                shell.replace(old_hash, new_hash)
                + b"\n__STAFFING_PAYLOAD__\n"
                + base64.encodebytes(replacement.getvalue())
            )
            elsewhere = root / "elsewhere"
            elsewhere.mkdir()
            result = subprocess.check_output(
                [
                    "bash",
                    str(output),
                    "file with spaces.xlsx",
                    "--photos-dir",
                    "relative photos",
                ],
                cwd=elsewhere,
            )
            origin, args = json.loads(result)
            self.assertEqual(origin, str(output))
            self.assertEqual(
                args, ["file with spaces.xlsx", "--photos-dir", "relative photos"]
            )


if __name__ == "__main__":
    unittest.main()
