#!/usr/bin/env python3
"""Offline application update for the existing LAN compose stack (Python 3.9+)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

PACKAGE = Path(__file__).resolve().parent
ALLOWED = {
    ('operations', '0127_dictionary_value_manage_permission'),
    ('operations', '0128_dictionary_entry_label_kk'),
    ('operations', '0129_dictionary_manage_permission_name'),
    ('operations', '0130_dictionary_entry_lifecycle'),
    ('operations', '0131_geo_dictionary_lifecycle'),
    ('dictionaries', '0004_position_rank_name_kk'),
    ('dictionaries', '0005_position_rank_lifecycle'),
    ('employees', '0005_employee_import_identity'),
    ('employees', '0006_iin_format_validation'),
    ('staff_unit', '0002_staffunit_import_fields'),
}
PLAN = '''
import django,json
django.setup()
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
ex=MigrationExecutor(connection)
ex.loader.check_consistent_history(connection)
unknown=set(ex.loader.applied_migrations)-set(ex.loader.disk_migrations)
archived={('common','0002_access_matrix_roles'),('operations','0112_visit_object_and_security_object_photo_fields')}
assert not (unknown-archived), 'Database has migrations absent from the update: '+str(sorted(unknown-archived))
applied=set(ex.loader.applied_migrations)
with connection.cursor() as c:
    c.execute("SELECT table_name,column_name,udt_name,is_nullable,character_maximum_length FROM information_schema.columns WHERE table_schema='public'")
    columns={(t,n):(typ,nullable,length) for t,n,typ,nullable,length in c.fetchall()}
    def require_column(table,name,expected):
        assert columns.get((table,name))==expected, 'Unexpected production column: '+table+'.'+name
    if ('common','0002_access_matrix_roles') in unknown:
        assert ('common','0003_remove_rolepermission_permission_and_more') in applied, 'Legacy roles have not been migrated'
        assert not ({'roles','permissions','user_roles','role_permissions'} & {t for t,n in columns}), 'Unexpected legacy role tables still exist'
    if ('operations','0112_visit_object_and_security_object_photo_fields') in unknown:
        assert ('operations','0113_visit_object_and_security_object_photo_fields') in applied, 'Canonical photo migration is absent'
        require_column('ops_security_objects','photo',('varchar','YES',100))
        require_column('ops_security_event_visit_objects','description',('varchar','NO',255))
    if ('employees','0005_employee_import_identity') in applied:
        require_column('employees','external_id',('varchar','YES',100))
        for name in ('birth_date','hire_date'): require_column('employees',name,('date','YES',None))
        require_column('employees','gender',('varchar','YES',1))
    if ('staff_unit','0002_staffunit_import_fields') in applied:
        require_column('staff_units','external_id',('varchar','YES',100))
        require_column('staff_units','import_order',('int4','YES',None))
        require_column('staff_units','position_category',('varchar','NO',100))
    for app,migration,table in [('employees','0005_employee_import_identity','employees'),('staff_unit','0002_staffunit_import_fields','staff_units')]:
        if (app,migration) in applied:
            constraints=connection.introspection.get_constraints(c,table)
            assert any(v['unique'] and v['columns']==['external_id'] for v in constraints.values()), 'Missing unique import identifier on '+table
plan=ex.migration_plan(ex.loader.graph.leaf_nodes())
assert not any(back for _,back in plan), 'Backward migration refused'
print(json.dumps([[m.app_label,m.name] for m,_ in plan]))
'''
FINGERPRINT = '''
import django,json,hashlib
django.setup()
from django.db import connection
from django.apps import apps
result={}
extra_ignored=[]
skip={'django_migrations','ops_permissions','ops_role_permissions'}
added={}
for app,model,fields in [
    ('dictionaries','Position',{'name_kk','is_active','inactive_since','supersedes_id'}),
    ('dictionaries','Rank',{'name_kk','is_active','inactive_since','supersedes_id'}),
    ('operations','OpsDictionaryEntry',{'label_kk','inactive_since','supersedes_id'}),
    ('operations','OpsCountry',{'name_kk','inactive_since','supersedes_id'}),
    ('operations','OpsCity',{'name_kk','inactive_since','supersedes_id'}),
]: added[apps.get_model(app,model)._meta.db_table]=fields
with connection.cursor() as c:
    c.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")
    cols={}
    for table,col in c.fetchall():
        # Only columns present before this release: additive migration fields are ignored.
        if col in added.get(table,set()) or [table,col] in extra_ignored:
            continue
        cols.setdefault(table,[]).append(col)
    for table,columns in sorted(cols.items()):
        if table in skip: continue
        fields=','.join(connection.ops.quote_name(v) for v in columns)
        c.execute('SELECT md5(ROW('+fields+')::text) FROM '+connection.ops.quote_name(table)+' ORDER BY 1')
        digest=hashlib.sha256(); count=0
        while True:
            batch=c.fetchmany(2000)
            if not batch: break
            for (value,) in batch:
                digest.update(value.encode('ascii')); count+=1
        result[table]={'rows':count,'sha256':digest.hexdigest()}
print(json.dumps(result,sort_keys=True))
'''


def run(args, *, capture=True, stdin=None, stdout=None, env=None):
    result = subprocess.run(args, stdin=stdin, stdout=stdout or subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env)
    if result.returncode:
        # Arguments/config may contain credentials; do not echo them.
        error = result.stderr.decode('utf-8', errors='replace')
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {error[-5000:]}')
    output = (result.stdout or b'').decode('utf-8', errors='replace') if stdout is None else ''
    if not capture and output:
        print(output, flush=True)
    return output


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)


def inspect(container):
    return json.loads(run(['docker', 'inspect', container]))[0]


def running_image_id(container):
    """Map containerd's config digest to a runnable immutable image without starting it."""
    try:
        image = json.loads(run(['docker', 'image', 'inspect', container['Image']]))[0]
    except RuntimeError:
        image = json.loads(run(['docker', 'image', 'inspect', container['Config']['Image']]))[0]
    identity = image['Id']
    if identity == container['Image']:
        return identity
    marker = uuid.uuid4().hex
    probe = run(['docker', 'create', '--pull', 'never', '--network', 'none', '--read-only',
        '--label', 'sj-image-probe=' + marker, '--name', 'sj-image-probe-' + marker,
        '--entrypoint', '/bin/true', identity]).strip()
    try:
        if inspect(probe)['Image'] != container['Image']:
            raise RuntimeError('Running image differs from its current tag; update refused before service stop')
        return identity
    finally:
        if (inspect(probe)['Config'].get('Labels') or {}).get('sj-image-probe') == marker:
            run(['docker', 'rm', '-v', probe])


