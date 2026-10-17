#!/usr/bin/env python3
"""Recognize obsolete, checksum-listed LAN releases without extracting archives.

Unknown files are never deletion candidates. No Docker commands or writes live here.
Keep cleanup-old-releases.py beside this file when distributing the maintenance kit.
"""
import importlib.util
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import zipfile
import zlib


HERE = Path(__file__).resolve().parent
_base_path = HERE / 'cleanup-old-releases.py'
if not _base_path.is_file():
    _base_path = HERE.parent / 'deploy/lan/cleanup-old-releases.py'
_spec = importlib.util.spec_from_file_location('maintenance_cleanup_base', _base_path)
cleanup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cleanup)

FULL_ALLOWED = cleanup.ALLOWED | {
    'runtime-images.tar.gz', 'images.env', 'images-manifest.txt', 'images-manifest.json',
    'platform.txt', 'source-revision.txt', 'source-sha256sums.txt',
    'docker-compose.yml', '.env', '.env.example', 'settings.py', 'nginx-backend.conf',
    'configure.py', 'ctl.sh', 'install.sh', 'data.sh', 'sanitize-copy.py',
    'prepare-assets.py', 'ui-assets.lock.json', 'redoc.html', 'INSTALL-RU.md',
    'build.py', 'build.sh',
}
FULL_REQUIRED = {
    'runtime-images.tar.gz', 'images.env', 'images-manifest.txt', 'source-revision.txt',
    'source-sha256sums.txt', 'sha256sums.txt', 'docker-compose.yml', 'install.sh',
}
MUTABLE = {'.env', '.env.example', 'images.env', 'docker-compose.yml',
           'settings.py', 'nginx-backend.conf', 'redoc.html', 'ui-assets.lock.json'}
FORBIDDEN = {'.git', 'backup', 'backups', '__pycache__', 'node_modules', '.next'}
MAX_ENTRIES = 100000
MAX_METADATA = 16 * 1024 * 1024
ARCHIVE_NAME = re.compile(r'smart-josparlau-.*\.(?:zip|tar|tar\.gz|tgz|tar\.bz2|tar\.xz)', re.I)
INSPECTION_ERRORS = (ValueError, OSError, KeyError, TypeError, AttributeError,
                     zipfile.BadZipFile, tarfile.TarError, zlib.error, lzma.LZMAError,
                     EOFError, NotImplementedError, RuntimeError)


def identity(path, mount_points=None):
    info = path.lstat()
    mounts = cleanup._mount_points() if mount_points is None else mount_points
    if path.is_symlink() or os.path.ismount(path) or path.resolve() in mounts:
        raise ValueError('Symbolic link or mount point; keep this path')
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError('Not a regular file or directory')
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        raise ValueError('Hard-linked file; keep this path')
    return [info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns, info.st_nlink]


def snapshot(top):
    mounts = cleanup._mount_points()
    entries = []

    def visit(path, depth):
        if depth > 64 or len(entries) >= MAX_ENTRIES:
            raise ValueError('Too many or excessively nested release entries')
        token = identity(path, mounts)
        directory = stat.S_ISDIR(token[2])
        entries.append({'path': str(path), 'identity': token, 'directory': directory})
        if directory:
            for child in sorted(path.iterdir()):
                visit(child, depth + 1)
    visit(top, 0)
    return entries


def _name(value):
    if (not isinstance(value, str) or not value or '\\' in value or ':' in value or
            any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise ValueError('Unsafe release member path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Unsafe release member path')
    if len(path.parts) > 64:
        raise ValueError('Excessively nested release member')
    return value


def _checksums(body):
    if len(body) > MAX_METADATA:
        raise ValueError('Oversized checksum manifest')
    result = {}
    for line in body.decode('utf-8-sig').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64}) [ *](.+)', line)
        if not match:
            raise ValueError('Malformed checksum manifest')
        name = _name(match[2])
        if name in result:
            raise ValueError('Duplicate checksum entry')
        result[name] = match[1]
    if not result:
        raise ValueError('Empty checksum manifest')
    return result


def _small(read, name, sizes):
    if sizes[name] > MAX_METADATA:
        raise ValueError('Oversized release metadata: ' + name)
    with read(name) as stream:
        return stream.read(MAX_METADATA + 1)


