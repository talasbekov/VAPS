#!/usr/bin/env python3
"""Remove verified obsolete update packages, only after a successful LAN update.

No Docker mutations, recursive deletion, installation or backup cleanup.
The command line only previews; deletion is called by the locked updater.
"""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import zipfile
import zlib


ALLOWED = {
    'release.json', 'application-images.tar', 'update.py', 'update-app-only.py',
    'update-offline.py', 'obnovit-bez-bazy.py', 'UPDATE-RU.md',
    'cleanup-old-releases.py', 'diagnose-org-structure.py',
    'sha256sums.txt', 'verification.json', 'НАЧАТЬ-ЗДЕСЬ.txt', 'source-revision.txt',
}
REQUIRED = {'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py'}
RESERVED = {'backups', 'backup', 'media', 'private', 'static', 'source', 'data'}


def _hash(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
        result.update(block)
    return result.hexdigest()


def _mount_points():
    if not sys.platform.startswith('linux'):
        return set()
    # ismount() misses bind mounts on the same filesystem. Kernel mountinfo
    # escapes spaces/tabs/backslashes as octal, so split before decoding.
    points = set()
    for line in Path('/proc/self/mountinfo').read_text(encoding='utf-8').splitlines():
        fields = line.split()
        if len(fields) < 6:
            raise ValueError('Cannot safely parse kernel mount information')
        name = re.sub(r'\\([0-7]{3})', lambda match: chr(int(match.group(1), 8)), fields[4])
        points.add(Path(name).resolve())
    return points


def _identity(path):
    info = path.lstat()
    if path.is_symlink() or os.path.ismount(path) or path.resolve() in _mount_points():
        raise ValueError('Symbolic link or mount point: ' + str(path))
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError('Not a regular file/directory: ' + str(path))
    return [info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns]


def _overlaps(path, protected):
    return any(path == other or path.is_relative_to(other) or other.is_relative_to(path)
               for other in protected)


def _manifest(value):
    if not isinstance(value, dict) or not re.fullmatch(r'[a-f0-9]{40}', value.get('source_revision', '')):
        raise ValueError('Missing source revision')
    if set(value.get('images', {})) != {'backend', 'frontend'}:
        raise ValueError('Not an application-only release')
    for service in ('backend', 'frontend'):
        tag = value['images'][service].get('tag', '')
        if not re.fullmatch(r'smart-josparlau/lan-' + service + r':[A-Za-z0-9_.-]+', tag):
            raise ValueError('Not a Smart Josparlau application image')
    files = value.get('files', {})
    if not REQUIRED.issubset(files) or not set(files).issubset(ALLOWED):
        raise ValueError('Unrecognized package contents')
    if any(not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) for digest in files.values()):
        raise ValueError('Invalid package checksums')
    return value


def _entries(top):
    """At most a wrapper, a flat package and generated Python bytecode."""
    result = []
    def visit(path, depth):
        token = _identity(path)
        result.append({'path': str(path), 'identity': token, 'directory': path.is_dir()})
        if path.is_dir():
            if depth > 2:
                raise ValueError('Unexpected nested directory')
            for child in sorted(path.iterdir()):
                visit(child, depth + 1)
    visit(top, 0)
    return result