def validate_container_owner(container, stack, project, service):
    """A copied compose folder with the same project name is not the running stack."""
    labels = container['Config'].get('Labels') or {}
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    working = labels.get('com.docker.compose.project.working_dir')
    if (labels.get('com.docker.compose.project') != project or
            labels.get('com.docker.compose.service') != service or not working or
            Path(working).resolve() != stack.resolve() or len(files) != 1 or
            Path(files[0]).resolve() != (stack / 'docker-compose.yml').resolve()):
        raise RuntimeError('Running container belongs to a different compose directory/project: ' + service)


def validate_proxy_layout(service):
    """A preserved override must not mask the reviewed proxy protection files."""
    if any(service.get(key) is not None for key in ('entrypoint', 'command')):
        raise RuntimeError('Custom proxy startup requires review before updating')
    if any(service.get(key) for key in ('configs', 'secrets', 'tmpfs', 'volumes_from')):
        raise RuntimeError('Custom proxy configuration mounts require review before updating')
    if set(service.get('environment') or {}) - {'TZ'}:
        raise RuntimeError('Custom proxy environment can change reviewed startup/configuration; review required')
    expected = {'/data/static', '/data/media', '/data/private'}
    volumes = service.get('volumes') or []
    if (len(volumes) != len(expected) or {item.get('target') for item in volumes} != expected
            or any(item.get('type') != 'volume' or not item.get('source') or item.get('read_only') is not True
                   for item in volumes)):
        raise RuntimeError('Unsupported proxy mounts; only the three named read-only data volumes are reviewed')