def _full(files, directories, sizes, read, *, mutable):
    if files.intersection(directories):
        raise ValueError('Archive file/directory path collision')
    root_files = {name for name in files if '/' not in name}
    if not FULL_REQUIRED.issubset(root_files) or not root_files.issubset(FULL_ALLOWED):
        raise ValueError('Not a known full offline release')
    revision = _small(read, 'source-revision.txt', sizes).decode('ascii').strip()
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Invalid full release source revision')
    checksums = _checksums(_small(read, 'sha256sums.txt', sizes))
    source = _checksums(_small(read, 'source-sha256sums.txt', sizes))
    if (not set(checksums).issubset(root_files - {'sha256sums.txt'}) or
            root_files - {'sha256sums.txt', '.env'} - set(checksums) or
            (not mutable and root_files - {'sha256sums.txt'} != set(checksums))):
        raise ValueError('Incomplete root checksum manifest')
    source_files = files - root_files
    if (source_files != set(source) or not source_files or
            any(not name.startswith('source/') for name in source_files)):
        raise ValueError('Source tree has missing, unknown or unlisted files')
    for name in source_files:
        parts = PurePosixPath(name).parts
        if (FORBIDDEN.intersection(parts) or parts[-1] in {'.env', 'database.dump'} or
                parts[-1].endswith(('.sqlite3', '.db', '.sql', '.dump'))):
            raise ValueError('Source tree contains database, backup or checkout data')
    allowed_dirs = {str(parent) for name in source_files for parent in PurePosixPath(name).parents
                    if str(parent) != '.'}
    if directories != allowed_dirs:
        raise ValueError('Unknown or empty directory inside full release')
    for name, expected in {**checksums, **source}.items():
        if mutable and name in MUTABLE:
            continue
        with read(name) as stream:
            if cleanup._hash(stream) != expected:
                raise ValueError('Release checksum mismatch: ' + name)
    # Preserve every small root file, including all mutable configuration, before
    # removing a directory or archive. Config values never enter JSON reports.
    configuration = []
    for name in sorted(root_files - {'runtime-images.tar.gz', 'application-images.tar'}):
        if sizes[name] > MAX_METADATA:
            raise ValueError('Oversized release configuration or script')
        with read(name) as stream:
            digest = cleanup._hash(stream)
        configuration.append({'name': name, 'sha256': digest})
    return revision, configuration


