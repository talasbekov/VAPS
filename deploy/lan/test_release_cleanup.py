"""Deletion is allowed only for verified, obsolete application packages."""
import hashlib
import importlib.util
import json
import os
import struct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import zipfile


CURRENT = 'c' * 40
RECENT = 'b' * 40
OLD = 'a' * 40


class ReleaseCleanupTests(unittest.TestCase):
    def setUp(self):
        file = Path(__file__).with_name('cleanup-old-releases.py')
        self.assertTrue(file.is_file(), 'Safe release cleanup is missing')
        spec = importlib.util.spec_from_file_location('release_cleanup', file)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'Smart Josparlau'
        self.root.mkdir()

    def package(self, name, revision=OLD, *, timestamp=100):
        folder = self.root / name
        folder.mkdir()
        files = {}
        for filename in ('application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py'):
            body = ('test payload ' + filename).encode()
            (folder / filename).write_bytes(body)
            files[filename] = hashlib.sha256(body).hexdigest()
        manifest = {'source_revision': revision, 'compatibility_overlay': False,
                    'images': {key: {'tag': 'smart-josparlau/lan-' + key + ':reliability-' + revision[:12]}
                               for key in ('backend', 'frontend')}, 'files': files}
        (folder / 'release.json').write_text(json.dumps(manifest), encoding='utf-8')
        os.utime(folder, (timestamp, timestamp))
        return folder

    def archive(self, folder, name):
        target = self.root / name
        with zipfile.ZipFile(target, 'w') as archive:
            for file in folder.iterdir():
                archive.write(file, 'smart-josparlau-update/' + file.name)
        stamp = folder.stat().st_mtime
        os.utime(target, (stamp, stamp))
        return target

    def plan(self, protected=()):
        return self.module.plan_cleanup(self.root, protected=list(protected), current_revision=CURRENT)

    def test_retains_current_and_one_previous_revision_in_all_representations(self):
        old = self.package('old')
        recent = self.package('previous', RECENT, timestamp=200)
        current = self.package('new', CURRENT, timestamp=300)
        previous_zip = self.archive(recent, 'Smart-Josparlau-update-previous.zip')
        plan = self.plan()
        self.assertEqual({item['path'] for item in plan['remove']}, {str(old)})
        self.module.apply_plan(plan, protected=[])
        self.assertFalse(old.exists())
        self.assertTrue(all(path.exists() for path in (recent, current, previous_zip)))

    def test_unknown_data_and_full_installations_are_preserved(self):
        self.package('previous', RECENT, timestamp=200)
        sensitive = self.package('looks-like-update')
        (sensitive / '.env').write_text('do not delete')
        installed = self.package('old-installation')
        (installed / 'source').mkdir()
        unrelated = self.root / 'Digital'
        unrelated.mkdir()
        (unrelated / 'file.txt').write_text('other project')
        plan = self.plan()
        self.assertEqual(plan['remove'], [])
        self.module.apply_plan(plan, protected=[])
        self.assertEqual((sensitive / '.env').read_text(), 'do not delete')
        self.assertEqual((unrelated / 'file.txt').read_text(), 'other project')
        self.assertTrue((installed / 'source').is_dir())

    def test_container_paths_and_current_package_wrapper_are_preserved(self):
        self.package('previous', RECENT, timestamp=200)
        mounted = self.package('mounted-old')
        wrapper = self.root / 'current-extraction'
        wrapper.mkdir()
        current = self.package('temporary-name', CURRENT, timestamp=300)
        current.rename(wrapper / 'smart-josparlau-update')
        plan = self.plan([mounted / 'update.py', wrapper / 'smart-josparlau-update'])
        self.assertEqual(plan['remove'], [])

    def test_corrupt_payload_never_becomes_a_delete_candidate(self):
        self.package('previous', RECENT, timestamp=200)
        broken = self.package('broken')
        (broken / 'update.py').write_text('changed')
        self.assertEqual(self.plan()['remove'], [])

    def test_zip_is_checked_without_extracting_and_rejects_extra_data(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        valid = self.archive(old, 'Smart-Josparlau-update-old.zip')
        bad = self.archive(old, 'Smart-Josparlau-update-bad.zip')
        with zipfile.ZipFile(bad, 'a') as archive:
            archive.writestr('smart-josparlau-update/media/document.pdf', 'private')
        traversal = self.archive(old, 'Smart-Josparlau-update-traversal.zip')
        with zipfile.ZipFile(traversal, 'a') as archive:
            archive.writestr('../update.py', 'outside')
        plan = self.plan([old])
        self.assertEqual({item['path'] for item in plan['remove']}, {str(valid)})
        self.module.apply_plan(plan, protected=[old])
        self.assertFalse(valid.exists())
        self.assertTrue(bad.exists() and traversal.exists() and old.exists())

    def test_changed_file_between_plan_and_apply_prevents_deletion(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        plan = self.plan()
        (old / 'update.py').write_text('new data arrived after planning')
        with self.assertRaises((RuntimeError, ValueError)):
            self.module.apply_plan(plan, protected=[])
        self.assertEqual((old / 'update.py').read_text(), 'new data arrived after planning')
        self.assertTrue((old / 'application-images.tar').exists())

    def test_new_unknown_file_between_plan_and_apply_prevents_deletion(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        plan = self.plan()
        (old / 'important.txt').write_text('new data')
        with self.assertRaises((RuntimeError, ValueError)):
            self.module.apply_plan(plan, protected=[])
        self.assertTrue((old / 'application-images.tar').exists())

    def test_new_container_mount_after_planning_prevents_deletion(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        plan = self.plan()
        with self.assertRaises((RuntimeError, ValueError)):
            self.module.apply_plan(plan, protected=lambda: [old / 'application-images.tar'])
        self.assertTrue(old.is_dir())

    def test_symlinks_and_mount_points_are_never_removed(self):
        self.package('previous', RECENT, timestamp=200)
        mounted = self.package('mounted')
        original = self.module.os.path.ismount
        with patch.object(self.module.os.path, 'ismount', side_effect=lambda value: Path(value) == mounted or original(value)):
            self.assertEqual(self.plan()['remove'], [])
        target = self.root.parent / 'foreign'
        target.mkdir()
        link = self.root / 'linked'
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            return  # Linux suite exercises this branch; Windows may not allow symlinks.
        plan = self.plan([mounted])
        self.assertEqual(plan['remove'], [])
        self.assertTrue(link.is_symlink() and target.is_dir())

    def test_no_previous_revision_means_no_deletions(self):
        only = self.package('only-old')
        self.assertEqual(self.plan()['remove'], [])
        self.assertTrue(only.is_dir())

    def test_missing_success_receipt_refuses_cleanup(self):
        backup = self.root / 'backups'
        backup.mkdir()
        with self.assertRaises((RuntimeError, ValueError, OSError)):
            self.module.cleanup_after_update(SimpleNamespace(stack=self.root), backup, self.root, self.root)

    def test_zip_symlink_is_preserved(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        bad = self.archive(old, 'Smart-Josparlau-update-link.zip')
        with zipfile.ZipFile(bad, 'a') as archive:
            item = zipfile.ZipInfo('smart-josparlau-update/link')
            item.create_system = 3
            item.external_attr = 0o120777 << 16
            archive.writestr(item, '/etc/passwd')
        self.assertEqual(self.plan([old])['remove'], [])

    def test_corrupted_deflate_payload_is_skipped_without_aborting_cleanup(self):
        self.package('previous', RECENT, timestamp=200)
        old = self.package('old')
        broken = self.root / 'Smart-Josparlau-update-corrupt.zip'
        with zipfile.ZipFile(broken, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for file in old.iterdir():
                archive.write(file, 'smart-josparlau-update/' + file.name)
        with zipfile.ZipFile(broken) as archive:
            member = archive.getinfo('smart-josparlau-update/update.py')
        with broken.open('r+b') as stream:
            stream.seek(member.header_offset + 26)
            name_length, extra_length = struct.unpack('<HH', stream.read(4))
            stream.seek(member.header_offset + 30 + name_length + extra_length)
            stream.write(b'\x07')  # Invalid DEFLATE block type; central directory remains readable.
        plan = self.plan([old])
        self.assertEqual(plan['remove'], [])
        self.assertTrue(any(item['path'] == str(broken) for item in plan['skip']))
        self.assertTrue(broken.exists())

    def live_fixture(self):
        stack = self.root / 'active-installation'
        stack.mkdir()
        backup = stack / 'backups' / 'updates' / 'this-update'
        backup.mkdir(parents=True)
        package = self.package('current', CURRENT, timestamp=300)
        receipt = {'mode': 'application-only', 'migrations_executed': False,
                   'all_database_tables_schema_and_sequences_match': True,
                   'database_container_unchanged': True, 'backup_restored_and_compared': True,
                   'verified_before_resuming_background_jobs': True,
                   'backend_image': 'sha256:new-backend', 'frontend_image': 'new-frontend'}
        (backup / 'SUCCESS.json').write_text(json.dumps(receipt))
        containers = []
        for service in ('db', 'backend', 'frontend'):
            containers.append({'Id': service + '-id', 'Image': 'sha256:config-' + service,
                'Config': {'Image': receipt.get(service + '_image', 'postgres:16'), 'Labels': {
                    'com.docker.compose.project': 'smart-test', 'com.docker.compose.service': service,
                    'com.docker.compose.project.working_dir': str(stack),
                    'com.docker.compose.project.config_files': str(stack / 'docker-compose.yml')}},
                'State': {'Running': True}, 'Mounts': [{'Type': 'volume', 'Name': 'db-data',
                    'Source': '/var/lib/docker/volumes/db-data/_data', 'Destination': '/var/lib/postgresql/data'}]
                    if service == 'db' else []})
        update = SimpleNamespace(stack=stack, config={'name': 'smart-test'}, db={'Id': 'db-id'}, volume='db-data')
        return update, backup, package, containers

    def docker_output(self, containers, volumes=()):
        def output(command):
            if command[1:3] == ['context', 'inspect']: return json.dumps('unix:///var/run/docker.sock')
            if command[1:3] == ['ps', '-aq']: return ' '.join(row['Id'] for row in containers)
            if command[1] == 'inspect': return json.dumps(containers)
            if command[1:3] == ['volume', 'inspect']:
                known = {row['Name']: row for row in volumes}
                return json.dumps([known.get(name, {'Name': name, 'Options': None}) for name in command[3:]])
            raise AssertionError('Unexpected Docker command: ' + repr(command))
        return output

    def test_bind_backed_named_volume_of_another_project_protects_actual_device(self):
        update, _, _, containers = self.live_fixture()
        mounted = self.package('mounted-via-named-volume')
        containers.append({'Id': 'digital', 'Image': 'other', 'Config': {'Labels': {}},
            'State': {'Running': False}, 'Mounts': [{'Type': 'volume', 'Name': 'digital-bind',
                'Source': '/var/lib/docker/volumes/digital-bind/_data', 'Destination': '/data'}]})
        volumes = [{'Name': 'db-data', 'Options': None}, {'Name': 'digital-bind', 'Driver': 'local',
                    'Options': {'type': 'none', 'o': 'bind', 'device': str(mounted)}}]
        with patch.dict(os.environ, {'DOCKER_HOST': '', 'DOCKER_CONTEXT': ''}), \
             patch.object(self.module, '_output', side_effect=self.docker_output(containers, volumes)):
            protected = self.module._container_paths(update.stack, 'smart-test')
        self.assertIn(mounted, protected, 'A bind-backed named volume exposes its device, not Docker _data')

    def test_same_filesystem_bind_mount_and_escaped_mountinfo_paths_are_protected(self):
        self.assertTrue(hasattr(self.module, '_mount_points'), 'Linux bind-mount detection is missing')
        mounted = self.package('bind mount with spaces')
        self.package('previous', RECENT, timestamp=200)
        with patch.object(self.module, '_mount_points', return_value={mounted}), \
             patch.object(self.module.os.path, 'ismount', return_value=False):
            self.assertEqual(self.plan()['remove'], [], 'Same-device bind mounts can pass os.path.ismount')
        line = '50 40 8:1 /origin /srv/Smart\\040Josparlau/old rw,relatime - ext4 /dev/sda1 rw\n'
        with patch.object(self.module.sys, 'platform', 'linux'), \
             patch.object(self.module.Path, 'read_text', return_value=line):
            self.assertIn(Path('/srv/Smart Josparlau/old').resolve(), self.module._mount_points())

    def test_success_receipt_and_live_images_gate_real_file_cleanup(self):
        update, backup, package, containers = self.live_fixture()
        old = self.package('old')
        previous = self.package('previous', RECENT, timestamp=200)
        with patch.dict(os.environ, {'DOCKER_HOST': '', 'DOCKER_CONTEXT': ''}), \
             patch.object(self.module, '_output', side_effect=self.docker_output(containers)):
            result = self.module.cleanup_after_update(update, backup, self.root, package)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['removed'], [str(old)])
        self.assertFalse(old.exists())
        self.assertTrue(previous.exists() and package.exists() and (backup / 'SUCCESS.json').exists())
        self.assertEqual(json.loads((backup / 'CLEANUP.json').read_text())['status'], 'complete')

    def test_live_image_mismatch_or_remote_daemon_never_deletes_files(self):
        update, backup, package, containers = self.live_fixture()
        old = self.package('old')
        self.package('previous', RECENT, timestamp=200)
        containers[1]['Config']['Image'] = 'different-backend'
        with patch.dict(os.environ, {'DOCKER_HOST': '', 'DOCKER_CONTEXT': ''}), \
             patch.object(self.module, '_output', side_effect=self.docker_output(containers)):
            with self.assertRaisesRegex(RuntimeError, 'differs from update SUCCESS'):
                self.module.cleanup_after_update(update, backup, self.root, package)
        with patch.dict(os.environ, {'DOCKER_HOST': 'tcp://remote-server:2375', 'DOCKER_CONTEXT': ''}), \
             patch.object(self.module, '_output') as command:
            with self.assertRaisesRegex(RuntimeError, 'local Docker'):
                self.module.cleanup_after_update(update, backup, self.root, package)
            command.assert_not_called()
        self.assertTrue(old.exists())

    def test_changed_success_after_inspection_refuses_before_deletion(self):
        update, backup, package, _ = self.live_fixture()
        old = self.package('old')
        self.package('previous', RECENT, timestamp=200)
        def changed_receipt(*args):
            (backup / 'SUCCESS.json').write_text('{"replaced": true}')
            return [update.stack]
        with patch.object(self.module, '_container_paths', side_effect=changed_receipt):
            with self.assertRaisesRegex(RuntimeError, 'SUCCESS receipt changed'):
                self.module.cleanup_after_update(update, backup, self.root, package)
        self.assertTrue(old.exists() and (old / 'application-images.tar').exists())


if __name__ == '__main__':
    unittest.main()
