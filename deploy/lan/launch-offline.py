#!/usr/bin/env python3
"""Single-command launcher; the distributed obnovit.py embeds the verified updater."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zlib

UPDATER_DATA = '__UPDATER_DATA__'
UPDATER_SHA256 = '__UPDATER_SHA256__'
COMPAT_DATA = '__COMPAT_DATA__'
COMPAT_SHA256 = '__COMPAT_SHA256__'
ARCHIVE_SHA256 = '33df5c7c6936ca68199300932140bc4fb8a557d1d0a214b3bbc9901785c9fd92'
PROJECT = 'smart-josparlau-lan'


def docker_json(*args):
    process = subprocess.run(['docker', *args], capture_output=True)
    if process.returncode:
        raise RuntimeError(process.stderr.decode('utf-8', errors='replace'))
    return json.loads(process.stdout)


def locate_stack():
    process = subprocess.run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                              '--filter', 'label=com.docker.compose.service=backend', '--format', '{{.ID}}'],
                             capture_output=True)
    ids = process.stdout.decode().split()
    if process.returncode or len(ids) != 1:
        raise RuntimeError('Expected one running backend in stack ' + PROJECT)
    labels = docker_json('inspect', ids[0])[0]['Config']['Labels']
    configs = labels.get('com.docker.compose.project.config_files', '').split(',')
    if len(configs) != 1 or not configs[0]:
        raise RuntimeError('Cannot identify a single existing compose file')
    config = Path(configs[0])
    if not config.is_absolute():
        config = Path(labels.get('com.docker.compose.project.working_dir', '')) / config
    if not config.is_file() or config.name != 'docker-compose.yml':
        raise RuntimeError('Existing docker-compose.yml was not found at ' + str(config))
    return config.resolve().parent


def locate_package(root):
    candidates = []
    for directory, children, files in os.walk(root):
        relative = Path(directory).relative_to(root)
        children[:] = [name for name in children if not name.startswith('.') and name not in
                       {'source', 'node_modules', 'backups', 'update-verification-backups'}]
        if len(relative.parts) >= 3:
            children[:] = []
        if 'application-images.tar' in files and 'release.json' in files:
            path = Path(directory)
            manifest = json.loads((path / 'release.json').read_text(encoding='utf-8'))
            if manifest.get('files', {}).get('application-images.tar') == ARCHIVE_SHA256:
                candidates.append(path)
    if not candidates:
        raise RuntimeError('Unpack smart-josparlau-update-20260924.zip under ' + str(root) + ' and run again')
    return sorted(candidates, key=lambda path: (len(path.parts), str(path)))[0]


def install_updater(package):
    content = zlib.decompress(base64.b64decode(UPDATER_DATA))
    if hashlib.sha256(content).hexdigest() != UPDATER_SHA256:
        raise RuntimeError('Launcher payload checksum mismatch')
    compat = zlib.decompress(base64.b64decode(COMPAT_DATA))
    if hashlib.sha256(compat).hexdigest() != COMPAT_SHA256:
        raise RuntimeError('Compatibility payload checksum mismatch')
    manifest_path = package / 'release.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('release') != 'uc-ref-adm-20260924':
        raise RuntimeError('Unexpected update release')
    # Only deployment files in the update package change; server config is not edited here.
    temporary = package / 'update-offline.py.new'
    temporary.write_bytes(content)
    os.replace(temporary, package / 'update-offline.py')
    (package / 'compat-files.json').write_bytes(compat)
    manifest['files']['update-offline.py'] = UPDATER_SHA256
    manifest['files']['compat-files.json'] = COMPAT_SHA256
    manifest['compatibility_overlay'] = 'production-import-fields-v1'
    manifest['updater_revision'] = 'production-schema-v4'
    encoded = (json.dumps(manifest, indent=2) + '\n').encode('utf-8')
    temporary = package / 'release.json.new'
    temporary.write_bytes(encoded)
    os.replace(temporary, manifest_path)
    sums = {**manifest['files'], 'release.json': hashlib.sha256(encoded).hexdigest()}
    (package / 'SHA256SUMS.txt').write_text(
        ''.join(f'{value}  {name}\n' for name, value in sums.items()), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Only verify package, images and configuration; do not update')
    parser.add_argument('--search-root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--backup-root', type=Path, default=Path('/home/eco/backups/smart-josparlau'))
    args = parser.parse_args()
    if sys.version_info < (3, 9):
        raise RuntimeError('Python 3.9 or newer is required')
    os.umask(0o077)
    stack = locate_stack()
    package = locate_package(args.search_root.resolve())
    print('Working installation:', stack, flush=True)
    print('Update package:', package, flush=True)
    print('Backup location:', args.backup_root, flush=True)
    install_updater(package)
    command = [sys.executable, str(package / 'update-offline.py'), '--stack', str(stack),
               '--backup-root', str(args.backup_root)]
    if args.check:
        modes = ['check']
    else:
        print('First: test a database copy while the app stays online. Then: backup and update during a short outage.', flush=True)
        modes = ['rehearse', 'apply']
    for mode in modes:
        result = subprocess.run(command + ['--mode', mode])
        if result.returncode:
            raise RuntimeError('Stopped at ' + mode + '; see the error above. Do not delete or restore the production database.')
    if args.check:
        print('CHECK PASSED. Production data and services were not changed.', flush=True)
    else:
        print('UPDATE COMPLETE. Open http://10.15.3.187:3300 and refresh the page.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyboardInterrupt) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