def _directory(top, entries):
    package = top
    if not (package / 'source-sha256sums.txt').is_file() and not (package / 'release.json').is_file():
        children = list(package.iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise ValueError('Not a release directory or a single extraction wrapper')
        package = children[0]
    if not (package / 'source-sha256sums.txt').is_file():
        value, _ = cleanup._directory(top)
        if {child.name for child in package.iterdir()} != set(value['files']) | {'release.json'}:
            raise ValueError('Unlisted application files or generated contents must be kept')
        return value['source_revision'], 'application', [], str(package)
    relative = [entry for entry in entries if Path(entry['path']).is_relative_to(package)
                and Path(entry['path']) != package]
    files = {Path(entry['path']).relative_to(package).as_posix() for entry in relative if not entry['directory']}
    directories = {Path(entry['path']).relative_to(package).as_posix() for entry in relative if entry['directory']}
    for name in files | directories:
        _name(name)
    sizes = {Path(entry['path']).relative_to(package).as_posix(): entry['identity'][3]
             for entry in relative if not entry['directory']}
    revision, configuration = _full(files, directories, sizes, lambda name: (package / name).open('rb'), mutable=True)
    return revision, 'full-directory', configuration, str(package)


def _archive(path):
    zipped = path.suffix.lower() == '.zip'
    with (zipfile.ZipFile(path) if zipped else tarfile.open(path, 'r:*')) as archive:
        members = archive.infolist() if zipped else archive.getmembers()
        if len(members) > MAX_ENTRIES:
            raise ValueError('Too many archive members')
        files, directories, seen = {}, set(), set()
        for member in members:
            original = member.filename if zipped else member.name
            directory = member.is_dir() if zipped else member.isdir()
            name = _name(original[:-1] if directory and original.endswith('/') else original)
            if name in seen:
                raise ValueError('Duplicate archive member')
            seen.add(name)
            if zipped:
                mode = stat.S_IFMT(member.external_attr >> 16)
                if mode not in (0, stat.S_IFDIR if directory else stat.S_IFREG):
                    raise ValueError('Archive links or special files are not allowed')
            elif member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
                raise ValueError('Archive links or special files are not allowed')
            if directory:
                directories.add(name)
            else:
                files[name] = member
        ancestors = {str(parent) for name in files for parent in PurePosixPath(name).parents
                     if str(parent) != '.'}
        if set(files).intersection(directories | ancestors):
            raise ValueError('Archive file/directory path collision')
        if 'sha256sums.txt' in files or 'release.json' in files:
            prefix = ''
        else:
            roots = {name.split('/')[0] for name in files}
            if len(roots) != 1:
                raise ValueError('Not a single full release archive')
            prefix = next(iter(roots)) + '/'
        # App ZIP verification remains the established updater implementation.
        if not any(name == prefix + 'source-sha256sums.txt' for name in files):
            if not zipped:
                raise ValueError('Not a known full offline archive')
            value, _ = cleanup._archive(path)
            if ({name[len(prefix):] for name in files} != set(value['files']) | {'release.json'} or
                    directories - ({prefix[:-1]} if prefix else set())):
                raise ValueError('Unlisted application archive files or directories must be kept')
            return value['source_revision'], 'application', [], None
        if prefix:
            if any(not name.startswith(prefix) for name in files):
                raise ValueError('Mixed archive roots')
            if any(name != prefix[:-1] and not name.startswith(prefix) for name in directories):
                raise ValueError('Mixed archive directories')
        by_name = {name[len(prefix):]: member for name, member in files.items()}
        dirs = {name[len(prefix):] for name in directories if name != prefix[:-1]}
        # ZIPs may omit explicit directory records. Infer ancestors, while still
        # rejecting explicitly recorded empty/unknown directories.
        dirs |= {str(parent) for name in by_name for parent in PurePosixPath(name).parents if str(parent) != '.'}
        sizes = {name: member.file_size if zipped else member.size for name, member in by_name.items()}
        read = lambda name: archive.open(by_name[name]) if zipped else archive.extractfile(by_name[name])
        revision, configuration = _full(set(by_name), dirs, sizes, read, mutable=False)
        return revision, 'full-archive', configuration, prefix


def plan_cleanup(root, *, protected, current_revision):
    root = Path(root).resolve(strict=True)
    if not root.is_dir() or root.parent == root:
        raise ValueError('Use a specific existing project updates directory')
    identity(root)
    protected = [Path(path).resolve() for path in protected]
    result = {'root': str(root), 'current_revision': current_revision,
              'remove': [], 'keep': [], 'skip': []}
    candidates = []
    for path in sorted(root.iterdir()):
        try:
            if path.name.lower() in cleanup.RESERVED or cleanup._overlaps(path.resolve(), protected):
                raise ValueError('Protected installation, tools, Docker path or backup')
            entries = snapshot(path)
            if path.is_dir():
                revision, kind, configuration, package = _directory(path, entries)
            elif ARCHIVE_NAME.fullmatch(path.name):
                revision, kind, configuration, package = _archive(path)
            else:
                raise ValueError('Not a recognized release; small sidecars and unknown files are kept')
            if entries != snapshot(path):
                raise ValueError('Release changed during verification')
            candidates.append({'path': str(path), 'revision': revision, 'kind': kind,
                               'mtime_ns': entries[0]['identity'][4], 'entries': entries,
                               'configuration': configuration, 'package': package,
                               'bytes': sum(entry['identity'][3] for entry in entries if not entry['directory'])})
        except INSPECTION_ERRORS as error:
            result['skip'].append({'path': str(path), 'reason': str(error)})
    previous = [item for item in candidates if item['kind'] == 'application' and item['revision'] != current_revision]
    previous_revision = max(previous, key=lambda item: item['mtime_ns'])['revision'] if previous else None
    full = [item for item in candidates if item['kind'] == 'full-archive']
    if not full:
        full = [item for item in candidates if item['kind'] == 'full-directory']
    full_revision = max(full, key=lambda item: item['mtime_ns'])['revision'] if full else None
    for item in candidates:
        reason = None
        if item['revision'] == current_revision:
            reason = 'current application revision'
        elif item['kind'] == 'application' and item['revision'] == previous_revision:
            reason = 'newest previous application revision'
        elif item['kind'].startswith('full-') and item['revision'] == full_revision:
            reason = 'newest verified full rollback revision (all representations)'
        if reason:
            item['reason'] = reason
            result['keep'].append(item)
        else:
            result['remove'].append(item)
    return result
