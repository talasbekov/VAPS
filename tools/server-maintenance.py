#!/usr/bin/env python3
"""Inventory obsolete LAN release files; add --apply to remove verified copies.

Requires a local Docker engine and an already successful application-only update.
Never writes to PostgreSQL or starts, stops, removes or prunes Docker resources.
Distribute with server-release-files.py and cleanup-old-releases.py beside it.
"""
import sys
sys.dont_write_bytecode = True

import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import time
import uuid
import zipfile


HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('server_release_files', HERE / 'server-release-files.py')
release_files = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release_files)
base = release_files.cleanup
SAFE_REMOVAL_SUPPORTED = (sys.platform.startswith('linux') and hasattr(os, 'O_DIRECTORY') and
                          hasattr(os, 'O_NOFOLLOW') and os.open in os.supports_dir_fd and
                          os.stat in os.supports_dir_fd and os.unlink in os.supports_dir_fd and
                          os.rmdir in os.supports_dir_fd)


def _docker_output(command):
    # Compose config contains secrets. Keep both streams private on errors too.
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Docker inspection failed; cleanup refused (no command output is disclosed)')
    return result.stdout.decode('utf-8').strip()


base._output = _docker_output


def _json(path):
    release_files.identity(path)
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('Oversized maintenance/update metadata')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, UnicodeError):
        raise ValueError('Invalid maintenance/update metadata JSON') from None
    if not isinstance(value, dict):
        raise ValueError('Expected maintenance/update metadata object')
    return value


def _private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def _mkdir(path):
    path.mkdir(mode=0o700, exist_ok=True)
    token = release_files.identity(path)
    if not stat.S_ISDIR(token[2]):
        raise RuntimeError('Expected a real backup directory')


