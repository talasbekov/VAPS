#!/usr/bin/env python3
"""Update LAN application images without running migrations or writing to PostgreSQL."""
import importlib.util
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import tempfile

PACKAGE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('lan_update', PACKAGE / 'update-offline.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

# The image retains its original command. Only the startup entrypoint changes;
# workers have their own Celery entrypoint in compose.
ENTRYPOINT = '''#!/bin/sh
set -eu
: "${DJANGO_SECRET_KEY:?Set DJANGO_SECRET_KEY}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"
mkdir -p /data/static /data/media /data/private /var/log/django
PGOPTIONS="-c default_transaction_read_only=on" python manage.py collectstatic --noinput
exec "$@"
'''
READ_ONLY = '''
from django.db import connection
with connection.cursor() as read_only_cursor:
    read_only_cursor.execute('SHOW transaction_read_only')
    assert read_only_cursor.fetchone()[0] == 'on', 'Read-only database session required'
'''
PROXY_FILES = ('find /etc/nginx /docker-entrypoint.d /docker-entrypoint.sh '
               '/usr/local/bin/contour-proxy-entrypoint /usr/local/lib/nginx-error-filter.awk '
               '-type f -exec sha256sum {} \\;')
FULL_FINGERPRINT = base.FINGERPRINT.replace(
    "skip={'django_migrations','ops_permissions','ops_role_permissions'}", 'skip=set()'
).replace('if col in added.get(table,set()) or [table,col] in extra_ignored:', 'if False:').replace(
    'print(json.dumps(result,sort_keys=True))', '''
    c.execute("SELECT table_name,column_name,udt_name,is_nullable,character_maximum_length,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")
    result['__schema__'] = c.fetchall()
    c.execute("SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")
    result['__sequences__'] = c.fetchall()
print(json.dumps(result,sort_keys=True))
''')


def locate_stack():
    containers = base.run(['docker', 'ps', '--filter', 'label=com.docker.compose.service=backend', '--format', '{{.ID}}']).split()
    candidates = set()
    for cid in containers:
        labels = base.inspect(cid)['Config'].get('Labels') or {}
        files = labels.get('com.docker.compose.project.config_files', '').split(',')
        if len(files) != 1 or not files[0]:
            continue
        path = Path(files[0])
        if not path.is_absolute():
            path = Path(labels.get('com.docker.compose.project.working_dir', '')) / path
        folder = path.resolve().parent
        if path.name == 'docker-compose.yml' and all((folder / name).is_file() for name in ('.env', 'images.env', 'docker-compose.yml')):
            candidates.add(folder)
    if len(candidates) != 1:
        raise RuntimeError('Cannot select one running LAN stack; supply --stack /path/to/existing/installation')
    return candidates.pop()


class ApplicationUpdate(base.Update):
    def load(self):
        required = {'application-images.tar', 'update.py', 'update-app-only.py', 'update-offline.py'}
        if not required.issubset(self.manifest.get('files', {})) or set(self.manifest.get('images', {})) not in (
                {'backend', 'frontend'}, {'backend', 'frontend', 'proxy'}):
            raise RuntimeError('Incomplete release manifest; use the complete new update package')
        super().load()
        if 'proxy' in self.manifest['images']:
            self.verify_proxy_configuration()

    def verify_proxy_configuration(self):
        """Hash configured nginx/startup files without starting nginx or publishing ports."""
        base.validate_proxy_layout(self.services['proxy'])
        expected = base.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
            '--read-only', '--entrypoint', 'sh', self.new_proxy, '-ec', PROXY_FILES])
        actual = base.run(self.base + ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh',
            'proxy', '-ec', PROXY_FILES], env={**os.environ, 'PROXY_IMAGE': self.new_proxy})
        expected, actual = sorted(expected.splitlines()), sorted(actual.splitlines())
        if not expected or expected != actual:
            raise RuntimeError('Configured proxy configuration differs from the reviewed image; no services stopped')
        self.proxy_configuration_sha256 = base.hashlib.sha256('\n'.join(expected).encode('utf-8')).hexdigest()
        print('Reviewed proxy configuration verified: ' + self.proxy_configuration_sha256, flush=True)

    def check_space(self, folder):
        """Conservative capacity check before downtime or the temporary restore."""
        size = int(base.run(['docker', 'exec', self.ids['db'], 'sh', '-c',
            'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database())"']).strip())
        uploads = base.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
            '--volumes-from', self.ids['backend'] + ':ro', '--entrypoint', 'du', self.old_backend,
            '-sk', '/data/media', '/data/private', '/data/static'])
        upload_bytes = sum(int(line.split()[0]) * 1024 for line in uploads.splitlines())
        disk = base.run(['docker', 'exec', self.ids['db'], 'df', '-Pk', '/var/lib/postgresql/data'])
        docker_free = int(disk.splitlines()[-1].split()[3]) * 1024
        existing = folder.resolve()
        while not existing.exists():
            existing = existing.parent
        host_free = shutil.disk_usage(existing).free
        reserve = 512 * 1024 * 1024
        backup_need = size + upload_bytes + reserve
        # Docker and backups can share physical storage; reserve both requirements.
        docker_need = 3 * size + backup_need + reserve
        if host_free < backup_need or docker_free < docker_need:
            raise RuntimeError('Insufficient space for backup and isolated restore; no services stopped. '
                f'Backup needs at least {backup_need // (1024*1024)} MiB, Docker {docker_need // (1024*1024)} MiB.')

    def readonly(self, code, image=None):
        checked = code.replace('django.setup()', 'django.setup()\n' + READ_ONLY, 1)
        command = self.base + ['run', '--rm', '--no-deps', '-T',
            '-e', 'PGOPTIONS=-c default_transaction_read_only=on', '--entrypoint', 'python', 'backend', '-c', checked]
        return json.loads(base.run(command, env={**os.environ, 'BACKEND_IMAGE': image or self.new_backend}))

    def require_current_schema(self):
        backend = self.services.get('backend', {})
        if backend.get('entrypoint') is not None or backend.get('command') is not None:
            raise RuntimeError('Custom backend startup requires review; cannot guarantee migration-free startup')
        plan = self.readonly(base.PLAN)
        if plan:
            raise RuntimeError('Application-only update refused: schema migrations are required: ' + str(plan) +
                               '. No services stopped and no database changes made by this check.')
        return plan

    def wrap_image(self, image):
        info = base.inspect(image)
        label = 'smart-josparlau.app-only-entrypoint'
        digest = base.hashlib.sha256(ENTRYPOINT.encode('utf-8')).hexdigest()
        if not info['Config'].get('Cmd'):
            raise RuntimeError('Backend command is missing')
        if (info['Config'].get('Labels') or {}).get(label) == digest:
            if info['Config'].get('Entrypoint') != ['/bin/sh', '/sj-app-only-entrypoint.sh']:
                raise RuntimeError('Unexpected application-only entrypoint')
            return info['Id']
        if info['Config'].get('Entrypoint') != ['/entrypoint.sh']:
            raise RuntimeError('Unknown backend startup entrypoint; application-only update refused')
        tag = 'smart-josparlau/app-only:' + info['Id'].removeprefix('sha256:')[:20] + '-v1'
        def validate_wrapper(built):
            layers = info['RootFS']['Layers']
            if (built['RootFS']['Layers'][:len(layers)] != layers or
                    built['Config'].get('Cmd') != info['Config']['Cmd'] or
                    built['Config'].get('Entrypoint') != ['/bin/sh', '/sj-app-only-entrypoint.sh'] or
                    (built['Config'].get('Labels') or {}).get(label) != digest or
                    built['Os'] != 'linux' or built['Architecture'] != 'amd64'):
                raise RuntimeError('Application-only image verification failed; existing wrapper tag was not replaced')
            return built['Id']
        try:
            cached = base.inspect(tag)
        except RuntimeError:
            cached = None
        if cached is not None:
            # Rebuilding this deterministic tag can strand the running container's
            # old OCI image. Reuse verified content and persist an immutable ID.
            return validate_wrapper(cached)
        source_tag = 'smart-josparlau/app-only-source:' + info['Id'].removeprefix('sha256:')[:20]
        base.run(['docker', 'tag', info['Id'], source_tag])
        with tempfile.TemporaryDirectory(prefix='sj-app-only-') as directory:
            folder = Path(directory)
            (folder / 'entrypoint.sh').write_bytes(ENTRYPOINT.encode('utf-8'))
            (folder / 'Dockerfile').write_text(
                'FROM ' + source_tag + '\nCOPY entrypoint.sh /sj-app-only-entrypoint.sh\n' +
                'LABEL ' + label + '="' + digest + '"\n' +
                'ENTRYPOINT ["/bin/sh", "/sj-app-only-entrypoint.sh"]\n' +
                'CMD ' + json.dumps(info['Config']['Cmd']) + '\n', encoding='utf-8')
            base.run(['docker', 'build', '--pull=false', '--network=none', '-t', tag, str(folder)])
        built = base.inspect(tag)
        return validate_wrapper(built)

    def set_images(self, backend, frontend, proxy=None):
        path = self.stack / 'images.env'
        lines = path.read_text(encoding='utf-8-sig').splitlines()
        replacements = [('BACKEND_IMAGE', backend), ('FRONTEND_IMAGE', frontend)]
        if proxy is not None:
            replacements.append(('PROXY_IMAGE', proxy))
        for key, value in replacements:
            lines = [line for line in lines if line.split('=', 1)[0].strip() != key]
            lines.append(key + '=' + value)
        temporary = self.stack / 'images.env.app-only-tmp'
        temporary.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        os.replace(temporary, path)

    def start_application(self):
        # Verify database contents before starting background jobs or ingress.
        base.run(self.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
            '--wait', '--wait-timeout', '300', 'backend', 'frontend'], capture=False)

    def start_writers(self):
        base.run(self.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
            '--wait', '--wait-timeout', '180', 'worker', *self.schedulers], capture=False)
        base.run(self.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
            '--wait', '--wait-timeout', '180', 'proxy'], capture=False)

    def apply_without_database_changes(self, folder):
        self.recovery_required = False
        self.require_current_schema()
        self.check_space(folder)
        new_backend = self.wrap_image(self.new_backend)
        rollback_backend = self.wrap_image(self.old_backend)
        old_images = (self.stack / 'images.env').read_bytes()
        old_frontend = self.old_frontend
        stopped = False
        before = None
        database_uncertain = False
        try:
            stopped = True
            print('Stopping application; PostgreSQL and Redis remain running. No migrations will run.', flush=True)
            base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', *self.schedulers])
            base.run(self.base + ['stop', '-t', '600', 'worker'])
            worker = base.inspect(self.ids['worker'])['State']
            if worker.get('OOMKilled') or worker.get('ExitCode') == 137:
                raise RuntimeError('Worker did not drain cleanly; update refused')
            self.backup(folder, uploads=True)
            self.require_current_schema()
            before = self.readonly(FULL_FINGERPRINT)
            base.save_json(folder / 'database-before.json', before)
            restored = self.clone_check(folder, no_migrations=True, fingerprint=FULL_FINGERPRINT)
            if restored != before:
                database_uncertain = True
                raise RuntimeError('Restored backup differs from paused database; inspect external writers')
            self.set_images(new_backend, self.new_frontend, self.new_proxy)
            self.start_application()
            after = self.readonly(FULL_FINGERPRINT)
            base.save_json(folder / 'database-after.json', after)
            if before != after:
                database_uncertain = True
                raise RuntimeError('Database contents/schema/sequences changed during update; inspect external writers')
            current = base.inspect(self.ids['db'])
            if current['Id'] != self.db['Id'] or current['Mounts'] != self.db['Mounts']:
                database_uncertain = True
                raise RuntimeError('Unexpected PostgreSQL container or volume change')
            self.start_writers()
            base.save_json(folder / 'SUCCESS.json', {
                'mode': 'application-only', 'migrations_executed': False,
                'all_database_tables_schema_and_sequences_match': True,
                'database_container_unchanged': True, 'database_volume': self.volume,
                'backend_image': new_backend, 'frontend_image': self.new_frontend,
                'proxy_image': self.new_proxy,
                'proxy_configuration_sha256': self.proxy_configuration_sha256,
                'verified_before_resuming_background_jobs': True,
                'backup_restored_and_compared': True,
            })
            print('UPDATE PASSED. Database unchanged by updater. Backup: ' + str(folder), flush=True)
        except BaseException:
            if stopped:
                self.recovery_required = True
                try:
                    base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                    # A failed startup can write too. Never reopen ingress on uncertain data.
                    if database_uncertain or (before is not None and self.readonly(FULL_FINGERPRINT) != before):
                        raise RuntimeError('Database verification failed; application remains stopped for recovery review')
                    current = base.inspect(self.ids['db'])
                    if current.get('Id') != self.db['Id'] or current.get('Mounts') != self.db['Mounts']:
                        raise RuntimeError('Database identity changed; application remains stopped')
                    print('Restoring previous application images without database migration/restore.', flush=True)
                    (self.stack / 'images.env').write_bytes(old_images)
                    self.set_images(rollback_backend, old_frontend, self.old_proxy)
                    self.start_application()
                    if before is not None and self.readonly(FULL_FINGERPRINT, image=rollback_backend) != before:
                        raise RuntimeError('Database changed during rollback startup; keep application stopped')
                    self.start_writers()
                    self.recovery_required = False
                    if folder.exists():
                        base.save_json(folder / 'ROLLED_BACK.json', {'database_restored': False,
                            'backend_image': rollback_backend, 'frontend_image': old_frontend,
                            'proxy_image': self.old_proxy})
                finally:
                    if self.recovery_required:
                        stop_confirmed = False
                        try:
                            base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                            stop_confirmed = True
                        finally:
                            if folder.exists():
                                base.save_json(folder / 'RECOVERY_REQUIRED.json', {
                                    'application_stopped': stop_confirmed, 'database_restored': False,
                                    'instruction': 'Verify ingress is closed. Review database-before/after and backup. Do not auto-restore or clear the update lock.',
                                    'backend_image': rollback_backend, 'frontend_image': old_frontend})
            raise


def main():
    # Preserve old command names while all operators use the same locked entrypoint.
    runpy.run_path(str(PACKAGE / 'update.py'), run_name='__main__')


if __name__ == '__main__':
    main()
