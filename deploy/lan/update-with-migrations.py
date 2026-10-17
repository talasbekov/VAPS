#!/usr/bin/env python3
"""Reviewed schema transition for the complete 17 October application package."""
import argparse
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


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


app = module('update-app-only')
base = app.base
checks = module('schema-transition-checks')
CHECK_SOURCE = (HERE / 'schema-transition-checks.py').read_text(encoding='utf-8')
BOOTSTRAP = '''import json,sys,django
payload=json.load(sys.stdin)
django.setup()
from django.db import connection,transaction
exec(payload['source'],globals())
if payload['action']=='capture':
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            cursor.execute('SHOW transaction_read_only')
            assert cursor.fetchone()[0]=='on', 'Read-only probe required'
        value=capture(payload.get('spec'))
else:
    value=migrate_atomic(payload['before'],payload.get('schema'))
print(json.dumps(value,sort_keys=True))
'''
UPLOADS = '''import hashlib,json
from pathlib import Path
result={}
for name in ('media','private'):
    folder=Path('/data')/name
    rows=[]
    for path in sorted(folder.rglob('*')):
        assert not path.is_symlink(), 'Unexpected upload symlink'
        if path.is_file():
            digest=hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda:stream.read(4*1024*1024),b''): digest.update(block)
            rows.append([path.relative_to(folder).as_posix(),path.stat().st_size,digest.hexdigest()])
    result[name]=rows
print(json.dumps(result,sort_keys=True))
'''


def run_json(command, action, *, before=None, schema=None, spec=None, env=None):
    # A real dump's schema can exceed Linux's per-argument limit. Pass evidence
    # through stdin, never in command arguments or console output.
    payload = {'source': CHECK_SOURCE, 'action': action, 'before': before, 'schema': schema, 'spec': spec}
    with tempfile.TemporaryFile() as stream:
        stream.write(json.dumps(payload).encode('utf-8'))
        stream.seek(0)
        return json.loads(base.run(command + ['-c', BOOTSTRAP], stdin=stream, env=env))


