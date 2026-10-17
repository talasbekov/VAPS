#!/usr/bin/env python3
"""Repair the 17 October updater's proven CHECK roundtrip fingerprint mismatch."""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid
import zlib

# The release builder fills these with the exact original manifests and the
# reviewed replacement source. This repair never imports the server's modules.
BUILD_CONFIGURATION = 'REPLACED_BY_RELEASE_BUILDER'
BUILD_CONFIGURATION_SHA256 = 'REPLACED_BY_RELEASE_BUILDER'
NAMES = ('schema-transition-checks.py', 'schema-transition.json', 'release.json')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def load_configuration():
    data = zlib.decompress(base64.b85decode(BUILD_CONFIGURATION))
    if sha(data) != BUILD_CONFIGURATION_SHA256:
        raise RuntimeError('Repair payload checksum mismatch')
    return json.loads(data)


def prepared_files(configuration):
    release = json.loads(configuration['release_text'])
    transition = json.loads(configuration['transition_text'])
    source = configuration['checks_source'].encode('utf-8')
    checks = {'__name__': 'reviewed_check_fingerprint'}
    exec(compile(source, 'reviewed-schema-transition-checks.py', 'exec'), checks)
    if (release.get('source_revision') != checks['SOURCE_REVISION'] or release.get('compatibility_overlay')
            or transition.get('source_revision') != checks['SOURCE_REVISION']
            or transition.get('images') != release.get('images')
            or transition.get('plans') != [[list(item) for item in plan] for plan in checks['APPROVED_PLANS']]
            or set(transition.get('files', {})) != {'update-with-migrations.py', 'schema-transition-checks.py'}
            or release['files'].get('schema-transition.json') != sha(configuration['transition_text'].encode('utf-8'))):
        raise RuntimeError('Mismatched repair build configuration')
    transition['files']['schema-transition-checks.py'] = sha(source)
    transition_bytes = json_bytes(transition)
    release['files']['schema-transition-checks.py'] = sha(source)
    release['files']['schema-transition.json'] = sha(transition_bytes)
    return {'schema-transition-checks.py': source, 'schema-transition.json': transition_bytes,
            'release.json': json_bytes(release)}


def verified_evidence(backup, configuration):
    checksums = json.loads((backup / 'checksums.json').read_text(encoding='utf-8'))
    if file_sha(backup / 'database.dump') != checksums.get('database.dump'):
        raise RuntimeError('Frozen dump checksum mismatch')
    candidates = sorted(backup.glob('diagnostic-*/restored-before.json'))
    if not candidates:
        raise RuntimeError('Saved restored-before.json is required; run the read-only diagnostic first')
    restored_path = candidates[-1].resolve(strict=True)
    if not restored_path.is_relative_to(backup):
        raise RuntimeError('Diagnostic evidence points outside the selected backup')
    before = json.loads((backup / 'database-before.json').read_text(encoding='utf-8'))
    restored = json.loads(restored_path.read_text(encoding='utf-8'))
    scope = {'__name__': 'reviewed_check_fingerprint'}
    exec(compile(configuration['checks_source'], 'reviewed-schema-transition-checks.py', 'exec'), scope)
    for snapshot in (before, restored):
        snapshot['schema']['constraints'] = [[table, name, scope['canonical_constraint'](table, name, definition)]
            for table, name, definition in snapshot['schema']['constraints']]
    if before != restored:
        raise RuntimeError('Frozen backup has additional differences; repair refused')
    return restored_path


def verify_package(package, expected):
    manifest = json.loads(expected['release.json'])
    if (package / 'release.json').is_symlink() or (package / 'release.json').read_bytes() != expected['release.json']:
        raise RuntimeError('This repair requires the exact original or repaired 17 October package')
    required = {'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py',
                'update-with-migrations.py', 'schema-transition-checks.py', 'schema-transition.json'}
    if not required.issubset(manifest.get('files', {})):
        raise RuntimeError('Complete original update package required')
    for name, digest in manifest['files'].items():
        path = package / name
        if path.parent != package or path.is_symlink() or not path.is_file() or file_sha(path) != digest:
            raise RuntimeError('Package file checksum mismatch: ' + name)


def atomic_install(path, data, staging):
    temporary = staging / ('staged-' + uuid.uuid4().hex)
    with temporary.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, path)


def repair(package, backup, configuration):
    os.umask(0o077)
    package, backup = Path(package).resolve(strict=True), Path(backup).resolve(strict=True)
    if backup.parent.name != 'updates' or backup.parent.parent.name != 'backups':
        raise RuntimeError('Use the failed installation backup under backups/updates/schema-*')
    payload = prepared_files(configuration)
    lock = backup.parents[2] / '.offline-update-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('An update/recovery already owns .offline-update-lock; leave it intact')
    marker = uuid.uuid4().hex
    owner = {'marker': marker, 'pid': os.getpid(), 'mode': 'check-roundtrip-package-repair', 'package': str(package)}
    keep_lock = False
    staging = None
    try:
        (lock / 'owner.json').write_bytes(json_bytes(owner))
        current = (package / 'release.json').read_bytes()
        original_manifest = configuration['release_text'].encode('utf-8')
        if current == original_manifest:
            original = {'release.json': original_manifest}
            verify_package(package, original)
            already_fixed = False
        elif current == payload['release.json']:
            verify_package(package, payload)
            already_fixed = True
        else:
            raise RuntimeError('Unknown package revision; no files replaced')
        print('Package verified. Checking saved backup evidence...', flush=True)
        verified_evidence(backup, configuration)
        if already_fixed:
            print('PATCH ALREADY INSTALLED. Saved backup comparison passed; database unchanged.', flush=True)
            return
        original = {name: (package / name).read_bytes() for name in NAMES}
        staging = package / ('.check-roundtrip-fix-' + time.strftime('%Y%m%d-%H%M%S') + '-' + marker[:8])
        staging.mkdir(mode=0o700)
        for name, data in original.items():
            (staging / name).write_bytes(data)
            (staging / name).chmod(0o600)
        installed = []
        try:
            for name in NAMES:
                atomic_install(package / name, payload[name], staging)
                installed.append(name)
            verify_package(package, payload)
        except BaseException:
            try:
                for name in reversed(installed):
                    atomic_install(package / name, original[name], staging)
                verify_package(package, original)
            except BaseException:
                keep_lock = True
                raise RuntimeError('Package repair needs recovery; preserve lock and original files: ' + str(staging))
            raise
        (staging / 'PATCH_INSTALLED.json').write_bytes(json_bytes({'changed_files': list(NAMES),
            'saved_backup_comparison_passed': True, 'application_images_unchanged': True,
            'database_changed': False, 'application_services_restarted': False,
            'replacement_checks_sha256': sha(payload['schema-transition-checks.py'])}))
        print('PATCH INSTALLED. Saved backup comparison passed; database unchanged. Original tools: ' + str(staging), flush=True)
    finally:
        if keep_lock:
            owner['phase'] = 'package-repair-recovery-required'
            (lock / 'owner.json').write_bytes(json_bytes(owner))
        elif (lock / 'owner.json').is_file():
            saved = json.loads((lock / 'owner.json').read_text(encoding='utf-8'))
            if saved.get('marker') == marker:
                (lock / 'owner.json').unlink()
                lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=Path.cwd())
    parser.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    try:
        repair(args.package, args.backup, load_configuration())
    except (RuntimeError, OSError, ValueError, KeyError, KeyboardInterrupt, zlib.error) as error:
        print('PATCH REFUSED: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