@contextmanager
def _update_lock(stack):
    lock = stack / '.offline-update-lock'
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise RuntimeError('The update lock exists; another or interrupted update must be checked first') from None
    token = release_files.identity(lock)
    owner = lock / 'owner.json'
    owner_token = None
    try:
        _private_json(owner, {'operation': 'server-release-maintenance', 'pid': os.getpid(),
                              'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        owner_token = release_files.identity(owner)
        yield
    finally:
        if release_files.identity(lock)[:3] != token[:3]:
            raise RuntimeError('Maintenance lock changed; it has been preserved for inspection')
        if owner_token is None:
            if set(lock.iterdir()):
                raise RuntimeError('Lock owner could not be written; partial lock preserved for inspection')
        else:
            if set(lock.iterdir()) != {owner} or release_files.identity(owner) != owner_token:
                raise RuntimeError('Maintenance lock changed; it has been preserved for inspection')
            owner.unlink()
        lock.rmdir()


def _project(stack):
    config = json.loads(base._output(['docker', 'compose', '--project-directory', str(stack),
        '--env-file', str(stack / 'images.env'), '--env-file', str(stack / '.env'),
        '-f', str(stack / 'docker-compose.yml'), 'config', '--format', 'json']))
    project = config.get('name')
    if not isinstance(project, str) or not project:
        raise RuntimeError('Cannot identify the active Compose project')
    return project


def _protected_docker(stack, project, receipt=None, db_id=None, volume=None):
    protected = base._container_paths(stack, project, receipt, db_id, volume)
    # Retained but currently unattached named volumes are still data. Their
    # backing devices are absent from `docker ps -a` and container Mounts.
    names = set(base._output(['docker', 'volume', 'ls', '-q']).split())
    if names:
        volumes = json.loads(base._output(['docker', 'volume', 'inspect', *sorted(names)]))
        if len(volumes) != len(names) or {item.get('Name') for item in volumes} != names:
            raise RuntimeError('Cannot inspect every retained Docker volume; cleanup refused')
        for item in volumes:
            mountpoint = item.get('Mountpoint')
            if mountpoint:
                if not isinstance(mountpoint, str) or not Path(mountpoint).is_absolute():
                    raise RuntimeError('Cannot resolve a Docker volume backing path')
                protected.append(Path(mountpoint).resolve())
            options = item.get('Options') or {}
            device = options.get('device')
            if device and Path(device).is_absolute():
                protected.append(Path(device).resolve())
            elif device and 'bind' in str(options.get('o', '')).split(','):
                raise RuntimeError('Cannot resolve a relative Docker bind-volume device')
    return protected


def _latest_success(stack, project, manifest):
    directory = stack / 'backups/updates'
    candidates = []
    if not directory.exists():
        return None
    for ancestor in (stack / 'backups', directory):
        release_files.identity(ancestor)
    for folder in directory.iterdir():
        try:
            release_files.identity(folder)
            if folder.is_dir():
                receipt = folder / 'SUCCESS.json'
                token = release_files.identity(receipt)
                candidates.append((token[4], receipt))
        except (ValueError, OSError):
            continue
    flags = ('all_database_tables_schema_and_sequences_match', 'database_container_unchanged',
             'backup_restored_and_compared', 'verified_before_resuming_background_jobs')
    for _, path in sorted(candidates, key=lambda value: (value[0], str(value[1])), reverse=True):
        try:
            folder = path.parent
            if any((folder / name).exists() for name in ('RECOVERY_REQUIRED.json', 'ROLLED_BACK.json')):
                continue
            token = release_files.identity(path)
            receipt = _json(path)
            if (receipt.get('mode') != 'application-only' or receipt.get('migrations_executed') is not False or
                    any(receipt.get(flag) is not True for flag in flags)):
                continue
            expected_frontend = manifest['images']['frontend']
            if receipt.get('frontend_image') not in {expected_frontend.get('tag'), expected_frontend.get('id')}:
                continue
            if expected_frontend.get('id'):
                # Repair resumes pin immutable IDs. SUCCESS may still contain
                # the original tag: verify its release ID instead of requiring
                # the container's Config.Image spelling to remain unchanged.
                receipt = {**receipt, 'frontend_image': expected_frontend['id']}
            before_path = folder / 'before.json'
            before_token = release_files.identity(before_path)
            before = _json(before_path)
            db_id = before['containers']['db']['id']
            volume = receipt['database_volume']
            if (not isinstance(db_id, str) or not db_id or not isinstance(volume, str) or not volume or
                    before.get('project') != project or before.get('database_volume') != volume):
                continue
            _protected_docker(stack, project, receipt, db_id, volume)
            if token != release_files.identity(path) or before_token != release_files.identity(before_path):
                continue
            return {'path': path, 'token': token, 'before_path': before_path, 'before_token': before_token,
                    'receipt': receipt, 'db_id': db_id, 'volume': volume}
        except (ValueError, OSError, RuntimeError, KeyError, TypeError, AttributeError):
            continue
    return None


def _validate_candidate(item, root, protected):
    path = Path(item['path'])
    if path.parent != root or path.resolve() != path or base._overlaps(path, protected):
        raise RuntimeError('A candidate is outside the updates root or became protected')
    if item['entries'] != release_files.snapshot(path):
        raise RuntimeError('Release entries or file identities changed since planning: ' + str(path))


def _write_copy(source, destination, expected):
    digest = hashlib.sha256()
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
    if digest.hexdigest() != expected:
        raise RuntimeError('Configuration changed while creating its private backup')
    with destination.open('rb') as check:
        if base._hash(check) != expected:
            raise RuntimeError('Configuration backup verification failed')


def _copy_configuration(item, destination):
    destination.mkdir(mode=0o700)
    expected = {entry['name']: entry['sha256'] for entry in item['configuration']}
    if item['kind'] in ('full-directory', 'active-stack'):
        package = Path(item['package'])
        for name, digest in expected.items():
            source = package / name
            release_files.identity(source)
            with source.open('rb') as stream:
                _write_copy(stream, destination / name, digest)
    elif item['kind'] == 'full-archive':
        path, prefix = Path(item['path']), item['package']
        if path.suffix.lower() == '.zip':
            with zipfile.ZipFile(path) as archive:
                for name, digest in expected.items():
                    with archive.open(prefix + name) as stream:
                        _write_copy(stream, destination / name, digest)
        else:
            # One forward pass avoids decompressing a GB-sized image payload
            # again for every small configuration file in a tar.gz bundle.
            copied = set()
            with tarfile.open(path, 'r|*') as archive:
                for member in archive:
                    if member.name.startswith(prefix):
                        name = member.name[len(prefix):]
                        if name in expected and member.isfile():
                            if name in copied:
                                raise RuntimeError('Archive changed while backing up configuration')
                            with archive.extractfile(member) as stream:
                                _write_copy(stream, destination / name, expected[name])
                            copied.add(name)
            if copied != set(expected):
                raise RuntimeError('Archive configuration backup is incomplete')
    else:
        raise RuntimeError('Unknown configuration backup source')
    return {'source': item['path'], 'directory': str(destination),
            'files': item['configuration']}


def _remove_entry(path, entry, entries, root, root_token, children):
    """Resolve from a verified root descriptor, never through swapped ancestors."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(root, flags)
    try:
        info = os.fstat(descriptor)
        if [info.st_dev, info.st_ino, info.st_mode] != root_token[:3]:
            raise RuntimeError('Updates root identity changed during removal')
        parent = root
        for name in path.relative_to(root).parts[:-1]:
            parent /= name
            child_descriptor = os.open(name, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child_descriptor
            info = os.fstat(descriptor)
            if [info.st_dev, info.st_ino, info.st_mode] != entries[parent]['identity'][:3]:
                raise RuntimeError('Release ancestor identity changed during removal')
        if parent in entries and set(os.listdir(descriptor)) != children.get(parent, set()):
            raise RuntimeError('Release directory entries changed during removal')
        info = os.stat(path.name, dir_fd=descriptor, follow_symlinks=False)
        token = [info.st_dev, info.st_ino, info.st_mode, info.st_size,
                 info.st_mtime_ns, info.st_ctime_ns, info.st_nlink]
        if (token[:3] if entry['directory'] else token) != (
                entry['identity'][:3] if entry['directory'] else entry['identity']):
            raise RuntimeError('Release entry changed before descriptor-based removal')
        if entry['directory']:
            os.rmdir(path.name, dir_fd=descriptor)
        else:
            os.unlink(path.name, dir_fd=descriptor)
    finally:
        os.close(descriptor)


def _remove_plan(plan, protection, result):
    root = Path(plan['root'])
    root_token = release_files.identity(root)
    for item in plan['remove']:
        _validate_candidate(item, root, protection())
    for item in plan['remove']:
        _validate_candidate(item, root, protection())
        entries = {Path(entry['path']): entry for entry in item['entries']}
        children = {}
        for path in entries:
            children.setdefault(path.parent, set()).add(path.name)

        def unchanged_parents(path):
            # Recheck actual names as the verified entries are unlinked. New
            # files prevent further deletion and are never recursively removed.
            for parent in path.parents:
                if parent not in entries:
                    break
                if (release_files.identity(parent)[:3] != entries[parent]['identity'][:3] or
                        parent.resolve() != parent or
                        {child.name for child in parent.iterdir()} != children.get(parent, set())):
                    raise RuntimeError('Release directory changed during removal')

        for path, entry in entries.items():
            if not entry['directory']:
                unchanged_parents(path)
                if release_files.identity(path) != entry['identity'] or path.resolve() != path:
                    raise RuntimeError('Release file changed during removal')
                _remove_entry(path, entry, entries, root, root_token, children)
                children[path.parent].remove(path.name)
                result['bytes_removed'] += entry['identity'][3]
                result['files_removed'] += 1
        directories = [path for path, entry in entries.items() if entry['directory']]
        for path in sorted(directories, key=lambda value: len(value.parts), reverse=True):
            unchanged_parents(path)
            if release_files.identity(path)[:3] != entries[path]['identity'][:3] or path.resolve() != path:
                raise RuntimeError('Release directory identity changed during removal')
            _remove_entry(path, entries[path], entries, root, root_token, children)
            children[path.parent].remove(path.name)
            result['directories_removed'] += 1
        result['removed'].append(item['path'])


def _run(stack, root, package, apply):
    for path in (stack, root, package):
        release_files.identity(path)
        if not path.is_dir():
            raise RuntimeError('Stack, updates root and current package must be real directories')
    if root == stack or root.is_relative_to(stack) or root.parent == root:
        raise RuntimeError('Use the separate project updates root, outside the active stack')
    if (stack / '.offline-update-lock').exists() and not apply:
        raise RuntimeError('The update lock exists; inventory must wait for the update to finish')
    config_tokens = {name: release_files.identity(stack / name) for name in ('.env', 'images.env', 'docker-compose.yml')}
    manifest, _ = base._directory(package)
    package_tokens = release_files.snapshot(package)
    project = _project(stack)
    success = _latest_success(stack, project, manifest)
    if apply and success is None:
        raise RuntimeError('No matching verified application-only SUCCESS for the live stack; cleanup refused')

    def protection():
        for name, token in config_tokens.items():
            if release_files.identity(stack / name) != token:
                raise RuntimeError('Active stack configuration changed; cleanup refused')
        if package_tokens != release_files.snapshot(package):
            raise RuntimeError('Current update package changed; cleanup refused')
        if success is not None:
            if (release_files.identity(success['path']) != success['token'] or
                    release_files.identity(success['before_path']) != success['before_token']):
                raise RuntimeError('Verified SUCCESS metadata changed; cleanup refused')
            docker_paths = _protected_docker(stack, project, success['receipt'], success['db_id'], success['volume'])
        else:
            docker_paths = _protected_docker(stack, project)
        return [stack, package, HERE, *docker_paths]

    plan = release_files.plan_cleanup(root, protected=protection(), current_revision=manifest['source_revision'])
    outcome = {'apply_allowed': success is not None,
               'success_receipt': str(success['path']) if success else None, 'plan': plan}
    if not apply:
        outcome['status'] = 'preview'
        return outcome
    backups = stack / 'backups'
    _mkdir(backups)
    _mkdir(backups / 'maintenance')
    report = backups / 'maintenance' / (time.strftime('%Y%m%d-%H%M%S', time.gmtime()) + '-' + uuid.uuid4().hex[:10])
    report.mkdir(mode=0o700)
    _private_json(report / 'PLAN.json', outcome)
    result = {'status': 'refused', 'removed': [], 'bytes_removed': 0,
              'files_removed': 0, 'directories_removed': 0, 'configuration_backups': []}
    try:
        for item in plan['remove']:
            _validate_candidate(item, root, protection())
        config_root = report / 'configuration'
        config_root.mkdir(mode=0o700)
        active = {'path': str(stack), 'package': str(stack), 'kind': 'active-stack', 'configuration': []}
        for name in sorted(release_files.MUTABLE):
            path = stack / name
            if path.exists():
                release_files.identity(path)
                with path.open('rb') as stream:
                    active['configuration'].append({'name': name, 'sha256': base._hash(stream)})
        result['configuration_backups'].append(_copy_configuration(active, config_root / 'active-stack'))
        for index, item in enumerate(plan['remove']):
            if item['configuration']:
                _validate_candidate(item, root, protection())
                result['configuration_backups'].append(_copy_configuration(item, config_root / ('release-' + str(index + 1))))
        _private_json(report / 'CONFIGURATION.json', result['configuration_backups'])
        _remove_plan(plan, protection, result)
        result['status'] = 'complete'
    except Exception as error:
        result['status'] = 'partial' if result['files_removed'] or result['directories_removed'] else 'refused'
        result['error'] = str(error)
        _private_json(report / 'RESULT.json', result)
        raise RuntimeError('Maintenance ' + result['status'] + '; private report: ' + str(report / 'RESULT.json')) from None
    _private_json(report / 'RESULT.json', result)
    outcome.update(status='complete', result=result, report_directory=str(report))
    return outcome


def run(stack, updates_root, current_package, *, apply=False):
    if apply and not SAFE_REMOVAL_SUPPORTED:
        raise RuntimeError('Applying cleanup requires Linux directory descriptors with O_NOFOLLOW; use preview here')
    stack, root, package = (Path(path).resolve(strict=True) for path in (stack, updates_root, current_package))
    old_umask = os.umask(0o077)
    try:
        if apply:
            with _update_lock(stack):
                return _run(stack, root, package, True)
        return _run(stack, root, package, False)
    finally:
        os.umask(old_umask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', required=True, type=Path)
    parser.add_argument('--updates-root', required=True, type=Path)
    parser.add_argument('--current-package', required=True, type=Path,
                        help='Extracted application update that is running successfully now')
    parser.add_argument('--apply', action='store_true', help='Back up configuration and remove verified obsolete copies')
    args = parser.parse_args()
    try:
        outcome = run(args.stack, args.updates_root, args.current_package, apply=args.apply)
    except (RuntimeError, ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        return 1
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    if not args.apply:
        print('PREVIEW ONLY. No files changed. Add --apply after reviewing this inventory.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