class TransitionUpdate(app.ApplicationUpdate):
    def load(self):
        if self.manifest.get('source_revision') != checks.SOURCE_REVISION or self.manifest.get('compatibility_overlay'):
            raise RuntimeError('This transition requires the reviewed 17 October application package')
        transition = json.loads((HERE / 'schema-transition.json').read_text(encoding='utf-8'))
        if (transition.get('source_revision') != checks.SOURCE_REVISION or
                transition.get('images') != self.manifest.get('images') or
                transition.get('plans') != [[list(item) for item in plan] for plan in checks.APPROVED_PLANS] or
                set(transition.get('files', {})) != {'update-with-migrations.py', 'schema-transition-checks.py'}):
            raise RuntimeError('Incomplete or mismatched schema patch')
        for name, digest in transition['files'].items():
            if base.sha(HERE / name) != digest:
                raise RuntimeError('Schema patch checksum mismatch: ' + name)
        required = {'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py',
                    'update-with-migrations.py', 'schema-transition-checks.py', 'schema-transition.json'}
        if not required.issubset(self.manifest.get('files', {})) or set(self.manifest.get('images', {})) != {'backend', 'frontend'}:
            raise RuntimeError('Complete application and reviewed transition package required')
        for name, digest in self.manifest['files'].items():
            path = HERE / name
            if path.parent != HERE or base.sha(path) != digest:
                raise RuntimeError('Application package checksum mismatch: ' + name)
        configs = base.exported_config_ids(HERE / 'application-images.tar', self.manifest['images'])
        try:
            for key, image in self.manifest['images'].items():
                base.verify_loaded_image(base.inspect(image['tag']), image, configs[key])
        except RuntimeError:
            super().load()
        else:
            print('Package verified; reviewed application images are already loaded.', flush=True)

    def require_transition(self):
        backend = self.services.get('backend', {})
        if backend.get('entrypoint') is not None or backend.get('command') is not None:
            raise RuntimeError('Custom backend startup requires review')
        plan = self.readonly(base.PLAN)
        checks.require_plan(plan)
        return plan

    def backend_json(self, action, **kwargs):
        readonly = action == 'capture'
        identity = [] if readonly else ['--name', self.live_migration_container,
                                       '--label', 'sj-schema-live=' + self.live_migration_container]
        command = self.base + ['run', '--rm', '--no-deps', '-T', '-i', *identity,
            '-e', 'PGOPTIONS=-c default_transaction_read_only=' + ('on' if readonly else 'off'),
            '--entrypoint', 'python', 'backend']
        return run_json(command, action, env={**os.environ, 'BACKEND_IMAGE': self.new_backend}, **kwargs)

    def database_snapshot(self):
        return self.backend_json('capture')

    def migrate_live(self, before, schema):
        return self.backend_json('migrate', before=before, schema=schema)

    def upload_snapshot(self):
        cid = base.run(self.base + ['ps', '-aq', 'backend']).strip()
        if not cid or '\n' in cid:
            raise RuntimeError('Expected one current backend container for upload verification')
        current = base.inspect(cid)
        base.validate_container_owner(current, self.stack, self.config['name'], 'backend')
        def uploads(container):
            return sorted((m['Destination'], m['Type'], m.get('Name'), m['Source'])
                          for m in container['Mounts'] if m['Destination'] in ('/data/media', '/data/private'))
        if uploads(current) != uploads(self.backend):
            raise RuntimeError('Upload volume mounts changed')
        return json.loads(base.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
            '--volumes-from', cid + ':ro', '--entrypoint', 'python', self.old_backend, '-c', UPLOADS]))

    def verify_database_identity(self):
        current = base.inspect(self.ids['db'])
        if current['Id'] != self.db['Id'] or current['Mounts'] != self.db['Mounts']:
            raise RuntimeError('Unexpected PostgreSQL container or volume change')

    def rehearse_transition(self, folder, before):
        marker = uuid.uuid4().hex
        name = 'sj-schema-check-' + marker
        volume = name + '-data'
        clone_env = {**os.environ, 'POSTGRES_DB': 'schema_check', 'POSTGRES_USER': 'schema_check',
            'POSTGRES_PASSWORD': secrets.token_urlsafe(32), 'POSTGRES_HOST': '127.0.0.1', 'POSTGRES_PORT': '5432',
            'DJANGO_SECRET_KEY': secrets.token_urlsafe(48), 'ALLOWED_HOSTS': 'localhost',
            'ENABLE_BACKGROUND_TASKS': '0', 'REDIS_HOST': '127.0.0.1', 'PGOPTIONS': '',
            'DJANGO_SETTINGS_MODULE': 'organization_management.config.settings.lan'}
        keys = ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT',
                'DJANGO_SECRET_KEY', 'ALLOWED_HOSTS', 'ENABLE_BACKGROUND_TASKS', 'REDIS_HOST', 'PGOPTIONS', 'DJANGO_SETTINGS_MODULE')
        env_args = [arg for key in keys for arg in ('-e', key)]
        py = ['docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'container:' + name,
              *env_args, '--entrypoint', 'python', self.new_backend]
        print('Restoring backup and rehearsing the reviewed migration plan in isolated PostgreSQL...', flush=True)
        base.run(['docker', 'volume', 'create', '--label', 'sj-schema-check=' + marker, volume])
        try:
            info = json.loads(base.run(['docker', 'volume', 'inspect', volume]))[0]
            if (info.get('Labels') or {}).get('sj-schema-check') != marker:
                raise RuntimeError('Temporary volume ownership mismatch')
            base.run(['docker', 'run', '-d', '--pull', 'never', '--name', name, '--network', 'none',
                '--label', 'sj-schema-check=' + marker, *env_args,
                '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data', self.database_image], env=clone_env)
            for _ in range(60):
                try:
                    base.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'schema_check', '-d', 'schema_check'])
                    break
                except RuntimeError:
                    time.sleep(1)
            else:
                raise RuntimeError('Isolated PostgreSQL did not start')
            with (folder / 'database.dump').open('rb') as stream:
                base.run(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'schema_check', '-d', 'schema_check',
                    '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], stdin=stream)
            restored = run_json(py, 'capture', env={**clone_env, 'PGOPTIONS': '-c default_transaction_read_only=on'})
            if restored != before:
                raise RuntimeError('Restored backup does not match the paused database')
            base.save_json(folder / 'restored-before.json', restored)
            after = run_json(py, 'migrate', before=restored, env=clone_env)
            base.save_json(folder / 'rehearsal-after.json', after)
            print('Backup restored; reviewed migrations passed; all original rows and business sequences preserved.', flush=True)
            return after
        finally:
            found = base.run(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip()
            if found and (base.inspect(found)['Config'].get('Labels') or {}).get('sj-schema-check') == marker:
                base.run(['docker', 'rm', '-f', found])
            info = json.loads(base.run(['docker', 'volume', 'inspect', volume]))[0]
            if (info.get('Labels') or {}).get('sj-schema-check') == marker:
                base.run(['docker', 'volume', 'rm', volume])

    def apply_transition(self, folder):
        self.recovery_required = False
        plan = self.require_transition()
        if not plan:
            return self.apply_without_database_changes(folder)
        self.check_space(folder)
        new_backend = self.wrap_image(self.new_backend)
        rollback_backend = self.wrap_image(self.old_backend)
        old_images = (self.stack / 'images.env').read_bytes()
        stopped, committed, migration_attempted = False, False, False
        before = uploads = None
        try:
            stopped = True
            print('Stopping application and schedulers; PostgreSQL and Redis remain running.', flush=True)
            base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', *self.schedulers])
            base.run(self.base + ['stop', '-t', '600', 'worker'])
            worker = base.inspect(self.ids['worker'])['State']
            if worker.get('OOMKilled') or worker.get('ExitCode') == 137:
                raise RuntimeError('Worker did not drain cleanly')
            before, uploads = self.database_snapshot(), self.upload_snapshot()
            self.backup(folder, uploads=True)
            base.save_json(folder / 'database-before.json', before)
            base.save_json(folder / 'uploads-before.json', uploads)
            if self.require_transition() != plan:
                raise RuntimeError('Migration plan changed during maintenance')
            rehearsal = self.rehearse_transition(folder, before)
            if self.database_snapshot() != before or self.upload_snapshot() != uploads:
                raise RuntimeError('Data changed during maintenance; inspect external writers')
            self.verify_database_identity()
            print('Applying the rehearsed ' + str(len(plan)) + ' migrations in one guarded PostgreSQL transaction...', flush=True)
            self.live_migration_container = 'sj-schema-live-' + uuid.uuid4().hex
            base.save_json(folder / 'live-migration.json', {'container': self.live_migration_container,
                'label': 'sj-schema-live=' + self.live_migration_container})
            migration_attempted = True
            migrated = self.migrate_live(before, rehearsal['schema'])
            committed = True
            base.save_json(folder / 'database-after-migrations.json', migrated)
            self.set_images(new_backend, self.new_frontend)
            self.start_application()
            after = self.database_snapshot()
            base.save_json(folder / 'database-after-startup.json', after)
            if after != migrated or self.upload_snapshot() != uploads:
                raise RuntimeError('Application startup changed data or uploads before reopening ingress')
            self.verify_database_identity()
            self.start_writers()
            base.save_json(folder / 'SUCCESS.json', {
                'mode': 'reviewed-schema-transition', 'source_revision': checks.SOURCE_REVISION,
                'migrations_executed': plan, 'backup_restored_and_migrated': True,
                'all_original_rows_and_columns_preserved': True, 'business_sequences_preserved': True,
                'schema_matches_rehearsal': True, 'uploads_unchanged': True,
                'database_container_unchanged': True, 'database_volume': self.volume,
                'verified_before_resuming_background_jobs': True,
                'backend_image': new_backend, 'frontend_image': self.new_frontend})
            print('UPDATE PASSED. All ' + str(len(plan)) + ' migrations applied; original data and uploads preserved. Backup: ' + str(folder), flush=True)
        except BaseException:
            if stopped:
                self.recovery_required = True
                stop_confirmed = False
                try:
                    base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                    stop_confirmed = True
                    self.verify_database_identity()
                    # Never reverse a committed schema or restore over the working DB.
                    # Even a rolled-back PostgreSQL transaction can advance sequences.
                    if migration_attempted or committed or (before is not None and self.database_snapshot() != before) or (
                            uploads is not None and self.upload_snapshot() != uploads):
                        raise RuntimeError('Recovery review required; data retained, application remains closed')
                    (self.stack / 'images.env').write_bytes(old_images)
                    self.set_images(rollback_backend, self.old_frontend)
                    self.start_application()
                    if before is not None and self.database_snapshot() != before:
                        raise RuntimeError('Original application startup changed data')
                    self.start_writers()
                    self.recovery_required = False
                    if folder.exists():
                        base.save_json(folder / 'ROLLED_BACK.json', {'schema_transition_committed': False,
                            'database_restored': False, 'original_application_resumed': True})
                finally:
                    if self.recovery_required:
                        stop_confirmed = False
                        try:
                            base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                            stop_confirmed = True
                        finally:
                            if folder.exists():
                                base.save_json(folder / 'RECOVERY_REQUIRED.json', {'application_stopped': stop_confirmed,
                                    'transition_commit_confirmed': committed, 'migration_attempted': migration_attempted,
                                    'live_migration_container': getattr(self, 'live_migration_container', None), 'database_restored': False,
                                    'instruction': 'Keep ingress closed; preserve backup and lock. No automatic database restore or backward migration.'})
            raise


def execute(args):
    os.umask(0o077)
    args.stack = Path(args.stack or app.locate_stack()).resolve()
    lock = args.stack / '.offline-update-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('Another or interrupted update owns .offline-update-lock; inspect owner.json')
    update = None
    owner = {'pid': os.getpid(), 'phase': 'schema-preflight', 'mode': 'reviewed-schema-transition',
             'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'stack': str(args.stack)}
    try:
        base.save_json(lock / 'owner.json', owner)
        update = TransitionUpdate(args)
        if base.run(['docker', 'info', '--format', '{{.OSType}}/{{.Architecture}}']).strip() not in ('linux/amd64', 'linux/x86_64'):
            raise RuntimeError('Linux amd64 Docker engine required')
        update.load()
        plan = update.require_transition()
        if not args.apply:
            print('SCHEMA CHECK PASSED. Reviewed migrations: ' + str(len(plan)) + '. No services stopped; database unchanged.', flush=True)
            return
        root = Path(args.backup_root or args.stack / 'backups/updates').resolve()
        folder = root / ('schema-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
        owner.update(phase='schema-updating', backup=str(folder))
        base.save_json(lock / 'owner.json', owner)
        update.apply_transition(folder)
    finally:
        if update is not None and getattr(update, 'recovery_required', False):
            owner['phase'] = 'recovery-required'
            base.save_json(lock / 'owner.json', owner)
            print('RECOVERY REQUIRED. Preserve backup and lock: ' + str(lock / 'owner.json'), file=sys.stderr)
        else:
            (lock / 'owner.json').unlink(missing_ok=True)
            lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Read-only plan check (default)')
    mode.add_argument('--apply', action='store_true', help='Backup, rehearse, migrate and update application in maintenance')
    parser.add_argument('--backup-root', type=Path)
    args = parser.parse_args()
    try:
        execute(args)
    except (RuntimeError, OSError, ValueError, KeyboardInterrupt, subprocess.SubprocessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