def _directory(top):
    package = top
    if not (package / 'release.json').is_file():
        children = list(package.iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise ValueError('Not a flat update package or its extraction wrapper')
        package = children[0]
    entries = _entries(top)
    if (package / 'release.json').stat().st_size > 128 * 1024:
        raise ValueError('Oversized release manifest')
    value = _manifest(json.loads((package / 'release.json').read_text(encoding='utf-8')))
    for child in package.iterdir():
        if child.name == '__pycache__' and child.is_dir():
            if any(not file.is_file() or file.suffix != '.pyc' for file in child.iterdir()):
                raise ValueError('Unknown cache contents')
        elif not child.is_file() or child.name not in ALLOWED:
            raise ValueError('Installation, data or unknown files must be kept')
    for name, expected in value['files'].items():
        with (package / name).open('rb') as stream:
            if _hash(stream) != expected:
                raise ValueError('Package checksum mismatch: ' + name)
    if entries != _entries(top):
        raise ValueError('Package changed during inspection')
    return value, entries


def _archive(path):
    entries = _entries(path)
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 64:
            raise ValueError('Too many archive entries')
        files = {}
        prefixes = set()
        for item in members:
            name = PurePosixPath(item.filename)
            if ('\\' in item.filename or name.is_absolute() or '..' in name.parts or
                    len(name.parts) > 2 or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('Unsafe archive member')
            if item.is_dir():
                if len(name.parts) != 1:
                    raise ValueError('Unexpected archive directory')
                continue
            if name.name not in ALLOWED or name.name in files:
                raise ValueError('Archive contains installation, data or unknown files')
            prefixes.add(str(name.parent))
            files[name.name] = item
        if len(prefixes) != 1 or 'release.json' not in files or files['release.json'].file_size > 128 * 1024:
            raise ValueError('Not a single application package')
        value = _manifest(json.loads(archive.read(files['release.json']).decode('utf-8')))
        for name, expected in value['files'].items():
            with archive.open(files[name]) as stream:
                if _hash(stream) != expected:
                    raise ValueError('Archive checksum mismatch: ' + name)
    if entries != _entries(path):
        raise ValueError('Archive changed during inspection')
    return value, entries


def plan_cleanup(root, *, protected, current_revision):
    root = Path(root).resolve(strict=True)
    if not root.is_dir() or root.parent == root:
        raise ValueError('Use a specific existing project updates directory')
    _identity(root)
    protected = [Path(path).resolve() for path in protected]
    result = {'root': str(root), 'current_revision': current_revision, 'remove': [], 'keep': [], 'skip': []}
    candidates = []
    for path in sorted(root.iterdir()):
        try:
            if path.name.lower() in RESERVED or _overlaps(path.resolve(), protected):
                raise ValueError('Protected installation, package, container path or backup')
            token = _identity(path)
            if path.is_dir():
                value, entries = _directory(path)
            elif re.fullmatch(r'smart-josparlau-.*\.zip', path.name, re.IGNORECASE):
                value, entries = _archive(path)
            else:
                raise ValueError('Not a recognized update directory or ZIP')
            candidates.append({'path': str(path), 'revision': value['source_revision'],
                               'mtime_ns': token[-1], 'entries': entries,
                               'bytes': sum(entry['identity'][3] for entry in entries if not entry['directory'])})
        except (ValueError, OSError, KeyError, TypeError, AttributeError, zipfile.BadZipFile,
                zlib.error, lzma.LZMAError, EOFError, NotImplementedError, RuntimeError) as error:
            result['skip'].append({'path': str(path), 'reason': str(error)})
    previous = [item for item in candidates if item['revision'] != current_revision]
    previous_revision = max(previous, key=lambda item: item['mtime_ns'])['revision'] if previous else None
    for item in candidates:
        if item['revision'] in (current_revision, previous_revision):
            item['reason'] = 'current release' if item['revision'] == current_revision else 'most recent previous release'
            result['keep'].append(item)
        else:
            result['remove'].append(item)
    return result


def _validate_item(item, root, protected):
    path = Path(item['path'])
    if path.parent != root or path.resolve() != path or _overlaps(path, protected):
        raise RuntimeError('Candidate is outside the updates directory or is protected: ' + str(path))
    if item['entries'] != _entries(path):
        raise RuntimeError('Package changed since the cleanup plan: ' + str(path))
    for entry in item['entries']:
        child = Path(entry['path'])
        if child.resolve() != child or not child.is_relative_to(root):
            raise RuntimeError('Unsafe cleanup path: ' + str(child))


def apply_plan(plan, *, protected):
    root = Path(plan['root'])
    if root.resolve(strict=True) != root or not root.is_dir():
        raise RuntimeError('Updates directory changed since planning')
    def protection():
        return [Path(path).resolve() for path in (protected() if callable(protected) else protected)]
    paths = protection()
    for item in plan['remove']:
        _validate_item(item, root, paths)
    result = {'status': 'complete', 'removed': [], 'bytes_removed': 0,
              'kept': [item['path'] for item in plan['keep']], 'skipped': plan['skip']}
    for item in plan['remove']:
        try:
            _validate_item(item, root, protection())
            # Delete only the enumerated regular files; rmdir refuses new contents.
            for entry in item['entries']:
                if not entry['directory']:
                    path = Path(entry['path'])
                    if _identity(path) != entry['identity'] or path.resolve() != path:
                        raise RuntimeError('File changed during cleanup: ' + str(path))
                    path.unlink()
                    result['bytes_removed'] += entry['identity'][3]
            directories = [Path(entry['path']) for entry in item['entries'] if entry['directory']]
            for path in sorted(directories, key=lambda value: len(value.parts), reverse=True):
                _identity(path)
                if path.resolve() != path:
                    raise RuntimeError('Directory changed during cleanup: ' + str(path))
                path.rmdir()
            result['removed'].append(item['path'])
        except (OSError, RuntimeError, ValueError) as error:
            result.update(status='partial', error=str(error))
            break
    return result


def _output(args):
    return subprocess.check_output(args, text=True, encoding='utf-8').strip()


def _container_paths(stack, project, receipt=None, db_id=None, volume=None):
    endpoint = os.getenv('DOCKER_HOST')
    if not endpoint or os.getenv('DOCKER_CONTEXT'):
        endpoint = json.loads(_output(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
    if not endpoint.startswith(('unix://', 'npipe://')):
        raise RuntimeError('Filesystem cleanup requires a local Docker socket/context')
    ids = _output(['docker', 'ps', '-aq']).split()
    containers = json.loads(_output(['docker', 'inspect', *ids])) if ids else []
    protected = [stack]
    volume_names = {mount['Name'] for container in containers for mount in container.get('Mounts', [])
                    if mount.get('Type') == 'volume' and mount.get('Name')}
    if volume_names:
        volumes = json.loads(_output(['docker', 'volume', 'inspect', *sorted(volume_names)]))
        if {volume_info['Name'] for volume_info in volumes} != volume_names:
            raise RuntimeError('Cannot inspect every mounted volume; cleanup refused')
        for volume_info in volumes:
            # Docker local volumes can bind a host directory via Options.device;
            # Mounts.Source then names Docker's _data directory instead.
            device = (volume_info.get('Options') or {}).get('device')
            if device and Path(device).is_absolute():
                protected.append(Path(device).resolve())
    own = {}
    for container in containers:
        labels = container['Config'].get('Labels') or {}
        working = labels.get('com.docker.compose.project.working_dir')
        if working:
            protected.append(Path(working).resolve())
        for name in labels.get('com.docker.compose.project.config_files', '').split(','):
            if name:
                config = Path(name)
                protected.append((config if config.is_absolute() else Path(working or '/') / config).resolve())
        for mount in container.get('Mounts', []):
            if mount.get('Source'):
                protected.append(Path(mount['Source']).resolve())
        service = labels.get('com.docker.compose.service')
        if labels.get('com.docker.compose.project') == project and service in ('db', 'backend', 'frontend'):
            if (service in own or not container['State']['Running'] or not working or
                    Path(working).resolve() != stack or
                    labels.get('com.docker.compose.project.config_files') != str(stack / 'docker-compose.yml')):
                raise RuntimeError('Live stack identity is ambiguous or changed; cleanup refused')
            own[service] = container
    if set(own) != {'db', 'backend', 'frontend'}:
        raise RuntimeError('Expected the updated running database/backend/frontend')
    if receipt is not None:
        for service in ('backend', 'frontend'):
            expected = receipt[service + '_image']
            if expected not in (own[service]['Image'], own[service]['Config']['Image']):
                raise RuntimeError('Running application differs from update SUCCESS: ' + service)
        if own['db']['Id'] != db_id or not any(
                mount.get('Name') == volume and mount.get('Destination') == '/var/lib/postgresql/data'
                for mount in own['db']['Mounts']):
            raise RuntimeError('Database identity changed; cleanup refused')
    return protected


def _save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    path.chmod(0o600)


def cleanup_after_update(update, folder, root, package):
    receipt_path = folder / 'SUCCESS.json'
    receipt_token = _identity(receipt_path)
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    required = ('all_database_tables_schema_and_sequences_match', 'database_container_unchanged',
                'backup_restored_and_compared', 'verified_before_resuming_background_jobs')
    if receipt.get('mode') != 'application-only' or receipt.get('migrations_executed') is not False or any(
            receipt.get(key) is not True for key in required):
        raise RuntimeError('A verified application-only SUCCESS is required before cleanup')
    root = Path(root).resolve(strict=True)
    stack = update.stack.resolve()
    if root == stack or root.is_relative_to(stack):
        raise RuntimeError('Cleanup root must be the separate project updates directory')
    revision = json.loads((package / 'release.json').read_text(encoding='utf-8'))['source_revision']
    def protection():
        if _identity(receipt_path) != receipt_token:
            raise RuntimeError('SUCCESS receipt changed; cleanup refused')
        return [package.resolve(), folder.resolve(), *
                _container_paths(stack, update.config['name'], receipt, update.db['Id'], update.volume)]
    plan = plan_cleanup(root, protected=protection(), current_revision=revision)
    _save(folder / 'CLEANUP-PLAN.json', plan)
    result = apply_plan(plan, protected=protection)
    _save(folder / 'CLEANUP.json', result)
    print('CLEANUP ' + result['status'].upper() + ': ' + str(len(result['removed'])) +
          ' obsolete packages removed; ' + str(result['bytes_removed'] // (1024 * 1024)) +
          ' MiB freed. Report: ' + str(folder / 'CLEANUP.json'), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', required=True, type=Path)
    parser.add_argument('--updates-root', required=True, type=Path)
    args = parser.parse_args()
    stack = args.stack.resolve(strict=True)
    name = json.loads(_output(['docker', 'compose', '--project-directory', str(stack),
        '--env-file', str(stack / 'images.env'), '--env-file', str(stack / '.env'),
        '-f', str(stack / 'docker-compose.yml'), 'config', '--format', 'json']))['name']
    package = Path(__file__).resolve().parent
    revision = json.loads((package / 'release.json').read_text(encoding='utf-8'))['source_revision']
    plan = plan_cleanup(args.updates_root, protected=[package, *_container_paths(stack, name)], current_revision=revision)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    print('PREVIEW ONLY. Nothing deleted. Use update.py --cleanup-root to clean after a verified update.')


if __name__ == '__main__':
    main()
