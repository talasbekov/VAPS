"""Real temporary release files exercise the standalone maintenance safeguards."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


CURRENT = 'c' * 40
PREVIOUS = 'b' * 40
OLD = 'a' * 40


def load_tool(name):
    path = Path(__file__).resolve().parents[1] / (name + '.py')
    if not path.is_file():
        raise AssertionError('The standalone release maintenance tool is missing: ' + name)
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseFixture(unittest.TestCase):
    def setUp(self):
        self.module = load_tool('server-release-files')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'Smart Josparlau'
        self.root.mkdir()

    def app(self, name, revision=OLD, stamp=100):
        folder = self.root / name
        folder.mkdir()
        files = {}
        for name in ('application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py'):
            payload = ('application ' + name).encode()
            (folder / name).write_bytes(payload)
            files[name] = hashlib.sha256(payload).hexdigest()
        (folder / 'release.json').write_text(json.dumps({
            'source_revision': revision, 'files': files,
            'images': {service: {'tag': 'smart-josparlau/lan-' + service + ':test-' + revision[:12]}
                       for service in ('backend', 'frontend')},
        }), encoding='utf-8')
        os.utime(folder, (stamp, stamp))
        return folder

    def full(self, name, revision=OLD, stamp=100):
        folder = self.root / name
        folder.mkdir()
        payloads = {
            'runtime-images.tar.gz': b'opaque Docker image archive',
            'source-revision.txt': (revision + '\n').encode(),
            'platform.txt': b'linux/amd64\n',
            'images.env': b'BACKEND_IMAGE=smart-josparlau/lan-backend:test\n',
            'images-manifest.txt': b'smart-josparlau/lan-backend:test sha256:' + b'1' * 64 + b' linux/amd64\n',
            'docker-compose.yml': b'services: {}\n',
            '.env.example': b'POSTGRES_PASSWORD=\n',
            'settings.py': b'# LAN settings\n',
            'nginx-backend.conf': b'# proxy config\n',
            'install.sh': b'#!/bin/sh\n',
            'source/backend/manage.py': b'# Django entrypoint\n',
            'source/frontend/package.json': b'{"name":"fixture"}\n',
            'source/deploy/lan/.env.example': b'POSTGRES_PASSWORD=\n',
        }
        for relative, body in payloads.items():
            path = folder / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        source = {key: body for key, body in payloads.items() if key.startswith('source/')}
        (folder / 'source-sha256sums.txt').write_text(''.join(
            hashlib.sha256(body).hexdigest() + '  ' + name + '\n' for name, body in sorted(source.items())), encoding='utf-8')
        self.rehash_root(folder)
        os.utime(folder, (stamp, stamp))
        return folder

    def rehash_root(self, folder):
        (folder / 'sha256sums.txt').write_text(''.join(
            hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
            for path in sorted(folder.iterdir()) if path.is_file() and path.name != 'sha256sums.txt'), encoding='utf-8')

    def archive(self, folder, name, wrapper='bundle', tar=False):
        path = self.root / name
        if tar:
            with tarfile.open(path, 'w:gz') as archive:
                for child in sorted(folder.rglob('*')):
                    archive.add(child, arcname=(wrapper + '/' if wrapper else '') + child.relative_to(folder).as_posix(), recursive=False)
        else:
            with zipfile.ZipFile(path, 'w') as archive:
                for child in sorted(folder.rglob('*')):
                    archive.write(child, (wrapper + '/' if wrapper else '') + child.relative_to(folder).as_posix())
        os.utime(path, (folder.stat().st_mtime, folder.stat().st_mtime))
        return path

    def plan(self, protected=()):
        return self.module.plan_cleanup(self.root, protected=protected, current_revision=CURRENT)


class ReleaseFilesTests(ReleaseFixture):
    def test_full_rollback_archive_is_retained_independently_of_previous_app(self):
        old = self.full('offline-old')
        rollback = self.full('offline-previous', PREVIOUS, 200)
        rollback_zip = self.archive(rollback, 'smart-josparlau-offline-previous.zip')
        old_zip = self.archive(old, 'smart-josparlau-offline-old.zip', wrapper='')
        app_previous = self.app('app-previous', 'd' * 40, 300)
        current = self.app('app-current', CURRENT, 400)
        plan = self.plan()
        self.assertEqual({item['path'] for item in plan['remove']}, {str(old), str(old_zip)})
        self.assertEqual({item['path'] for item in plan['keep']},
                         {str(rollback), str(rollback_zip), str(app_previous), str(current)})

    def test_mutated_known_configuration_is_identified_for_private_backup(self):
        old = self.full('offline-old')
        (old / '.env').write_text('POSTGRES_PASSWORD=private-value\n', encoding='utf-8')
        (old / 'images.env').write_text('BACKEND_IMAGE=custom-local-image\n', encoding='utf-8')
        (old / 'docker-compose.yml').write_text('# site configuration\n', encoding='utf-8')
        os.utime(old, (100, 100))
        self.full('rollback', PREVIOUS, 200)
        plan = self.plan()
        self.assertEqual([item['path'] for item in plan['remove']], [str(old)])
        candidate = plan['remove'][0]
        self.assertTrue({'.env', 'images.env', 'docker-compose.yml', 'settings.py', 'nginx-backend.conf'}
                        .issubset({entry['name'] for entry in candidate['configuration']}))
        self.assertNotIn('private-value', json.dumps(plan))

    def test_active_mounted_backup_and_unknown_folders_are_kept(self):
        self.full('rollback', PREVIOUS, 200)
        active = self.full('active')
        mounted = self.full('stopped-container-bind')
        unknown = self.full('unknown')
        (unknown / 'notes.txt').write_text('site data')
        backup = self.full('backup')
        git = self.full('git-checkout')
        (git / '.git').mkdir()
        plan = self.plan([active, mounted / 'source/backend/manage.py'])
        self.assertEqual(plan['remove'], [])
        self.assertEqual({item['path'] for item in plan['skip']},
                         {str(active), str(mounted), str(unknown), str(backup), str(git)})

    def test_malformed_manifests_or_changed_source_never_authorize_deletion(self):
        self.full('rollback', PREVIOUS, 200)
        source = self.full('changed-source')
        (source / 'source/backend/manage.py').write_text('new site code')
        runtime = self.full('changed-runtime')
        (runtime / 'runtime-images.tar.gz').write_bytes(b'bad')
        malformed = self.full('bad-manifest')
        with (malformed / 'source-sha256sums.txt').open('a') as stream:
            stream.write('0' * 64 + '  ../private\n')
        self.rehash_root(malformed)
        self.assertEqual(self.plan()['remove'], [])

    def test_zip_and_tar_are_verified_without_extraction_and_reject_unsafe_payloads(self):
        rollback = self.full('rollback', PREVIOUS, 200)
        self.archive(rollback, 'smart-josparlau-offline-rollback.zip')
        old = self.full('old')
        valid_zip = self.archive(old, 'smart-josparlau-offline-old.zip')
        valid_tar = self.archive(old, 'smart-josparlau-offline-old.tar.gz', tar=True)
        bad = self.archive(old, 'smart-josparlau-offline-traversal.zip')
        with zipfile.ZipFile(bad, 'a') as archive:
            archive.writestr('../outside', 'private')
        extra = self.archive(old, 'smart-josparlau-offline-extra.zip')
        with zipfile.ZipFile(extra, 'a') as archive:
            archive.writestr('bundle/data/database.dump', 'private')
        link = self.root / 'smart-josparlau-offline-link.tar'
        with tarfile.open(link, 'w') as archive:
            item = tarfile.TarInfo('bundle/source/linked')
            item.type = tarfile.SYMTYPE
            item.linkname = '/private'
            archive.addfile(item)
        plan = self.plan([old])
        self.assertEqual({item['path'] for item in plan['remove']}, {str(valid_zip), str(valid_tar)})
        self.assertFalse((self.root.parent / 'outside').exists())
        self.assertTrue(all(path.exists() for path in (bad, extra, link)))

    def test_archive_duplicate_names_and_corruption_are_preserved(self):
        self.full('rollback', PREVIOUS, 200)
        old = self.full('old')
        duplicate = self.archive(old, 'smart-josparlau-offline-duplicate.zip')
        with zipfile.ZipFile(duplicate, 'a') as archive:
            with self.assertWarns(UserWarning):
                archive.writestr('bundle/source/backend/manage.py', 'duplicate')
        corrupt = self.root / 'smart-josparlau-offline-corrupt.zip'
        corrupt.write_bytes(b'not a ZIP')
        sidecar = self.root / 'smart-josparlau-offline-corrupt.zip.sha256'
        sidecar.write_text('unbound checksum data')
        plan = self.plan([old])
        self.assertEqual(plan['remove'], [])
        self.assertTrue(sidecar.exists())

    def test_file_directory_collision_cannot_replace_the_valid_full_rollback(self):
        rollback = self.full('rollback', PREVIOUS, 200)
        valid = self.archive(rollback, 'smart-josparlau-offline-rollback.zip')
        old = self.full('old')
        payloads = {path.relative_to(old).as_posix(): path.read_bytes()
                    for path in old.rglob('*') if path.is_file()}
        payloads['source/backend'] = b'file collides with source directory'
        payloads['source-sha256sums.txt'] += (
            hashlib.sha256(payloads['source/backend']).hexdigest() + '  source/backend\n').encode()
        payloads['sha256sums.txt'] = ''.join(
            hashlib.sha256(body).hexdigest() + '  ' + name + '\n'
            for name, body in sorted(payloads.items()) if '/' not in name and name != 'sha256sums.txt').encode()
        malformed = self.root / 'smart-josparlau-offline-impossible.zip'
        with zipfile.ZipFile(malformed, 'w') as archive:
            for name, body in payloads.items():
                archive.writestr('bundle/' + name, body)
        os.utime(malformed, (900, 900))
        plan = self.plan()
        self.assertTrue({str(rollback), str(valid)}.issubset({item['path'] for item in plan['keep']}))
        self.assertIn(str(malformed), {item['path'] for item in plan['skip']})

    def test_one_wrapper_is_recognized_and_nested_or_extra_wrappers_are_kept(self):
        self.full('rollback', PREVIOUS, 200)
        wrapper = self.root / 'extracted-old'
        wrapper.mkdir()
        old = self.full('temporary')
        old.rename(wrapper / 'bundle')
        os.utime(wrapper, (100, 100))
        doubled = self.root / 'double-wrapper'
        doubled.mkdir()
        (doubled / 'one').mkdir()
        extra = self.full('temporary-two')
        extra.rename(doubled / 'one/two')
        self.assertEqual([item['path'] for item in self.plan()['remove']], [str(wrapper)])

    def test_flat_and_wrapped_application_zips_keep_the_previous_app_revision(self):
        old = self.app('old-app', OLD, 100)
        self.app('previous-app', PREVIOUS, 200)
        flat = self.archive(old, 'smart-josparlau-update-flat.zip', wrapper='')
        wrapped = self.archive(old, 'smart-josparlau-update-wrapped.zip')
        self.assertEqual({item['path'] for item in self.plan()['remove']}, {str(old), str(flat), str(wrapped)})

    def test_unhashed_known_application_filename_keeps_directory_and_zip(self):
        self.app('previous-app', PREVIOUS, 200)
        old = self.app('old-app')
        (old / 'diagnose-org-structure.py').write_text('operator data absent from the release manifest')
        os.utime(old, (100, 100))
        archive = self.archive(old, 'smart-josparlau-update-unlisted.zip')
        plan = self.plan()
        self.assertEqual(plan['remove'], [])
        self.assertTrue({str(old), str(archive)}.issubset({item['path'] for item in plan['skip']}))

    def test_linked_files_and_kernel_bind_mounts_keep_the_whole_package(self):
        self.full('rollback', PREVIOUS, 200)
        old = self.full('old')
        with patch.object(self.module.cleanup, '_mount_points', return_value={old / 'source/backend'}):
            self.assertEqual(self.plan()['remove'], [])
        foreign = self.root.parent / 'private.env'
        foreign.write_text('private data')
        try:
            (old / '.env').symlink_to(foreign)
        except OSError:
            self.skipTest('This Windows account cannot create symbolic links; Linux exercises this case')
        self.assertEqual(self.plan()['remove'], [])
        self.assertEqual(foreign.read_text(), 'private data')


class MaintenanceTests(ReleaseFixture):
    def setUp(self):
        super().setUp()
        self.maintenance = load_tool('server-maintenance')
        self.stack = self.root / 'active-stack'
        self.stack.mkdir()
        for name in ('.env', 'images.env', 'docker-compose.yml'):
            (self.stack / name).write_text('active site secret: keep-private\n', encoding='utf-8')
        self.current = self.app('current-update', CURRENT, 400)
        self.app('previous-update', PREVIOUS, 300)
        rollback = self.full('full-rollback', PREVIOUS, 200)
        self.archive(rollback, 'smart-josparlau-offline-rollback.zip')
        self.old = self.full('old-full', OLD, 100)
        (self.old / '.env').write_text('POSTGRES_PASSWORD=retained-secret\n', encoding='utf-8')
        os.utime(self.old, (100, 100))
        self.receipt = self.success()
        self.extra_containers = []
        self.extra_volumes = []
        self.docker = patch.object(self.maintenance.base, '_output', side_effect=self.docker_output)
        self.docker.start()
        self.addCleanup(self.docker.stop)

    def success(self, name='apply-verified', **overrides):
        folder = self.stack / 'backups/updates' / name
        folder.mkdir(parents=True)
        receipt = {
            'mode': 'application-only', 'migrations_executed': False,
            'all_database_tables_schema_and_sequences_match': True,
            'database_container_unchanged': True, 'database_volume': 'db-data',
            'backend_image': 'sha256:updated-backend',
            'frontend_image': 'smart-josparlau/lan-frontend:test-' + CURRENT[:12],
            'verified_before_resuming_background_jobs': True,
            'backup_restored_and_compared': True,
        }
        receipt.update(overrides)
        (folder / 'SUCCESS.json').write_text(json.dumps(receipt), encoding='utf-8')
        (folder / 'before.json').write_text(json.dumps({
            'project': 'smart-test', 'database_volume': 'db-data',
            'containers': {service: {'id': service + '-container', 'image': 'sha256:previous-' + service}
                           for service in ('db', 'backend', 'frontend')},
        }), encoding='utf-8')
        return folder

    def containers(self):
        result = []
        for service in ('db', 'backend', 'frontend'):
            image = ('smart-josparlau/lan-frontend:test-' + CURRENT[:12] if service == 'frontend'
                     else 'sha256:updated-backend' if service == 'backend' else 'postgres:16')
            result.append({
                'Id': service + '-container', 'Image': image,
                'Config': {'Image': image, 'Labels': {
                    'com.docker.compose.project': 'smart-test',
                    'com.docker.compose.service': service,
                    'com.docker.compose.project.working_dir': str(self.stack),
                    'com.docker.compose.project.config_files': str(self.stack / 'docker-compose.yml'),
                }}, 'State': {'Running': True},
                'Mounts': [{'Type': 'volume', 'Name': 'db-data',
                            'Source': str(self.root.parent / 'docker-db-data'),
                            'Destination': '/var/lib/postgresql/data'}] if service == 'db' else [],
            })
        return result + self.extra_containers

    def docker_output(self, command):
        if command[:3] == ['docker', 'context', 'inspect']:
            return json.dumps('npipe://local-test-engine')
        if command[:2] == ['docker', 'compose'] and command[-3:] == ['config', '--format', 'json']:
            return json.dumps({'name': 'smart-test'})
        if command == ['docker', 'ps', '-aq']:
            return ' '.join(item['Id'] for item in self.containers())
        if command[:2] == ['docker', 'inspect']:
            return json.dumps(self.containers())
        if command[:3] == ['docker', 'volume', 'inspect']:
            volumes = [{'Name': 'db-data', 'Options': None,
                        'Mountpoint': str(self.root.parent / 'docker-db-data')}, *self.extra_volumes]
            return json.dumps([item for item in volumes if item['Name'] in command[3:]])
        if command == ['docker', 'volume', 'ls', '-q']:
            return '\n'.join(['db-data', *(item['Name'] for item in self.extra_volumes)])
        raise AssertionError('Unexpected Docker command (mutations are forbidden): ' + repr(command))

    def run_tool(self, apply=False):
        if apply and not self.maintenance.SAFE_REMOVAL_SUPPORTED:
            self.skipTest('Descriptor-based removal requires Linux; preview remains portable')
        return self.maintenance.run(self.stack, self.root, self.current, apply=apply)

    def test_preview_is_read_only_and_never_reports_configuration_values(self):
        before = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        outcome = self.run_tool()
        after = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        self.assertEqual(before, after)
        self.assertEqual([item['path'] for item in outcome['plan']['remove']], [str(self.old)])
        self.assertTrue(outcome['apply_allowed'])
        self.assertNotIn('retained-secret', json.dumps(outcome))
        self.assertNotIn('keep-private', json.dumps(outcome))
        self.assertFalse((self.stack / 'backups/maintenance').exists())

    def test_apply_backs_up_inactive_and_active_configuration_before_removal(self):
        outcome = self.run_tool(apply=True)
        self.assertFalse(self.old.exists())
        self.assertTrue(self.current.is_dir())
        self.assertTrue((self.root / 'full-rollback').is_dir())
        report = Path(outcome['report_directory'])
        private = list(report.rglob('.env'))
        self.assertEqual({path.read_text(encoding='utf-8') for path in private},
                         {'POSTGRES_PASSWORD=retained-secret\n', 'active site secret: keep-private\n'})
        self.assertEqual(json.loads((report / 'RESULT.json').read_text())['status'], 'complete')
        self.assertTrue((report / 'PLAN.json').is_file())
        self.assertFalse((self.stack / '.offline-update-lock').exists())
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE(report.stat().st_mode), 0o700)
            self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in report.rglob('*') if path.is_file()))

    def test_existing_update_lock_is_never_replaced_or_removed(self):
        lock = self.stack / '.offline-update-lock'
        lock.mkdir()
        (lock / 'owner.json').write_text('the updater owns this lock')
        with self.assertRaisesRegex(RuntimeError, 'lock'):
            self.run_tool(apply=True)
        self.assertEqual((lock / 'owner.json').read_text(), 'the updater owns this lock')
        self.assertTrue(self.old.is_dir())

    def test_failed_lock_owner_creation_clears_only_its_own_empty_lock(self):
        with patch.object(self.maintenance, '_private_json', side_effect=OSError('disk full')):
            with self.assertRaises((OSError, RuntimeError)):
                self.run_tool(apply=True)
        self.assertFalse((self.stack / '.offline-update-lock').exists())
        self.assertTrue(self.old.is_dir())

    def test_success_flags_and_original_db_identity_gate_standalone_apply(self):
        for change in ({'migrations_executed': True}, {'backup_restored_and_compared': False},
                       {'frontend_image': 'wrong-image'}, {'database_volume': 'wrong-volume'}):
            with self.subTest(change=change):
                data = json.loads((self.receipt / 'SUCCESS.json').read_text())
                original = dict(data)
                data.update(change)
                (self.receipt / 'SUCCESS.json').write_text(json.dumps(data))
                with self.assertRaisesRegex(RuntimeError, 'SUCCESS'):
                    self.run_tool(apply=True)
                (self.receipt / 'SUCCESS.json').write_text(json.dumps(original))
                self.assertTrue(self.old.is_dir())
                self.assertFalse((self.stack / '.offline-update-lock').exists())
        before = json.loads((self.receipt / 'before.json').read_text())
        before['containers']['db']['id'] = 'different-db-container'
        (self.receipt / 'before.json').write_text(json.dumps(before))
        with self.assertRaisesRegex(RuntimeError, 'SUCCESS'):
            self.run_tool(apply=True)
        self.assertTrue(self.old.is_dir())

    def test_latest_matching_valid_success_is_selected(self):
        invalid = self.success('apply-newer-invalid', migrations_executed=True)
        os.utime(invalid / 'SUCCESS.json', (2000000000, 2000000000))
        outcome = self.run_tool()
        self.assertEqual(outcome['success_receipt'], str(self.receipt / 'SUCCESS.json'))

    def test_manifest_image_id_matches_success_tag_after_immutable_repair_resume(self):
        manifest_path = self.current / 'release.json'
        manifest = json.loads(manifest_path.read_text())
        expected = 'sha256:' + '7' * 64
        manifest['images']['frontend']['id'] = expected
        manifest_path.write_text(json.dumps(manifest))
        original = self.containers
        receipt_before = (self.receipt / 'SUCCESS.json').read_bytes()
        def pinned_containers():
            result = original()
            front = next(item for item in result if item['Id'] == 'frontend-container')
            front['Image'] = expected
            front['Config']['Image'] = expected
            return result
        with patch.object(self, 'containers', side_effect=pinned_containers):
            self.assertTrue(self.run_tool()['apply_allowed'])
        self.assertEqual((self.receipt / 'SUCCESS.json').read_bytes(), receipt_before)
        def moved_tag_containers():
            result = original()
            next(item for item in result if item['Id'] == 'frontend-container')['Image'] = 'sha256:' + '8' * 64
            return result
        with patch.object(self, 'containers', side_effect=moved_tag_containers):
            self.assertFalse(self.run_tool()['apply_allowed'], 'A matching tag cannot conceal a different immutable image')

    def test_stopped_container_and_bind_backed_named_volume_paths_are_kept(self):
        self.extra_containers = [{
            'Id': 'stopped-digital', 'Image': 'other-image',
            'Config': {'Image': 'other-image', 'Labels': {}}, 'State': {'Running': False},
            'Mounts': [{'Type': 'volume', 'Name': 'digital-bind',
                        'Source': str(self.root.parent / 'docker-digital-data'), 'Destination': '/data'}],
        }]
        self.extra_volumes = [{'Name': 'digital-bind', 'Mountpoint': str(self.root.parent / 'docker-digital-data'),
                               'Options': {'type': 'none', 'o': 'bind', 'device': str(self.old)}}]
        outcome = self.run_tool(apply=True)
        self.assertTrue(self.old.is_dir())
        self.assertEqual(outcome['result']['removed'], [])

    def test_new_unknown_file_after_planning_prevents_any_candidate_deletion(self):
        original = self.maintenance.release_files.plan_cleanup
        def changing_plan(*args, **kwargs):
            plan = original(*args, **kwargs)
            (self.old / 'new-site-file.txt').write_text('arrived during inventory')
            return plan
        with patch.object(self.maintenance.release_files, 'plan_cleanup', side_effect=changing_plan):
            with self.assertRaises((RuntimeError, ValueError)):
                self.run_tool(apply=True)
        self.assertTrue((self.old / 'runtime-images.tar.gz').is_file())
        self.assertEqual((self.old / 'new-site-file.txt').read_text(), 'arrived during inventory')

    def test_failed_configuration_backup_leaves_releases_intact_and_a_result_report(self):
        with patch.object(self.maintenance, '_copy_configuration', side_effect=OSError('no backup space')):
            with self.assertRaises((RuntimeError, OSError)):
                self.run_tool(apply=True)
        self.assertTrue((self.old / 'runtime-images.tar.gz').is_file())
        reports = list((self.stack / 'backups/maintenance').glob('*/RESULT.json'))
        self.assertEqual(len(reports), 1)
        self.assertEqual(json.loads(reports[0].read_text())['status'], 'refused')
        self.assertFalse((self.stack / '.offline-update-lock').exists())

    def test_unattached_named_volume_backing_device_is_also_preserved(self):
        self.extra_volumes = [{'Name': 'unused-but-retained', 'Options': {'type': 'none', 'o': 'bind', 'device': str(self.old)},
                              'Mountpoint': str(self.root.parent / 'docker-unused-data')}]
        outcome = self.run_tool(apply=True)
        self.assertTrue(self.old.is_dir())
        self.assertEqual(outcome['result']['removed'], [])

    def test_without_success_preview_explains_apply_is_unavailable(self):
        (self.receipt / 'SUCCESS.json').unlink()
        outcome = self.run_tool()
        self.assertFalse(outcome['apply_allowed'])
        self.assertIsNone(outcome['success_receipt'])
        with self.assertRaisesRegex(RuntimeError, 'SUCCESS'):
            self.run_tool(apply=True)
        self.assertTrue(self.old.is_dir())

    def test_fresh_docker_paths_after_inventory_prevent_removal(self):
        original = self.maintenance.release_files.plan_cleanup
        def changing_plan(*args, **kwargs):
            plan = original(*args, **kwargs)
            self.extra_volumes = [{'Name': 'new-volume', 'Options': {'device': str(self.old)},
                                   'Mountpoint': str(self.root.parent / 'docker-new-data')}]
            return plan
        with patch.object(self.maintenance.release_files, 'plan_cleanup', side_effect=changing_plan):
            with self.assertRaises(RuntimeError):
                self.run_tool(apply=True)
        self.assertTrue((self.old / 'runtime-images.tar.gz').is_file())

    def test_changed_success_after_inventory_prevents_removal(self):
        original = self.maintenance.release_files.plan_cleanup
        def changing_plan(*args, **kwargs):
            plan = original(*args, **kwargs)
            with (self.receipt / 'SUCCESS.json').open('a') as stream:
                stream.write('\n')
            return plan
        with patch.object(self.maintenance.release_files, 'plan_cleanup', side_effect=changing_plan):
            with self.assertRaises(RuntimeError):
                self.run_tool(apply=True)
        self.assertTrue((self.old / 'runtime-images.tar.gz').is_file())

    def test_tar_archive_configuration_is_backed_up_and_sidecar_is_left_alone(self):
        self.rehash_root(self.old)
        os.utime(self.old, (100, 100))
        old_tar = self.archive(self.old, 'smart-josparlau-offline-old.tar.gz', tar=True)
        sidecar = self.root / (old_tar.name + '.sha256')
        sidecar.write_text('unverified sidecar must stay')
        outcome = self.run_tool(apply=True)
        self.assertFalse(old_tar.exists())
        self.assertTrue(sidecar.is_file())
        report = Path(outcome['report_directory'])
        copies = [path.read_text() for path in report.glob('configuration/release-*/.env')]
        self.assertEqual(copies, ['POSTGRES_PASSWORD=retained-secret\n'] * 2)

    def test_directory_swap_immediately_before_unlink_preserves_replacement_data(self):
        unlink = os.unlink
        swapped = False
        moved = self.root / 'original-candidate-moved'
        def swapping_unlink(path, *args, **kwargs):
            nonlocal swapped
            if Path(path).name == '.env' and not swapped:
                self.old.rename(moved)
                self.old.mkdir()
                (self.old / '.env').write_text('new unknown site data')
                swapped = True
            return unlink(path, *args, **kwargs)
        with patch.object(os, 'unlink', side_effect=swapping_unlink):
            with self.assertRaises(RuntimeError):
                self.run_tool(apply=True)
        self.assertTrue(swapped)
        self.assertTrue((self.old / '.env').exists(), 'A replacement directory must never be unlinked through')
        self.assertEqual((self.old / '.env').read_text(), 'new unknown site data')

    def test_zero_byte_file_deletion_followed_by_failure_is_reported_partial(self):
        (self.old / '.env').write_bytes(b'')
        unlink = os.unlink
        def failing_unlink(path, *args, **kwargs):
            if Path(path).name == '.env.example':
                raise OSError('injected later unlink failure')
            return unlink(path, *args, **kwargs)
        with patch.object(os, 'unlink', side_effect=failing_unlink):
            with self.assertRaises(RuntimeError):
                self.run_tool(apply=True)
        self.assertFalse((self.old / '.env').exists())
        reports = list((self.stack / 'backups/maintenance').glob('*/RESULT.json'))
        self.assertEqual(json.loads(reports[0].read_text())['status'], 'partial')


if __name__ == '__main__':
    unittest.main()