def fingerprint_code(plan):
    ignored = []
    if ['employees', '0005_employee_import_identity'] in plan:
        ignored.append(['employees', 'external_id'])
    if ['staff_unit', '0002_staffunit_import_fields'] in plan:
        ignored.extend([['staff_units', name] for name in ('external_id', 'import_order', 'position_category')])
    return FINGERPRINT.replace('extra_ignored=[]', 'extra_ignored=' + repr(ignored))


def exported_config_ids(archive_path, images):
    """Classic Docker uses the config digest; containerd may expose the OCI index digest."""
    result = {}
    with tarfile.open(archive_path, 'r') as archive:
        manifests = json.load(archive.extractfile('manifest.json'))
        for service, item in images.items():
            matching = [entry for entry in manifests if item['tag'] in (entry.get('RepoTags') or [])]
            if len(matching) != 1:
                raise RuntimeError(f'Missing or duplicate image in export: {item["tag"]}')
            config_path = matching[0]['Config']
            config_bytes = archive.extractfile(config_path).read()
            config_id = hashlib.sha256(config_bytes).hexdigest()
            if Path(config_path).name.removesuffix('.json') != config_id:
                raise RuntimeError('Image configuration checksum mismatch')
            config = json.loads(config_bytes)
            if config.get('architecture') != 'amd64' or config.get('os') != 'linux':
                raise RuntimeError('Exported image is not linux/amd64')
            result[service] = 'sha256:' + config_id
    return result


def verify_loaded_image(info, item, config_id):
    if info['Id'] not in (item['id'], config_id) or info['Architecture'] != 'amd64' or info['Os'] != 'linux':
        raise RuntimeError(f'Image verification failed for {item["tag"]}: '
                           f'got {info["Id"]} {info["Os"]}/{info["Architecture"]}')


