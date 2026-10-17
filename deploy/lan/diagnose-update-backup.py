#!/usr/bin/env python3
"""Compare a failed update's frozen backup in an isolated PostgreSQL, without migrating."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode('ascii')).hexdigest()


def summarize(before, restored):
    """Report identity/count/hash differences, never row values or seed key values."""
    report = {'equal': before == restored,
              'changed_sections': sorted(key for key in before.keys() | restored.keys()
                                         if before.get(key) != restored.get(key)),
              'schema': {}, 'tables': {}, 'sequences': {}, 'seed_keys': {}}
    for section in sorted(before.get('schema', {}).keys() | restored.get('schema', {}).keys()):
        left, right = before.get('schema', {}).get(section, []), restored.get('schema', {}).get(section, [])
        if left == right:
            continue
        counts = lambda rows: Counter(json.dumps(row, sort_keys=True) for row in rows)
        changed = (counts(left) - counts(right)) + (counts(right) - counts(left))
        report['schema'][section] = {'before_count': len(left), 'restored_count': len(right),
            'order_only': not changed,
            'changed_objects': sorted({tuple(json.loads(row)[:2]) for row in changed})}
    for section in ('tables', 'sequences', 'seed_keys'):
        left, right = before.get(section, {}), restored.get(section, {})
        for name in sorted(left.keys() | right.keys()):
            old, new = left.get(name), right.get(name)
            if old == new:
                continue
            if old is None or new is None:
                report[section][name] = {'presence': 'restored_only' if old is None else 'before_only'}
            elif section == 'tables':
                report[section][name] = {'rows_before': old['rows'], 'rows_restored': new['rows'],
                    'columns_equal': old['columns'] == new['columns'], 'hash_equal': old['sha256'] == new['sha256'],
                    'hash_before': old['sha256'], 'hash_restored': new['sha256']}
            elif section == 'sequences':
                report[section][name] = {'before': old, 'restored': new}
            else:
                report[section][name] = {'column_equal': old['column'] == new['column'],
                    'sequence_equal': old['sequence'] == new['sequence'],
                    'keys_before': len(old['values']), 'keys_restored': len(new['values']),
                    'key_hash_before': digest(old['values']), 'key_hash_restored': digest(new['values'])}
    return report


CONTEXT = '''import json,django
django.setup()
from django.db import connection,transaction
with transaction.atomic():
    with connection.cursor() as c:
        c.execute('SHOW transaction_read_only')
        assert c.fetchone()[0]=='on', 'Read-only probe required'
        c.execute("SELECT name,setting FROM pg_settings WHERE name IN ('TimeZone','DateStyle','IntervalStyle','extra_float_digits','bytea_output','search_path','client_encoding','server_encoding','lc_collate','lc_ctype','lc_numeric','standard_conforming_strings') ORDER BY name")
        settings=dict(c.fetchall())
        c.execute('SELECT datlocprovider,datcollate,datctype,daticulocale,datcollversion,pg_database_collation_actual_version(oid) FROM pg_database WHERE datname=current_database()')
        database=dict(zip(('provider','collate','ctype','icu_locale','recorded_version','actual_version'),c.fetchone()))
        c.execute('SELECT pg_database_size(current_database())')
        size=c.fetchone()[0]
print(json.dumps({'session':settings,'locale':database,'database_bytes':size},sort_keys=True))
'''


def load_driver():
    # Keep the shipped update scripts untouched; verify them before importing.
    manifest = json.loads((HERE / 'release.json').read_text(encoding='utf-8'))
    required = {'application-images.tar', 'update-with-migrations.py', 'schema-transition-checks.py',
                'update-app-only.py', 'update-offline.py', 'schema-transition.json'}
    if not required.issubset(manifest.get('files', {})):
        raise RuntimeError('Put this diagnostic beside the complete 17 October update package')
    print('Verifying the original package and frozen backup...', flush=True)
    for name, expected in manifest['files'].items():
        path = HERE / name
        if path.parent != HERE or path.is_symlink() or file_sha(path) != expected:
            raise RuntimeError('Original package checksum mismatch: ' + name)
    spec = importlib.util.spec_from_file_location('restore_diagnostic_driver', HERE / 'update-with-migrations.py')
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    return driver, manifest


def file_sha(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


class PrivateRunner:
    """Keep command failure details on the server; stderr may include SQL literals."""
    def __init__(self, folder):
        self.folder = folder
        self.count = 0

    def __call__(self, args, *, capture=True, stdin=None, stdout=None, env=None):
        result = subprocess.run(args, stdin=stdin, stdout=stdout or subprocess.PIPE,
                                stderr=subprocess.PIPE, env=env)
        if result.returncode:
            self.count += 1
            path = self.folder / ('private-command-error-' + str(self.count) + '.log')
            path.write_bytes(result.stderr)
            path.chmod(0o600)
            raise RuntimeError('Diagnostic command failed (' + str(result.returncode) + '); private log: ' + str(path))
        output = (result.stdout or b'').decode('utf-8') if stdout is None else ''
        if not capture and output:
            print(output, flush=True)
        return output


def execute(args):
    os.umask(0o077)
    backup = args.backup.resolve(strict=True)
    stack = (args.stack or backup.parents[2]).resolve(strict=True)
    checksums = json.loads((backup / 'checksums.json').read_text(encoding='utf-8'))
    if file_sha(backup / 'database.dump') != checksums.get('database.dump'):
        raise RuntimeError('Frozen database.dump checksum mismatch; preserve the backup')
    before = json.loads((backup / 'database-before.json').read_text(encoding='utf-8'))
    original = json.loads((backup / 'before.json').read_text(encoding='utf-8'))
    driver, manifest = load_driver()
    base = driver.base
    folder = backup / ('diagnostic-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    folder.mkdir(mode=0o700)
    base.run = PrivateRunner(folder)
    db = base.inspect(original['containers']['db']['id'])
    base.validate_container_owner(db, stack, original['project'], 'db')
    mounts = [m for m in db['Mounts'] if m['Destination'] == '/var/lib/postgresql/data']
    if (not db['State']['Running'] or len(mounts) != 1 or mounts[0].get('Name') != original['database_volume']
            or db['Image'] != original['containers']['db']['image']):
        raise RuntimeError('Original PostgreSQL identity changed; preserve evidence for review')
    database_image = base.running_image_id(db)
    configs = base.exported_config_ids(HERE / 'application-images.tar', manifest['images'])
    backend_info = base.inspect(manifest['images']['backend']['tag'])
    base.verify_loaded_image(backend_info, manifest['images']['backend'], configs['backend'])
    backend_image = backend_info['Id']
    compose = ['docker', 'compose', '--project-directory', str(stack),
               '--env-file', str(stack / 'images.env'), '--env-file', str(stack / '.env'),
               '-f', str(stack / 'docker-compose.yml')]
    if any(os.getenv(key) for key in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'BACKEND_IMAGE', 'FRONTEND_IMAGE')):
        raise RuntimeError('Unset compose/image shell overrides before diagnosis')
    proposed = json.loads(base.run(compose + ['config', '--format', 'json'],
                         env={**os.environ, 'BACKEND_IMAGE': backend_image}))
    service_env = proposed['services']['backend']['environment']
    db_env = dict(item.split('=', 1) for item in db['Config']['Env'] if '=' in item)
    if (proposed['name'] != original['project'] or proposed['services']['backend']['image'] != backend_image
            or service_env.get('POSTGRES_HOST') != 'db' or str(service_env.get('POSTGRES_PORT', '5432')) != '5432'
            or any(service_env.get(key) != db_env.get(key) for key in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'))):
        raise RuntimeError('Compose no longer targets the original database/image')
    source_context = json.loads(base.run(compose + ['run', '--rm', '--no-deps', '-T',
        '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000',
        '-e', 'ENABLE_BACKGROUND_TASKS=0', '--entrypoint', 'python', 'backend', '-c', CONTEXT],
        env={**os.environ, 'BACKEND_IMAGE': backend_image}))
    base.save_json(folder / 'source-context.json', source_context)
    free = int(base.run(['docker', 'exec', db['Id'], 'df', '-Pk', '/var/lib/postgresql/data']).splitlines()[-1].split()[3]) * 1024
    if free < 3 * source_context['database_bytes'] + 512 * 1024 * 1024:
        raise RuntimeError('Insufficient Docker space for the isolated restore')
    marker = uuid.uuid4().hex
    name = 'sj-restore-diagnostic-' + marker
    volume = name + '-data'
    label = 'sj-restore-diagnostic'
    clone_env = {**os.environ, 'POSTGRES_DB': 'schema_check', 'POSTGRES_USER': 'schema_check',
        'POSTGRES_PASSWORD': secrets.token_urlsafe(32), 'POSTGRES_HOST': '127.0.0.1', 'POSTGRES_PORT': '5432',
        'DJANGO_SECRET_KEY': secrets.token_urlsafe(48), 'ALLOWED_HOSTS': 'localhost', 'ENABLE_BACKGROUND_TASKS': '0',
        'REDIS_HOST': '127.0.0.1', 'PGOPTIONS': '', 'DJANGO_SETTINGS_MODULE': 'organization_management.config.settings.lan'}
    keys = ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT',
            'DJANGO_SECRET_KEY', 'ALLOWED_HOSTS', 'ENABLE_BACKGROUND_TASKS', 'REDIS_HOST', 'PGOPTIONS', 'DJANGO_SETTINGS_MODULE')
    env_args = [arg for key in keys for arg in ('-e', key)]
    py = ['docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'container:' + name,
          '--label', label + '=' + marker, *env_args, '--entrypoint', 'python', backend_image]
    readonly_env = {**clone_env, 'PGOPTIONS': '-c default_transaction_read_only=on'}
    print('Restoring only into a new isolated PostgreSQL; application services stay running...', flush=True)
    base.run(['docker', 'volume', 'create', '--label', label + '=' + marker, volume])
    try:
        volume_info = json.loads(base.run(['docker', 'volume', 'inspect', volume]))[0]
        if (volume_info.get('Labels') or {}).get(label) != marker:
            raise RuntimeError('Diagnostic volume ownership mismatch')
        base.run(['docker', 'run', '-d', '--pull', 'never', '--name', name, '--network', 'none',
            '--label', label + '=' + marker, *env_args,
            '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data', database_image], env=clone_env)
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'schema_check', '-d', 'schema_check'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Diagnostic PostgreSQL did not start')
        with (backup / 'database.dump').open('rb') as stream:
            base.run(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'schema_check', '-d', 'schema_check',
                      '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], stdin=stream)
        clone_context = json.loads(base.run(py + ['-c', CONTEXT], env=readonly_env))
        restored = driver.run_json(py, 'capture', env=readonly_env)
        # Preserve evidence even when the exact equality check fails.
        base.save_json(folder / 'restored-before.json', restored)
        base.save_json(folder / 'clone-context.json', clone_context)
        report = summarize(before, restored)
        report['source_context_now'] = source_context
        report['clone_context'] = clone_context
        report['reference'] = 'Frozen database-before.json versus frozen database.dump; no current live rows compared'
        base.save_json(folder / 'report.json', report)
    finally:
        found = base.run(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip()
        if found:
            owned = base.inspect(found)
            if (owned['Config'].get('Labels') or {}).get(label) != marker:
                raise RuntimeError('Refusing to remove an unowned diagnostic container')
            base.run(['docker', 'rm', '-f', '-v', found])
        volume_info = json.loads(base.run(['docker', 'volume', 'inspect', volume]))[0]
        if (volume_info.get('Labels') or {}).get(label) != marker:
            raise RuntimeError('Refusing to remove an unowned diagnostic volume')
        base.run(['docker', 'volume', 'rm', volume])
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    print('DIAGNOSIS COMPLETE. No migrations or application restarts. Private evidence: ' + str(folder), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True, help='Exact failed schema-* backup folder')
    parser.add_argument('--stack', type=Path, help='Existing stack; otherwise inferred from its backups/updates folder')
    args = parser.parse_args()
    try:
        execute(args)
    except (RuntimeError, OSError, ValueError, KeyError, KeyboardInterrupt, subprocess.SubprocessError) as error:
        print('DIAGNOSIS STOPPED: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
