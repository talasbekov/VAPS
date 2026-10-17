#!/usr/bin/env python3
"""Repair the eight confirmed production division links; default is read-only.

Uses the already installed October 16 update images, never imports laptop data.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
SOURCE_REVISION = '2ca558a6e5a97e8a54cd5b56ed357096cea60681'
CHECK_SOURCE = (HERE / 'org-0111-repair-checks.py').read_text(encoding='utf-8')
BOOTSTRAP = '''import json,sys,django
payload=json.load(sys.stdin)
django.setup()
exec(payload['source'],globals())
from django.db import connection,transaction
from organization_management.apps.divisions.models import Division
action=payload['action']
if action in ('plan','capture'):
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            cursor.execute('SHOW transaction_read_only')
            assert cursor.fetchone()[0]=='on'
        if action=='plan':
            rows=list(Division.objects.values('id','name','code','division_type','parent_id'))
            result={'plan':build_plan(rows),'division_count':len(rows),'read_only':True}
        else:
            result=capture()
elif action=='apply':
    result=apply_atomic(payload['before'],payload['plan'])
else:
    raise RuntimeError('Unknown repair action')
print(json.dumps(result,sort_keys=True,default=str))
'''


def load_module(file, name):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checks = load_module(HERE / 'org-0111-repair-checks.py', 'org_0111_checks')


def save(path, value, *, exclusive=False):
    with path.open('x' if exclusive else 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    path.chmod(0o600)


def make_update(stack, package):
    package = Path(package).resolve(strict=True)
    manifest = json.loads((package / 'release.json').read_text(encoding='utf-8'))
    if manifest.get('source_revision') != SOURCE_REVISION or manifest.get('compatibility_overlay'):
        raise RuntimeError('Use the complete October 16 update package (2ca558a6), not an older package')
    required = {'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py'}
    if not required.issubset(manifest.get('files', {})) or set(manifest.get('images', {})) != {'backend', 'frontend'}:
        raise RuntimeError('Incomplete installed update package')
    for name, expected in manifest['files'].items():
        path = package / name
        if path.parent != package or path.is_symlink():
            raise RuntimeError('Unsafe package file')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise RuntimeError('Update package checksum mismatch: ' + name)
    app = load_module(package / 'update-app-only.py', 'installed_app_update')
    update = app.ApplicationUpdate(argparse.Namespace(stack=stack))
    config_ids = app.base.exported_config_ids(package / 'application-images.tar', manifest['images'])
    for service in ('backend', 'frontend'):
        image = app.base.inspect(manifest['images'][service]['tag'])
        app.base.verify_loaded_image(image, manifest['images'][service], config_ids[service])
        if service == 'frontend' and update.old_frontend != image['Id']:
            raise RuntimeError('Running frontend is not the October 16 release')
        if service == 'backend':
            running = app.base.inspect(update.old_backend)
            layers = image['RootFS']['Layers']
            if (running['RootFS']['Layers'][:len(layers)] != layers or
                    running['Config'].get('Cmd') != image['Config'].get('Cmd') or
                    running['Config'].get('Entrypoint') != ['/bin/sh', '/sj-app-only-entrypoint.sh'] or
                    (running['Config'].get('Labels') or {}).get('smart-josparlau.app-only-entrypoint') !=
                    hashlib.sha256(app.ENTRYPOINT.encode()).hexdigest()):
                raise RuntimeError('Running backend is not the verified migration-free October 16 application')
    validate_resume_images(app, update)
    update.recovery_required = False
    update.org_mutator_name = 'sj-org-repair-writer-' + uuid.uuid4().hex
    update.org_marker = uuid.uuid4().hex
    return app, update


def validate_resume_images(app, update):
    for service in ('backend', 'worker', *update.schedulers, 'frontend'):
        expected = update.old_frontend if service == 'frontend' else update.old_backend
        configured = app.base.inspect(update.services[service]['image'])['Id']
        if configured != expected:
            raise RuntimeError('Configured image differs from the verified running application: ' + service)


def resume_env(update):
    return {**os.environ, 'BACKEND_IMAGE': update.old_backend, 'FRONTEND_IMAGE': update.old_frontend}


def start_application(update):
    update.org_app.base.run(update.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
        '--wait', '--wait-timeout', '300', 'backend', 'frontend'], capture=False, env=resume_env(update))


def start_writers(update):
    update.org_app.base.run(update.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
        '--wait', '--wait-timeout', '180', 'worker', *update.schedulers], capture=False, env=resume_env(update))
    update.org_app.base.run(update.base + ['start', 'proxy'], env=resume_env(update))


def close_for_recovery(app, update):
    services = ('proxy', 'frontend', 'backend', 'worker', *update.schedulers)
    try:
        app.base.run(update.base + ['stop', '-t', '120', *services], env=resume_env(update))
    except BaseException:
        pass
    stopped = True
    for service in services:
        try:
            ids = app.base.run(update.base + ['ps', '-a', '-q', service], env=resume_env(update)).split()
            for cid in ids:
                row = app.base.inspect(cid)
                app.base.validate_container_owner(row, update.stack, update.config['name'], service)
                if row['State'].get('Running') or row['State'].get('Restarting'):
                    app.base.run(['docker', 'stop', '-t', '120', cid])
                    row = app.base.inspect(cid)
                stopped = stopped and not (row['State'].get('Running') or row['State'].get('Restarting'))
        except BaseException:
            stopped = False
    return stopped


def run_json(base, command, action, *, before=None, plan=None, env=None):
    payload = {'source': CHECK_SOURCE, 'action': action, 'before': before, 'plan': plan}
    with tempfile.TemporaryFile() as stream:
        stream.write(json.dumps(payload).encode('utf-8'))
        stream.seek(0)
        return json.loads(base.run([*command, '-c', BOOTSTRAP], stdin=stream, env=env))


def probe(update, action, *, before=None, plan=None):
    app = update.org_app
    command = update.base + ['run', '--no-deps', '-T']
    if action == 'apply':
        command += ['--name', update.org_mutator_name, '--label', 'sj-org-repair=' + update.org_marker]
    else:
        command += ['--rm', '-e', 'PGOPTIONS=-c default_transaction_read_only=on']
    command += ['--entrypoint', 'python', 'backend']
    return run_json(app.base, command, action, before=before, plan=plan,
                    env={**os.environ, 'BACKEND_IMAGE': update.old_backend})


def rehearse(app, update, folder, before, plan):
    marker = uuid.uuid4().hex
    name, volume = 'sj-org-repair-check-' + marker, 'sj-org-repair-data-' + marker
    env = {**os.environ, 'POSTGRES_DB': 'org_repair_check', 'POSTGRES_USER': 'org_repair_check',
        'POSTGRES_PASSWORD': secrets.token_urlsafe(32), 'POSTGRES_HOST': '127.0.0.1', 'POSTGRES_PORT': '5432',
        'DJANGO_SECRET_KEY': secrets.token_urlsafe(48), 'DJANGO_SETTINGS_MODULE': 'organization_management.config.settings.lan',
        'ENABLE_BACKGROUND_TASKS': '0', 'ALLOWED_HOSTS': 'localhost', 'REDIS_HOST': '127.0.0.1', 'PGOPTIONS': ''}
    keys = ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT',
            'DJANGO_SECRET_KEY', 'DJANGO_SETTINGS_MODULE', 'ENABLE_BACKGROUND_TASKS', 'ALLOWED_HOSTS', 'REDIS_HOST', 'PGOPTIONS')
    env_args = [arg for key in keys for arg in ('-e', key)]
    py = ['docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'container:' + name,
          *env_args, '--entrypoint', 'python', update.old_backend]
    app.base.run(['docker', 'volume', 'create', '--label', 'sj-org-repair=' + marker, volume])
    try:
        app.base.run(['docker', 'run', '-d', '--pull', 'never', '--network', 'none', '--name', name,
            '--label', 'sj-org-repair=' + marker, *env_args,
            '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data', update.database_image], env=env)
        for attempt in range(60):
            try:
                app.base.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'org_repair_check', '-d', 'org_repair_check'])
                break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('Isolated organization repair database did not start')
        with (folder / 'database.dump').open('rb') as stream:
            app.base.run(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'org_repair_check', '-d', 'org_repair_check',
                          '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], stdin=stream)
        restored = run_json(app.base, py, 'capture', env=env)
        if restored != before:
            raise RuntimeError('Restored backup differs from paused database; repair refused')
        tested = run_json(app.base, py, 'apply', before=restored, plan=plan, env=env)
        checks.verify_preserved(before, tested, plan)
        save(folder / 'rehearsal-after.json', tested, exclusive=True)
        print('REHEARSAL PASSED. Backup restored; only approved division changes verified.', flush=True)
    finally:
        found = app.base.run(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip()
        if found and (app.base.inspect(found)['Config'].get('Labels') or {}).get('sj-org-repair') == marker:
            app.base.run(['docker', 'rm', '-f', found])
        info = json.loads(app.base.run(['docker', 'volume', 'inspect', volume]))[0]
        if (info.get('Labels') or {}).get('sj-org-repair') == marker:
            app.base.run(['docker', 'volume', 'rm', volume])


def apply_repair(app, update, plan, folder, owner, lock):
    stopped = False
    write_started = False
    try:
        update.check_space(folder)
        stopped = True
        print('Stopping application writers for a verified organizational data repair...', flush=True)
        app.base.run(update.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', *update.schedulers])
        app.base.run(update.base + ['stop', '-t', '600', 'worker'])
        worker = app.base.inspect(update.ids['worker'])['State']
        if worker.get('OOMKilled') or worker.get('ExitCode') == 137:
            raise RuntimeError('Worker was killed rather than drained; repair refused')
        update.backup(folder, uploads=True)
        before = probe(update, 'capture')
        current_plan = checks.build_plan(before['divisions'])
        if current_plan != plan:
            raise RuntimeError('Organization changed after preflight; repair refused')
        save(folder / 'organization-plan.json', plan, exclusive=True)
        save(folder / 'database-before.json', before, exclusive=True)
        rehearse(app, update, folder, before, plan)
        owner.update(phase='applying-organizational-repair', mutator_container=update.org_mutator_name,
                     mutator_label=update.org_marker)
        save(lock / 'owner.json', owner)
        write_started = True
        after = probe(update, 'apply', before=before, plan=plan)
        checks.verify_preserved(before, after, plan)
        save(folder / 'database-after.json', after, exclusive=True)
        writer = app.base.inspect(update.org_mutator_name)
        if writer['State']['Status'] != 'exited' or writer['State']['ExitCode'] != 0 or (
                writer['Config'].get('Labels') or {}).get('sj-org-repair') != update.org_marker:
            raise RuntimeError('Cannot confirm the repair writer exited successfully')
        app.base.run(['docker', 'rm', writer['Id']])
        start_application(update)
        verified = probe(update, 'capture')
        if verified != after:
            raise RuntimeError('Application startup changed the verified repaired database')
        db = app.base.inspect(update.ids['db'])
        if db['Id'] != update.db['Id'] or db['Mounts'] != update.db['Mounts']:
            raise RuntimeError('Database container/volume changed')
        start_writers(update)
        result = {'mode': 'organization-data-repair-0111', 'migrations_executed': False,
            'existing_division_ids_preserved': True, 'all_other_tables_and_sequences_preserved': True,
            'existing_immutable_division_fields_preserved': True, 'mptt_verified': True,
            'backup_restored_and_patch_rehearsed': True, 'database_container_unchanged': True,
            'existing_nodes_moved': len(plan['changes']), 'intermediates_created': len(plan['create']),
            'database_volume': update.volume}
        save(folder / 'ORG-REPAIR-SUCCESS.json', result, exclusive=True)
        print('ORG REPAIR PASSED. Existing IDs, employees and all unrelated data preserved. Backup: ' + str(folder), flush=True)
    except BaseException:
        if stopped:
            update.recovery_required = True
            if not write_started:
                try:
                    start_application(update)
                    start_writers(update)
                    update.recovery_required = False
                except BaseException:
                    pass
            if update.recovery_required:
                # A disconnected client cannot establish whether COMMIT happened.
                # Keep the writer name and the application closed for inspection.
                try:
                    update.closed_verified = close_for_recovery(app, update)
                finally:
                    save(folder / 'ORG-RECOVERY-REQUIRED.json', {'database_restored': False,
                        'services_stopped': getattr(update, 'closed_verified', False),
                        'production_write_attempted': write_started,
                        'mutator_container': getattr(update, 'org_mutator_name', None),
                        'instruction': 'Inspect writer state and database-before/after. Do not restore a dump or clear the lock blindly.'})
        raise


def execute(args):
    os.umask(0o077)
    args.stack = Path(args.stack).resolve(strict=True)
    lock = args.stack / '.offline-update-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('Another/interrupted update or repair owns the lock; inspect owner.json and wait for completion')
    owner = {'pid': os.getpid(), 'mode': 'organization-data-repair-0111', 'phase': 'preflight',
             'started_at': datetime.now(timezone.utc).isoformat(), 'stack': str(args.stack)}
    update = None
    try:
        save(lock / 'owner.json', owner)
        app, update = make_update(args.stack, args.current_package)
        update.org_app = app
        update.require_current_schema()
        report = probe(update, 'plan')
        plan = report['plan']
        if not args.apply:
            target = args.output or Path('org-0111-plan-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6] + '.json')
            save(Path(target), report, exclusive=True)
            print('CHECK PASSED. Read-only plan: ' + str(Path(target).resolve()) +
                  '; existing nodes to move: ' + str(len(plan['changes'])) + '; missing intermediates: ' + str(len(plan['create'])), flush=True)
        elif not plan['create'] and not plan['changes']:
            print('ALREADY REPAIRED. No database changes or services stopped.', flush=True)
        else:
            folder = args.stack / 'backups' / 'org-repairs' / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
            owner['backup'] = str(folder)
            save(lock / 'owner.json', owner)
            apply_repair(app, update, plan, folder, owner, lock)
    finally:
        if update is not None and getattr(update, 'recovery_required', False):
            owner['phase'] = 'recovery-required'
            save(lock / 'owner.json', owner)
            status = 'Application is closed' if getattr(update, 'closed_verified', False) else 'Verify application service state'
            print('RECOVERY REQUIRED. ' + status + '; inspect ' + str(lock / 'owner.json'), file=sys.stderr)
        else:
            (lock / 'owner.json').unlink(missing_ok=True)
            lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', required=True, type=Path, help='Existing installation directory')
    parser.add_argument('--current-package', required=True, type=Path, help='Already uploaded October 16 application package')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='Read-only plan (default)')
    modes.add_argument('--apply', action='store_true', help='Backup, rehearse and apply the exact data repair')
    parser.add_argument('--output', type=Path, help='New plan JSON file for --check; never overwrite')
    args = parser.parse_args()
    try:
        execute(args)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