class Update:
    def __init__(self, args):
        self.args = args
        self.stack = Path(args.stack).resolve()
        self.manifest = json.loads((PACKAGE / 'release.json').read_text(encoding='utf-8'))
        for name in ('.env', 'images.env', 'docker-compose.yml'):
            if not (self.stack / name).is_file():
                raise RuntimeError(f'Missing existing stack file: {name}')
        for key in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'BACKEND_IMAGE', 'FRONTEND_IMAGE', 'PROXY_IMAGE'):
            if os.getenv(key):
                raise RuntimeError(f'Unset shell override {key} before running the update')
        for line in (self.stack / '.env').read_text(encoding='utf-8-sig').splitlines():
            if line.split('=', 1)[0].strip() in ('BACKEND_IMAGE', 'FRONTEND_IMAGE', 'PROXY_IMAGE'):
                raise RuntimeError('Application image overrides in .env require manual review')
        self.base = ['docker', 'compose', '--project-directory', str(self.stack),
                     '--env-file', str(self.stack / 'images.env'), '--env-file', str(self.stack / '.env'),
                     '-f', str(self.stack / 'docker-compose.yml')]
        self.config = json.loads(run(self.base + ['config', '--format', 'json']))
        self.services = self.config['services']
        required = {'db', 'redis', 'backend', 'worker', 'frontend', 'proxy'}
        if set(self.services) not in (required, required | {'beat'}):
            raise RuntimeError('Unsupported compose layout; expected the LAN services with optional separate beat')
        validate_proxy_layout(self.services['proxy'])
        self.proxy_configuration_sha256 = None
        self.schedulers = ['beat'] if 'beat' in self.services else []
        if self.schedulers:
            worker_command = self.services['worker'].get('command') or []
            if isinstance(worker_command, str):
                worker_command = shlex.split(worker_command)
            if any(arg in ('-B', '--beat') for arg in worker_command):
                raise RuntimeError('Both separate beat and embedded worker scheduler configured; review before updating')
        self.ids = {}
        for service in self.services:
            cid = run(self.base + ['ps', '-q', service]).strip()
            if not cid or '\n' in cid:
                raise RuntimeError(f'Expected one running container: {service}')
            validate_container_owner(inspect(cid), self.stack, self.config['name'], service)
            self.ids[service] = cid
        self.db = inspect(self.ids['db'])
        self.backend = inspect(self.ids['backend'])
        env = self.services['backend']['environment']
        if env.get('POSTGRES_HOST') != 'db' or str(env.get('POSTGRES_PORT', '5432')) != '5432':
            raise RuntimeError('Backend does not use this compose database')
        db_env = self.services['db']['environment']
        if any(env.get(k) != db_env.get(k) for k in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD')):
            raise RuntimeError('Backend and database credentials differ')
        for container in (self.backend, self.db):
            running_env = dict(value.split('=', 1) for value in container['Config']['Env'] if '=' in value)
            if any(running_env.get(k) != db_env.get(k) for k in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD')):
                raise RuntimeError('Configuration differs from the running database/application; review .env first')
        mounts = [m for m in self.db['Mounts'] if m['Destination'] == '/var/lib/postgresql/data']
        if len(mounts) != 1 or mounts[0]['Type'] != 'volume':
            raise RuntimeError('Expected the existing named PostgreSQL volume')
        self.volume = mounts[0]['Name']
        version = run(['docker', 'exec', self.ids['db'], 'postgres', '--version']).strip()
        if ' 16.' not in version:
            raise RuntimeError('This release is checked only with PostgreSQL 16')
        self.old_backend = running_image_id(self.backend)
        self.old_frontend = running_image_id(inspect(self.ids['frontend']))
        self.old_proxy = running_image_id(inspect(self.ids['proxy']))
        self.database_image = running_image_id(self.db)
        self.base_backend = self.manifest['images']['backend']['tag']
        self.new_backend = self.base_backend + '-imports-v1' if self.manifest.get('compatibility_overlay') else self.base_backend
        self.new_frontend = self.manifest['images']['frontend']['tag']
        self.new_proxy = self.manifest['images'].get('proxy', {}).get('tag', self.old_proxy)
        proposed = json.loads(run(self.base + ['config', '--format', 'json'], env={
            **os.environ, 'BACKEND_IMAGE': self.new_backend, 'FRONTEND_IMAGE': self.new_frontend,
            'PROXY_IMAGE': self.new_proxy,
        }))['services']
        for name in ['backend', 'worker', *self.schedulers]:
            if proposed[name]['image'] != self.new_backend:
                raise RuntimeError(f'{name} does not use BACKEND_IMAGE; configuration needs review')
        if proposed['frontend']['image'] != self.new_frontend:
            raise RuntimeError('frontend does not use FRONTEND_IMAGE; configuration needs review')
        if 'proxy' in self.manifest['images'] and proposed['proxy']['image'] != self.new_proxy:
            raise RuntimeError('proxy does not use PROXY_IMAGE; configuration needs review')
        for service in ('backend', 'worker', 'frontend', 'proxy', *self.schedulers):
            if self.services[service].get('pull_policy') != 'never':
                raise RuntimeError('Offline update requires pull_policy: never on ' + service)
        # Updating image references must leave every other service setting intact.
        for name, original in self.services.items():
            if {key: value for key, value in original.items() if key != 'image'} != {
                    key: value for key, value in proposed[name].items() if key != 'image'}:
                raise RuntimeError('Image selection changes existing service settings: ' + name)
            if name in ('db', 'redis') and original != proposed[name]:
                raise RuntimeError('Infrastructure configuration must remain unchanged: ' + name)
        print(f"Stack: {self.config['name']}; database volume: {self.volume}; {version}", flush=True)

    def load(self):
        print('Verifying package hashes...', flush=True)
        for name, expected in self.manifest['files'].items():
            path = PACKAGE / name
            if path.parent != PACKAGE or sha(path) != expected:
                raise RuntimeError(f'Package checksum mismatch: {name}')
        run(['docker', 'load', '-i', str(PACKAGE / 'application-images.tar')], capture=False)
        config_ids = exported_config_ids(PACKAGE / 'application-images.tar', self.manifest['images'])
        for service, item in self.manifest['images'].items():
            info = json.loads(run(['docker', 'image', 'inspect', item['tag']]))[0]
            verify_loaded_image(info, item, config_ids[service])
        if self.manifest.get('compatibility_overlay'):
            self.prepare_compatibility_image()

    def prepare_compatibility_image(self):
        """Add the reviewed model/migration files to the verified local image, offline."""
        payload = json.loads((PACKAGE / 'compat-files.json').read_text(encoding='utf-8'))
        allowed = {
            'employees/models.py', 'employees/migrations/0005_employee_import_identity.py',
            'staff_unit/models.py', 'staff_unit/migrations/0002_staffunit_import_fields.py',
            'core/api/service_employees.py',
            'statuses/services.py', 'statuses/models.py',
        }
        if set(payload) != allowed:
            raise RuntimeError('Unexpected compatibility payload paths')
        print('Preparing reviewed import-field compatibility layer (offline, no dependency installs)...', flush=True)
        with tempfile.TemporaryDirectory(prefix='sj-import-compat-') as temp:
            folder = Path(temp)
            instructions = ['FROM ' + self.base_backend]
            for index, (relative, content) in enumerate(sorted(payload.items())):
                name = f'payload-{index}.py'
                (folder / name).write_bytes(content.encode('utf-8'))
                instructions.append(f'COPY {name} /app/organization_management/apps/{relative}')
            (folder / 'Dockerfile').write_text('\n'.join(instructions) + '\n', encoding='utf-8')
            run(['docker', 'build', '--pull=false', '--network=none', '-t', self.new_backend, str(folder)])
        base = json.loads(run(['docker', 'image', 'inspect', self.base_backend]))[0]
        built = json.loads(run(['docker', 'image', 'inspect', self.new_backend]))[0]
        layers = base['RootFS']['Layers']
        if built['RootFS']['Layers'][:len(layers)] != layers or built['Architecture'] != 'amd64' or built['Os'] != 'linux':
            raise RuntimeError('Compatibility image does not retain the verified base layers')
        expected = {name: hashlib.sha256(content.encode('utf-8')).hexdigest() for name, content in payload.items()}
        verify = 'import hashlib,json; from pathlib import Path; expected=' + repr(expected) + '; assert all(hashlib.sha256((Path("/app/organization_management/apps")/p).read_bytes()).hexdigest()==h for p,h in expected.items())'
        run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'python', self.new_backend, '-c', verify])

    def backup(self, folder, *, uploads):
        print(f'Creating backup: {folder}', flush=True)
        folder.mkdir(mode=0o700, parents=True, exist_ok=False)
        for name in ('.env', 'images.env', 'docker-compose.yml'):
            shutil.copyfile(self.stack / name, folder / name)
            (folder / name).chmod(0o600)
        save_json(folder / 'before.json', {
            'project': self.config['name'], 'database_volume': self.volume,
            'containers': {s: {'id': cid, 'image': inspect(cid)['Image']} for s, cid in self.ids.items()},
        })
        with (folder / 'database.dump').open('wb') as output:
            run(['docker', 'exec', self.ids['db'], 'sh', '-c',
                 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl'], stdout=output)
        (folder / 'postgres-version.txt').write_text(
            run(['docker', 'exec', self.ids['db'], 'postgres', '--version']), encoding='utf-8')
        revision = self.stack / 'source-revision.txt'
        (folder / 'source-revision.txt').write_bytes(revision.read_bytes() if revision.exists() else b'pre-update deployment\n')
        if uploads:
            for name in ('media', 'private', 'static'):
                with (folder / f'{name}.tar.gz').open('wb') as output:
                    run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
                         '--volumes-from', self.ids['backend'] + ':ro', '--entrypoint', 'tar',
                         self.old_backend, '-czf', '-', '-C', '/data/' + name, '.'], stdout=output)
        files = {p.name: sha(p) for p in folder.iterdir() if p.is_file()}
        for path in folder.iterdir(): path.chmod(0o600)
        save_json(folder / 'checksums.json', files)
        (folder / 'sha256sums.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in files.items()), encoding='utf-8')

    def clone_check(self, folder, *, no_migrations=False, fingerprint=None):
        """Restore and migrate an isolated copy; no production networks or mounts."""
        marker = uuid.uuid4().hex
        name = 'sj-update-check-' + marker
        volume = name + '-data'
        clone_env = {**os.environ, 'POSTGRES_DB': 'update_check', 'POSTGRES_USER': 'update_check',
                     'POSTGRES_PASSWORD': secrets.token_urlsafe(32), 'POSTGRES_HOST': '127.0.0.1',
                     'POSTGRES_PORT': '5432', 'DJANGO_SECRET_KEY': secrets.token_urlsafe(48),
                     'ALLOWED_HOSTS': 'localhost', 'ENABLE_BACKGROUND_TASKS': '0',
                     'REDIS_HOST': '127.0.0.1', 'DJANGO_SETTINGS_MODULE': 'organization_management.config.settings.lan'}
        keys = ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT',
                'DJANGO_SECRET_KEY', 'ALLOWED_HOSTS', 'ENABLE_BACKGROUND_TASKS', 'REDIS_HOST', 'DJANGO_SETTINGS_MODULE')
        env_args = [arg for key in keys for arg in ('-e', key)]
        py = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'container:' + name,
              *env_args, '--entrypoint', 'python', self.new_backend]
        print('Restoring backup into an isolated PostgreSQL container...', flush=True)
        run(['docker', 'volume', 'create', '--label', 'sj-update-check=' + marker, volume])
        try:
            run(['docker', 'run', '-d', '--pull', 'never', '--name', name, '--network', 'none',
                 '--label', 'sj-update-check=' + marker, *env_args,
                 '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data',
                 self.database_image], env=clone_env)
            for _ in range(60):
                try:
                    # The image first starts a temporary socket-only server during initdb.
                    # TCP readiness waits for its final server, after that restart.
                    run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'update_check', '-d', 'update_check'])
                    break
                except RuntimeError: time.sleep(1)
            else: raise RuntimeError('Isolated PostgreSQL did not start')
            with (folder / 'database.dump').open('rb') as source:
                run(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'update_check', '-d', 'update_check',
                     '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], stdin=source)
            plan = json.loads(run(py + ['-c', PLAN], env=clone_env))
            if no_migrations and plan:
                raise RuntimeError('Restored backup needs migrations; application-only update refused')
            if any(tuple(item) not in ALLOWED for item in plan):
                raise RuntimeError('Unexpected pending migrations: ' + str(plan))
            save_json(folder / 'migration-plan.json', plan)
            fingerprint = fingerprint or fingerprint_code(plan)
            before = json.loads(run(py + ['-c', fingerprint], env=clone_env))
            print(f'Testing {len(plan)} migrations on the restored copy...', flush=True)
            output = '' if no_migrations else run(py + ['manage.py', 'migrate', '--noinput'], env=clone_env)
            (folder / 'rehearsal-migrations.log').write_text(output, encoding='utf-8')
            after = json.loads(run(py + ['-c', fingerprint], env=clone_env))
            if before != after:
                raise RuntimeError('Existing business data changed in rehearsal; application update refused')
            save_json(folder / 'verified-business-data.json', after)
            print('Backup restored; migration rehearsal passed; existing business data matches.', flush=True)
            return after
        finally:
            # Only delete resources created by this invocation, with a matching unique label.
            found = run(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip()
            if found and inspect(found)['Config']['Labels'].get('sj-update-check') == marker:
                run(['docker', 'rm', '-f', found])
            info = json.loads(run(['docker', 'volume', 'inspect', volume]))[0]
            if info.get('Labels', {}).get('sj-update-check') == marker:
                run(['docker', 'volume', 'rm', volume])

    def apply(self, folder):
        stopped = False
        migration_started = False
        override = folder / 'application.override.json'
        try:
            print('Stopping application writes; PostgreSQL and Redis remain running...', flush=True)
            stopped = True
            run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend'])
            if self.schedulers:
                run(self.base + ['stop', '-t', '120', *self.schedulers])
            run(self.base + ['stop', '-t', '600', 'worker'])
            state = inspect(self.ids['worker'])['State']
            if state.get('OOMKilled') or state.get('ExitCode') == 137:
                raise RuntimeError('Worker was killed rather than drained; inspect its jobs before retrying')
            self.backup(folder, uploads=True)
            self.clone_check(folder)
            save_json(override, {'services': {
                'backend': {'image': self.new_backend}, 'worker': {'image': self.new_backend},
                'frontend': {'image': self.new_frontend},
                **{name: {'image': self.new_backend} for name in self.schedulers},
            }})
            new = self.base + ['-f', str(override)]
            live_py = new + ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'python', 'backend']
            fingerprint = fingerprint_code(json.loads((folder / 'migration-plan.json').read_text()))
            before = json.loads(run(live_py + ['-c', fingerprint]))
            if before != json.loads((folder / 'verified-business-data.json').read_text()):
                raise RuntimeError('Database changed during maintenance; check external writers')
            migration_started = True
            print('Applying the tested migrations to the existing database...', flush=True)
            output = run(live_py + ['manage.py', 'migrate', '--noinput'])
            (folder / 'live-migrations.log').write_text(output, encoding='utf-8')
            if before != json.loads(run(live_py + ['-c', fingerprint])):
                raise RuntimeError('Business data verification failed after live migration')
            # Preserve all other image selections and all server configuration.
            image_file = self.stack / 'images.env'
            lines = image_file.read_text(encoding='utf-8-sig').splitlines()
            for key, value in [('BACKEND_IMAGE', self.new_backend), ('FRONTEND_IMAGE', self.new_frontend)]:
                lines = [line for line in lines if line.split('=', 1)[0].strip() != key]
                lines.append(key + '=' + value)
            temp = self.stack / 'images.env.update-tmp'
            temp.write_text('\n'.join(lines) + '\n', encoding='utf-8')
            os.replace(temp, image_file)
            run(self.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
                             '--wait', '--wait-timeout', '300', 'backend', 'frontend', 'worker'], capture=False)
            if self.schedulers:
                run(self.base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build',
                                 '--wait', '--wait-timeout', '120', *self.schedulers], capture=False)
            run(self.base + ['start', 'proxy'])
            current = inspect(self.ids['db'])
            if current['Id'] != self.db['Id'] or current['Mounts'] != self.db['Mounts']:
                raise RuntimeError('Unexpected database container/mount change')
            save_json(folder / 'SUCCESS.json', {'database_container_unchanged': True,
                                               'database_volume': self.volume, 'business_data_matches': True})
            print(f'UPDATE PASSED. Backup: {folder}', flush=True)
        except BaseException:
            if stopped and not migration_started:
                print('Production migrations were NOT started. Restarting the previous application.', flush=True)
                run(self.base + ['start', 'backend', 'frontend', 'worker', *self.schedulers, 'proxy'])
            elif migration_started:
                # Keep ingress closed; never auto-restore over a database that may contain new writes.
                run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', *self.schedulers, 'worker'])
                print(f'UPDATE STOPPED. Database retained; app stopped. Backup and logs: {folder}', flush=True)
                print('Do not restore over the working volume or run backward migrations automatically.', flush=True)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', required=True, help='Existing directory containing .env and docker-compose.yml')
    parser.add_argument('--mode', choices=('check', 'rehearse', 'apply'), default='check')
    parser.add_argument('--backup-root', help='Existing server backup location with sufficient free space')
    args = parser.parse_args()
    os.umask(0o077)
    update = Update(args)
    platform = run(['docker', 'info', '--format', '{{.OSType}}/{{.Architecture}}']).strip()
    if platform not in ('linux/amd64', 'linux/x86_64'):
        raise RuntimeError('This package requires a Linux amd64 Docker engine')
    update.load()
    if args.mode == 'check':
        print('Preflight passed; no production data or running services changed.')
        return
    if not args.backup_root:
        parser.error('--backup-root is required for rehearse/apply')
    stamp = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    folder = Path(args.backup_root).resolve() / (args.mode + '-' + stamp)
    if args.mode == 'rehearse':
        update.backup(folder, uploads=False)
        update.clone_check(folder)
    else:
        lock = update.stack / '.offline-update-lock'
        try:
            lock.mkdir()
        except FileExistsError:
            raise RuntimeError('Update lock exists; check for another running updater before removing it')
        try:
            update.apply(folder)
        finally:
            lock.rmdir()


if __name__ == '__main__':
    print('Use update.py for the supported migration-free update. '
          'This file is an internal library; its legacy migration CLI is disabled.', file=sys.stderr)
    sys.exit(2)
