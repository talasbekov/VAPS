#!/usr/bin/env python3
"""Cold migration of one Smart LAN Docker project; never overwrite a target."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

FORMAT = 'smart-cold-server-move/v1'
SERVICES = {'db', 'redis', 'backend', 'worker', 'frontend', 'proxy'}
ROLE_ENV = {'backend': 'BACKEND_IMAGE', 'worker': 'BACKEND_IMAGE', 'beat': 'BACKEND_IMAGE',
            'frontend': 'FRONTEND_IMAGE', 'proxy': 'PROXY_IMAGE', 'db': 'POSTGRES_IMAGE', 'redis': 'REDIS_IMAGE'}
ADDRESS_KEYS = {'BIND_IP', 'ALLOWED_HOSTS', 'CORS_ALLOWED_ORIGINS', 'CSRF_TRUSTED_ORIGINS',
                'NEXTAUTH_URL', 'SESSION_COOKIE_DOMAIN', 'CSRF_COOKIE_DOMAIN'}
SAFE_NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*\Z')
TOOLS_INDEX_SHA256 = 'b12a17428831470d8af5961d8634f0985d23d2794f876289d2bc3d3ac7d94343'
TOOLS_FOLDER = 'update-2026-10-20/smart-josparlau-update-2026-10-20'
MAINTENANCE_HELPERS = {
    'Smart-Josparlau-rehearse-import-2026-10-20.py': '943e94d03ac0f9dc48d331ad269b150097c0f3de4fba665cd77b4d4d59b84921',
    'Smart-Josparlau-apply-import-2026-10-20.py': '6ead8fe202a91a33082ad7d09fa9ada2ebc7f93733cdbe40b58eb1d4b0374ae4',
}


def now():
    return datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')


def save(path, value):
    path = Path(path)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def maintenance_inventory(tools):
    index = tools / 'SHA256SUMS'
    if digest(index) != TOOLS_INDEX_SHA256:
        raise ValueError('Use the unchanged reviewed Smart20.10 update package as --tools')
    result = {'maintenance/' + TOOLS_FOLDER + '/SHA256SUMS': index}
    for line in index.read_text(encoding='utf-8').splitlines():
        checksum, name = line.split('  ', 1)
        relative = PurePosixPath(name)
        source = tools / name
        if (relative.is_absolute() or '..' in relative.parts or source.is_symlink()
                or not source.is_file() or digest(source) != checksum):
            raise ValueError('Reviewed maintenance file differs: ' + name)
        result['maintenance/' + TOOLS_FOLDER + '/' + name] = source
    helper_root = tools.parents[1] if len(tools.parents) > 1 else tools.parent
    for name, checksum in MAINTENANCE_HELPERS.items():
        source = helper_root / name
        if source.is_file():
            if source.is_symlink() or digest(source) != checksum:
                raise ValueError('Maintenance helper differs from its reviewed version: ' + name)
            result['maintenance/' + name] = source
    return result


def estimate_volume_bytes(docker, image, volumes):
    result = 0
    for name in volumes.values():
        raw = docker.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '0:0',
            '--mount', 'type=volume,src=' + name + ',dst=/snapshot,readonly', '--entrypoint', 'du', image, '-sb', '/snapshot'])
        result += int(raw.split()[0])
    return result


def rewrite_env(text, old_ip, new_ip):
    lines = []
    found = False
    for line in text.splitlines():
        match = re.match(r'^(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)$', line)
        if match and match[1] in ADDRESS_KEYS:
            key, value = match.groups()
            if key == 'BIND_IP':
                value, found = new_ip, True
            else:
                value = re.sub(r'(?<![0-9.])' + re.escape(old_ip) + r'(?![0-9.])', new_ip, value)
            line = key + '=' + value
        lines.append(line)
    if not found:
        lines.append('BIND_IP=' + new_ip)
    return '\n'.join(lines) + '\n'


def check_member(item):
    path = PurePosixPath(item.name)
    if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
        raise ValueError('Archive contains an unsafe path or link')


def check_archive(path):
    seen = set()
    with tarfile.open(path, 'r:*') as archive:
        for item in archive:
            check_member(item)
            normalized = str(PurePosixPath(item.name))
            if normalized in seen:
                raise ValueError('Archive contains repeated paths')
            seen.add(normalized)


def verify_image(info, expected, actual_config=None):
    if (not (info['Id'] in (expected['source_id'], expected['config_id']) or actual_config == expected['config_id']) or
            info.get('Os') != 'linux' or info.get('Architecture') != 'amd64'):
        raise ValueError('Loaded image differs from the exported runtime')


def verify_loaded_image(docker, info, expected):
    if info['Id'] in (expected['source_id'], expected['config_id']):
        verify_image(info, expected)
        return
    # A classic engine reports the config digest; containerd can report an OCI
    # manifest/index digest instead. Read the actual config, never trust a tag.
    with tempfile.TemporaryFile() as stream:
        docker.run(['docker', 'save', expected['tag']], stdout=stream)
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode='r:') as archive:
            entries = json.load(archive.extractfile('manifest.json'))
            selected = [item for item in entries if expected['tag'] in (item.get('RepoTags') or [])]
            if len(selected) != 1: raise ValueError('Loaded image configuration is ambiguous')
            actual = 'sha256:' + hashlib.sha256(archive.extractfile(selected[0]['Config']).read()).hexdigest()
    verify_image(info, expected, actual_config=actual)


def verify_runtime_archive(path, images):
    expected = {item['tag'] for item in images.values()}
    with tarfile.open(path, 'r:') as archive:
        entries = json.load(archive.extractfile('manifest.json'))
        tags = [tag for entry in entries for tag in (entry.get('RepoTags') or [])]
        if set(tags) != expected or len(tags) != len(expected):
            raise ValueError('Runtime archive includes missing, duplicate or unrelated image tags')
        for item in images.values():
            matching = [entry for entry in entries if item['tag'] in (entry.get('RepoTags') or [])]
            if len(matching) != 1: raise ValueError('Runtime image is not unique in export')
            raw = archive.extractfile(matching[0]['Config']).read()
            config = json.loads(raw)
            if ('sha256:' + hashlib.sha256(raw).hexdigest() != item['config_id'] or
                    config.get('architecture') != 'amd64' or config.get('os') != 'linux'):
                raise ValueError('Runtime image configuration/platform checksum mismatch')


def validate_mounts(project, mounts, volumes):
    result = {}
    for mount in mounts:
        if mount.get('Type') != 'volume' or mount.get('Name') not in volumes:
            raise ValueError('Only project-owned local named volumes are portable automatically')
        name = mount['Name']
        info = volumes[name]
        labels = info.get('Labels') or {}
        logical = labels.get('com.docker.compose.volume', '')
        if (labels.get('com.docker.compose.project') != project or not SAFE_NAME.fullmatch(logical)
                or name != project + '_' + logical or info.get('Driver') != 'local' or info.get('Options')):
            raise ValueError('Shared, externally named or nonlocal volume requires a separate migration')
        result[logical] = name
    return result


def require_empty_resources(resources):
    if any(resources.get(key) for key in ('containers', 'volumes', 'networks')):
        raise ValueError('Destination Smart resources already exist; nothing will be overwritten')


def require_exclusive_volumes(all_containers, selected_ids, selected_volumes):
    for info in all_containers:
        if info['Id'] not in selected_ids and any(
                item.get('Type') == 'volume' and item.get('Name') in selected_volumes
                for item in info.get('Mounts', [])):
            raise ValueError('Another container uses a selected Smart volume; cold export refused before copying')


def exclusive_volumes(docker, containers, volumes):
    ids = docker.run(['docker', 'ps', '-aq']).decode().split()
    all_containers = [docker.inspect(cid) for cid in ids]
    require_exclusive_volumes(all_containers, {item['Id'] for item in containers.values()}, set(volumes.values()))


CTL_FENCE = '''# SMART_SERVER_MIGRATION_FENCE_V1
case "${1:-}" in
  ps|config|logs|images|version|top|ls|port|--help|-h) ;;
  *)
    if ! python3 - "$(dirname -- "$0")/.offline-update-lock/owner.json" <<'SMART_MIGRATION_LOCK'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
if not path.parent.exists():
    raise SystemExit(0)
owner = json.loads(path.read_text(encoding='utf-8'))
raise SystemExit(1 if owner.get('mode') == 'server-migration' else 0)
SMART_MIGRATION_LOCK
    then
      echo "Smart source is frozen for server migration. Use the migration tool's controlled resume-source command." >&2
      exit 1
    fi
    ;;
esac
'''


def guarded_ctl(text):
    if '# SMART_SERVER_MIGRATION_FENCE_V1' in text: return text
    first, separator, rest = text.partition('\n')
    if first.strip() not in ('#!/usr/bin/env bash', '#!/bin/bash'):
        raise ValueError('Source ctl.sh must be the reviewed Bash launcher')
    return first + '\n' + CTL_FENCE + rest


def missing_object(error):
    error = error.lower()
    return any(word in error for word in (b'no such image', b'no such object', b'no such container', b'no such volume', b'no such network')) or bool(
        re.search(rb'(?:network|volume|image|container) [^\r\n]+ not found', error))


def verify_files(root, manifest):
    for name, expected in manifest['files'].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or not (root / name).is_file():
            raise ValueError('Incomplete or unsafe migration inventory')
        if digest(root / name) != expected:
            raise ValueError('Migration checksum mismatch: ' + name)


def completed_replay(state, identity):
    if state.get('migration_id') != identity or state.get('phase') != 'complete':
        raise ValueError('Destination has another or incomplete import; preserve it for recovery review')
    return True


def compare_configs(source, target, old_ip, new_ip):
    def normalize(config, original):
        config = json.loads(json.dumps(config))
        config.pop('name', None)
        # Compose has already resolved YAML anchors into services. Root x-*
        # fragments are inert templates, not additional runtime settings.
        for key in tuple(config):
            if key.startswith('x-'): config.pop(key)
        for service in config['services'].values():
            service.pop('image', None)
            for dependency in service.get('depends_on', {}).values():
                if isinstance(dependency, dict): dependency.setdefault('required', True)
            for key, value in list(service.get('environment', {}).items()):
                if original and key in ADDRESS_KEYS and isinstance(value, str):
                    service['environment'][key] = re.sub(r'(?<![0-9.])' + re.escape(old_ip) + r'(?![0-9.])', new_ip, value)
            for port in service.get('ports', []):
                if original and port.get('host_ip') in (old_ip, '0.0.0.0', '127.0.0.1', None):
                    port['host_ip'] = new_ip
        for kind in ('volumes', 'networks'):
            for item in config.get(kind, {}).values():
                item.pop('name', None)
                if item.get('external') is False: item.pop('external')
        return config
    left, right = normalize(source, True), normalize(target, False)
    if left != right:
        paths = []
        def differences(a, b, path=''):
            if type(a) is not type(b): paths.append(path); return
            if isinstance(a, dict):
                for key in sorted(set(a) | set(b)):
                    child = (path + '.' if path else '') + key
                    if key not in a or key not in b: paths.append(child)
                    else: differences(a[key], b[key], child)
            elif isinstance(a, list):
                if len(a) != len(b): paths.append(path)
                else:
                    for index, (first, second) in enumerate(zip(a, b)): differences(first, second, path + '[' + str(index) + ']')
            elif a != b: paths.append(path)
        differences(left, right)
        raise ValueError('Portable configuration changed settings beyond images, project names and destination address; fields: ' + ', '.join(paths[:40]))


def require_preflight_state(state):
    if (state.get('phase') != 'recovery-required' or state.get('activation_attempted') is not False
            or state.get('volumes') or state.get('resource_creation_started')):
        raise ValueError('Only a failed preflight of the same snapshot before any resource creation can be retried')


def require_preflight_retry(state, checksum, identity, project, resources):
    require_preflight_state(state)
    if (state.get('bundle_sha256') != checksum or state.get('migration_id') != identity or state.get('project') != project):
        raise ValueError('Preflight retry must use the same original snapshot and destination project')
    require_empty_resources(resources)


def original_cached_manifest(bundle, payload):
    with tarfile.open(bundle, 'r:gz') as archive:
        member = archive.getmember('manifest.json')
        if not member.isfile() or member.size > 2 * 1024 * 1024:
            raise ValueError('Invalid original snapshot manifest')
        original = archive.extractfile(member).read()
    cache = payload / 'manifest.json'
    if cache.is_symlink() or cache.read_bytes() != original:
        raise ValueError('Cached manifest differs from the checksum-verified original archive; retry refused')
    manifest = json.loads(original)
    expected = set(manifest['files']) | {'manifest.json'}
    actual = set()
    for path in payload.rglob('*'):
        if path.is_symlink(): raise ValueError('Linked cached snapshot cannot be retried')
        if path.is_file(): actual.add(path.relative_to(payload).as_posix())
    if actual != expected:
        raise ValueError('Cached snapshot contains missing or additional files; retry refused')
    return manifest


def configuration_file(path, data, retry=False):
    expected = data if isinstance(data, bytes) else data.encode('utf-8')
    if retry:
        if path.is_symlink() or not path.is_file() or path.read_bytes() != expected:
            raise ValueError('Destination file changed; preflight retry will not overwrite it: ' + path.name)
    else:
        path.write_bytes(expected)


@contextmanager
def destination_lock(target):
    import fcntl
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = target.parent / ('.' + target.name + '.server-move.lock')
    with os.fdopen(os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'a+b') as handle:
        try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another Smart import is already using this destination; no concurrent retry is allowed') from None
        try: yield
        finally: fcntl.flock(handle, fcntl.LOCK_UN)


class Docker:
    def __init__(self, evidence):
        self.evidence = Path(evidence)
        self.count = 0

    def run(self, command, *, stdin=None, stdout=None, env=None, optional=False, merge_stderr=False):
        result = subprocess.run(command, stdin=stdin, stdout=stdout or subprocess.PIPE,
                                stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE, env=env)
        if result.returncode:
            error = result.stderr or b''
            if optional and missing_object(error):
                return None
            self.count += 1
            path = self.evidence / ('command-error-' + str(self.count) + '.private.log')
            path.write_bytes((result.stdout or b'') + b'\n' + error)
            path.chmod(0o600)
            raise RuntimeError('Docker command failed (' + str(result.returncode) + '); private log: ' + str(path))
        return result.stdout if stdout is None else b''

    def json(self, command, **kwargs):
        raw = self.run(command, **kwargs)
        return json.loads(raw) if raw is not None else None

    def inspect(self, name, kind='container', optional=False):
        value = self.json(['docker', kind, 'inspect', name], optional=optional)
        return value[0] if value is not None else None

    def compose(self, folder):
        return ['docker', 'compose', '--project-directory', str(folder), '--env-file', str(folder / 'images.env'),
                '--env-file', str(folder / '.env'), '-f', str(folder / 'docker-compose.yml')]

    def wait(self, identities, seconds=180):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            states = [self.inspect(identity)['State'] for identity in identities]
            if all(item.get('Running') and item.get('Health', {}).get('Status', 'healthy') == 'healthy' for item in states):
                return
            if any(item.get('Status') in ('exited', 'dead') for item in states):
                raise RuntimeError('An imported application service exited; ingress remains closed')
            time.sleep(1)
        raise RuntimeError('Service readiness timed out; preserve the migration evidence')


CAPTURE = '''import json,sys,django
payload=json.load(sys.stdin)
django.setup()
from django.db import connection,transaction
scope={}
exec(payload['checks'],scope)
with transaction.atomic():
 with connection.cursor() as cursor:
  cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
  cursor.execute("SET LOCAL lock_timeout='10s'")
  cursor.execute("SET LOCAL statement_timeout='120s'")
  cursor.execute('SHOW transaction_read_only')
  assert cursor.fetchone()[0]=='on'
  assert not scope['pending_plan'](), 'Migration would be required; no schema change is allowed during a server move'
 result=scope['capture']()
print(json.dumps(result,sort_keys=True))
'''
FILES = '''import hashlib,json
from pathlib import Path
base=Path('/snapshot')
result=[]
for path in sorted(base.rglob('*')):
 assert not path.is_symlink(), 'Linked upload storage needs separate migration'
 if path.is_file():
  h=hashlib.sha256()
  with path.open('rb') as stream:
   for block in iter(lambda:stream.read(4194304),b''):h.update(block)
  result.append([path.relative_to(base).as_posix(),path.stat().st_size,h.hexdigest()])
print(json.dumps(result,sort_keys=True))
'''


def probe(docker, image, database_id, environment, checks):
    declared = {key: str(value) for key, value in environment.items()}
    declared.update(POSTGRES_HOST='127.0.0.1', POSTGRES_PORT='5432',
                    PGOPTIONS='-c default_transaction_read_only=on', ENABLE_BACKGROUND_TASKS='0',
                    PYTHONDONTWRITEBYTECODE='1')
    environment = {**os.environ, **declared}
    keys = sorted(declared)
    command = ['docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'container:' + database_id,
               '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
               *[arg for key in keys for arg in ('-e', key)], '--entrypoint', 'python', image, '-c', CAPTURE]
    with tempfile.TemporaryFile() as stream:
        stream.write(json.dumps({'checks': checks}).encode('utf-8')); stream.seek(0)
        return docker.json(command, stdin=stream, env=environment)


def volume_files(docker, image, name):
    return docker.json(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '0:0',
        '--mount', 'type=volume,src=' + name + ',dst=/snapshot,readonly', '--entrypoint', 'python', image, '-c', FILES])


def restore_volume(docker, image, name, archive):
    check_archive(archive)
    with Path(archive).open('rb') as stream:
        docker.run(['docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'none', '--user', '0:0',
            '--mount', 'type=volume,src=' + name + ',dst=/snapshot', '--entrypoint', 'tar', image,
            '--numeric-owner', '-xzpf', '-', '-C', '/snapshot'], stdin=stream)


def copied_database_proof(docker, root, manifest, checks):
    marker = uuid.uuid4().hex
    name, volume = 'sj-move-proof-' + marker, 'sj-move-proof-' + marker + '-data'
    label = 'sj-move-proof'
    backend = manifest['images']['backend']['source_id']
    postgres = manifest['images']['db']['source_id']
    env = manifest['config']['services']['db']['environment']
    environment = {**os.environ, **{key: str(value) for key, value in env.items()}}
    cid, made = None, False
    save(root.parent / 'proof-owned-resources.json', {'container': name, 'volume': volume, 'label': label + '=' + marker})
    try:
        docker.run(['docker', 'volume', 'create', '--label', label + '=' + marker, volume]); made = True
        restore_volume(docker, backend, volume, root / manifest['volumes']['postgres']['archive'])
        cid = docker.run(['docker', 'run', '-d', '--pull', 'never', '--network', 'none', '--name', name,
            '--memory', '768m', '--cpus', '1', '--pids-limit', '256', '--label', label + '=' + marker,
            *[arg for key in env for arg in ('-e', key)], '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data', postgres], env=environment).decode().strip()
        for _ in range(90):
            result = subprocess.run(['docker', 'exec', cid, 'pg_isready', '-h', '127.0.0.1', '-U', str(env['POSTGRES_USER']), '-d', str(env['POSTGRES_DB'])], capture_output=True)
            if result.returncode == 0: break
            time.sleep(1)
        else: raise RuntimeError('Restored PostgreSQL did not become ready')
        result = probe(docker, backend, cid, manifest['config']['services']['backend']['environment'], checks)
        if result != json.loads((root / 'database-before.json').read_text(encoding='utf-8')):
            raise RuntimeError('Physical PostgreSQL copy did not reproduce the frozen database')
    finally:
        info = docker.inspect(name, optional=True)
        if info:
            if (info['Config'].get('Labels') or {}).get(label) != marker:
                raise RuntimeError('Proof container ownership mismatch; cleanup refused')
            docker.run(['docker', 'rm', '-f', info['Id']])
        info = docker.inspect(volume, 'volume', optional=True)
        if info:
            if (info.get('Labels') or {}).get(label) != marker:
                raise RuntimeError('Proof volume ownership mismatch; cleanup refused')
            docker.run(['docker', 'volume', 'rm', volume])


def inventory(docker, stack):
    for key in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', *set(ROLE_ENV.values())):
        if os.environ.get(key):
            raise ValueError('Unset shell image/project override before migration: ' + key)
    for name in ('.env', 'images.env', 'docker-compose.yml'):
        if not (stack / name).is_file() or (stack / name).is_symlink():
            raise ValueError('Existing private stack configuration is required')
    base = docker.compose(stack)
    config = docker.json(base + ['config', '--format', 'json'])
    services, project = config['services'], config['name']
    if not SAFE_NAME.fullmatch(project) or set(services) not in (SERVICES, SERVICES | {'beat'}):
        raise ValueError('Expected exactly the Smart LAN services and optional separate beat')
    if 'beat' in services and any(value in ('-B', '--beat') for value in (services['worker'].get('command') or [])):
        raise ValueError('Both worker and separate beat would schedule jobs')
    current, volumes = {}, {}
    names = docker.run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]).decode().split()
    for cid in names:
        info = docker.inspect(cid)
        labels = info['Config'].get('Labels') or {}
        service = labels.get('com.docker.compose.service')
        if labels.get('com.docker.compose.oneoff', 'False').lower() == 'true' or service not in services or service in current:
            raise ValueError('One-off, orphan or duplicate project containers must be reviewed before migration')
        owner = Path(labels.get('com.docker.compose.project.working_dir', '')).resolve()
        if owner != stack or not info['State'].get('Running'):
            raise ValueError('Every selected source service must belong to this stack and be running')
        if info['HostConfig'].get('RestartPolicy', {}).get('Name') not in ('unless-stopped', 'no', ''):
            raise ValueError('Source must not restart automatically after a frozen migration')
        for mount in info['Mounts']:
            if mount.get('Type') == 'volume':
                volumes[mount['Name']] = docker.inspect(mount['Name'], 'volume')
        validate_mounts(project, info['Mounts'], volumes)
        actual_env = dict(item.split('=', 1) for item in info['Config']['Env'] if '=' in item)
        if any(str(value) != actual_env.get(key) for key, value in services[service].get('environment', {}).items()):
            raise ValueError('Configured environment differs from the running service: ' + service)
        current[service] = info
    if set(current) != set(services):
        raise ValueError('A source Smart service is missing')
    logical = {}
    for info in current.values():
        logical.update(validate_mounts(project, info['Mounts'], volumes))
    if set(logical) != set(config.get('volumes', {})) or 'postgres' not in logical:
        raise ValueError('Every configured Smart volume must be accounted for')
    for key, value in config.get('volumes', {}).items():
        if value.get('external') or value.get('name') != project + '_' + key:
            raise ValueError('External or explicitly shared volumes require a separate migration')
    for key, value in config.get('networks', {}).items():
        if value.get('external') or value.get('name') != project + '_' + key or value.get('driver', 'bridge') != 'bridge':
            raise ValueError('Only private project bridge networks are portable automatically')
    images = {name: docker.inspect(info['Image'], 'image') for name, info in current.items()}
    backend = images['backend']
    if (backend['Config'].get('Entrypoint') != ['/bin/sh', '/sj-app-only-entrypoint.sh']
            or not (backend['Config'].get('Labels') or {}).get('smart-josparlau.app-only-entrypoint')):
        raise ValueError('Source backend must use the reviewed entrypoint without automatic migrations')
    if any(images[name]['Id'] != backend['Id'] for name in ('worker', 'beat') if name in images):
        raise ValueError('Backend and worker/scheduler images differ')
    postgres = docker.run(['docker', 'exec', current['db']['Id'], 'postgres', '--version']).decode()
    if ' 16.' not in postgres:
        raise ValueError('This physical transfer supports only the same PostgreSQL16 runtime')
    if services['backend']['environment']['POSTGRES_HOST'] != 'db':
        raise ValueError('Backend must use this project database')
    exclusive_volumes(docker, current, logical)
    return config, current, logical, images


def stop_exact(docker, containers, services, timeout):
    ids = [containers[name]['Id'] for name in services if name in containers]
    if ids:
        docker.run(['docker', 'stop', '--time', str(timeout), *ids])
        for cid in ids:
            state = docker.inspect(cid)['State']
            if state.get('Running') or state.get('OOMKilled') or state.get('ExitCode') != 0:
                raise RuntimeError('A source service did not stop cleanly; automatic continuation is refused')


def resume_exact(docker, containers):
    for group in (('db', 'redis'), ('backend', 'frontend'), ('worker', 'beat', 'proxy')):
        ids = [containers[name]['Id'] for name in group if name in containers]
        if ids:
            for name in group:
                if name in containers:
                    actual = docker.inspect(containers[name]['Id'])
                    if actual['Image'] != containers[name]['Image'] or actual['Mounts'] != containers[name]['Mounts']:
                        raise RuntimeError('Original source container identity changed; resume refused')
            docker.run(['docker', 'start', *ids]); docker.wait(ids, 240)


def recover_export(docker, containers, lock, stage, owner, frozen, unsafe, published):
    owner.update(phase='export-recovery-required', snapshot_published=published)
    save(lock / 'owner.json', owner)
    if not unsafe and not published:
        if frozen: resume_exact(docker, containers)
        (lock / 'owner.json').unlink(); lock.rmdir()
        save(stage / 'SOURCE-RESUMED.json', {'source_resumed': True, 'export_completed': False})
    else:
        print('Source remains frozen. Preserve the archive and migration evidence; no automatic restart.', file=sys.stderr)


def export_source(args):
    stack, output, tools = args.stack.resolve(), args.out.resolve(), args.tools.resolve()
    if output.exists() or Path(str(output) + '.sha256').exists():
        raise ValueError('Use a new snapshot filename; existing backups are never overwritten')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = stack / 'backups' / 'server-moves' / ('export-' + now() + '-' + uuid.uuid4().hex[:8])
    stage.mkdir(mode=0o700, parents=True)
    docker = Docker(stage)
    if docker.run(['docker', 'version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']).decode().strip() != 'linux/amd64':
        raise ValueError('A Linux amd64 Docker server is required')
    checks = (tools / 'schema-transition-checks.py').read_text(encoding='utf-8')
    if not checks.startswith('"""Database evidence'):
        raise ValueError('Use the reviewed Smart20.10 package as --tools')
    config, containers, volumes, actual_images = inventory(docker, stack)
    maintenance = maintenance_inventory(tools)
    volume_bytes = estimate_volume_bytes(docker, actual_images['backend']['Id'], volumes)
    image_bytes = sum(item.get('Size', 0) for item in {item['Id']: item for item in actual_images.values()}.values())
    maintenance_bytes = sum(path.stat().st_size for path in maintenance.values())
    # Retained payload + transport archive + PostgreSQL proof copy and headroom.
    required = 2 * (volume_bytes + image_bytes + maintenance_bytes) + volume_bytes + 1024**3
    if shutil.disk_usage(output.parent).free < required or shutil.disk_usage(stage).free < required:
        raise ValueError('Not enough free source space for payload, transport and independent restore; required bytes: ' + str(required))
    lock = stack / '.offline-update-lock'
    lock.mkdir(mode=0o700)
    identity = uuid.uuid4().hex
    owner = {'mode': 'server-migration', 'migration_id': identity, 'phase': 'preflight',
             'pid': os.getpid(), 'backup': str(stage), 'stack': str(stack), 'output': str(output)}
    save(lock / 'owner.json', owner)
    save(stage / 'source-containers.private.json', containers)
    frozen, unsafe, published = False, False, False
    try:
        ctl = stack / 'ctl.sh'
        raw_ctl = ctl.read_text(encoding='utf-8') if ctl.exists() else '#!/usr/bin/env bash\nset -euo pipefail\ncd -- "$(dirname -- "$0")"\nexec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"\n'
        ctl.write_text(guarded_ctl(raw_ctl), encoding='utf-8'); ctl.chmod(0o700)
        backend = actual_images['backend']['Id']
        before = probe(docker, backend, containers['db']['Id'], config['services']['backend']['environment'], checks)
        if shutil.disk_usage(output.parent).free < 2 * 1024**3:
            raise ValueError('At least2GiB backup space is required before export')
        payload = stage / 'payload'; payload.mkdir(mode=0o700)
        (payload / 'volumes').mkdir()
        (payload / 'source').mkdir()
        (payload / 'logs').mkdir()
        (payload / 'checks-source.py').write_text(checks, encoding='utf-8')
        for name, source in maintenance.items():
            destination = payload / name
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        for name in ('.env', 'images.env', 'docker-compose.yml', 'source-revision.txt', 'ctl.sh'):
            if (stack / name).is_file(): shutil.copyfile(stack / name, payload / 'source' / name)
        manifest = {'format': FORMAT, 'migration_id': identity, 'created_utc': now(), 'source_ip': str(args.source_ip),
            'project': config['name'], 'config': config, 'images': {}, 'volumes': {}, 'files': {},
            'storage_estimate': {'volumes': volume_bytes, 'images': image_bytes, 'maintenance': maintenance_bytes},
            'maintenance_package': TOOLS_FOLDER}
        for role in ('backend', 'frontend', 'proxy', 'db', 'redis'):
            tag = 'smart-josparlau/server-move-' + identity + ':' + role
            info = actual_images[role]
            docker.run(['docker', 'tag', info['Id'], tag])
            manifest['images'][role] = {'tag': tag, 'source_id': info['Id']}
        print('Freezing only Smart application services; finishing active worker jobs...', flush=True)
        owner['phase'] = 'stopping'; save(lock / 'owner.json', owner)
        frozen = True
        stop_exact(docker, containers, ('proxy', 'frontend', 'backend', 'beat'), 120)
        try:
            stop_exact(docker, containers, ('worker',), 600)
        except BaseException:
            unsafe = True
            raise
        before = probe(docker, backend, containers['db']['Id'], config['services']['backend']['environment'], checks)
        save(payload / 'database-before.json', before)
        upload_hashes = {name: volume_files(docker, backend, volumes[name]) for name in ('media', 'private', 'static') if name in volumes}
        save(payload / 'uploads-before.json', upload_hashes)
        try:
            stop_exact(docker, containers, ('redis', 'db'), 120)
        except BaseException:
            unsafe = True
            raise
        control = docker.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '0:0',
            '--mount', 'type=volume,src=' + volumes['postgres'] + ',dst=/snapshot,readonly',
            '--entrypoint', 'pg_controldata', actual_images['db']['Id'], '/snapshot']).decode()
        if not re.search(r'Database cluster state:\s+shut down\s*$', control, re.M):
            unsafe = True
            raise RuntimeError('PostgreSQL did not confirm a clean cold shutdown')
        (payload / 'postgres-control.txt').write_text(control, encoding='utf-8')
        print('Saving all cold Smart volumes, exact runtime images and private settings...', flush=True)
        exclusive_volumes(docker, containers, volumes)
        for logical, name in sorted(volumes.items()):
            path = payload / 'volumes' / (logical + '.tar.gz')
            with path.open('wb') as stream:
                docker.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '0:0',
                    '--mount', 'type=volume,src=' + name + ',dst=/snapshot,readonly', '--entrypoint', 'tar', backend,
                    '--numeric-owner', '-czpf', '-', '-C', '/snapshot', '.'], stdout=stream)
            check_archive(path)
            manifest['volumes'][logical] = {'source_name': name, 'archive': 'volumes/' + path.name}
        for service, info in containers.items():
            with (payload / 'logs' / (service + '.log')).open('wb') as stream:
                docker.run(['docker', 'logs', '--timestamps', info['Id']], stdout=stream, merge_stderr=True)
        with (payload / 'images.tar').open('wb') as stream:
            docker.run(['docker', 'save', *[item['tag'] for item in manifest['images'].values()]], stdout=stream)
        with tarfile.open(payload / 'images.tar', 'r:') as image_archive:
            image_manifest = json.load(image_archive.extractfile('manifest.json'))
            for item in manifest['images'].values():
                found = [entry for entry in image_manifest if item['tag'] in (entry.get('RepoTags') or [])]
                if len(found) != 1: raise ValueError('Runtime image export is incomplete')
                raw = image_archive.extractfile(found[0]['Config']).read()
                item['config_id'] = 'sha256:' + hashlib.sha256(raw).hexdigest()
        print('Restoring the cold PostgreSQL copy in an isolated container and comparing all database data...', flush=True)
        copied_database_proof(docker, payload, manifest, checks)
        manifest['independently_restored'] = True
        manifest['files'] = {path.relative_to(payload).as_posix(): digest(path) for path in payload.rglob('*') if path.is_file()}
        save(payload / 'manifest.json', manifest)
        temporary = Path(str(output) + '.incomplete')
        if temporary.exists(): raise ValueError('An incomplete export already occupies this filename')
        with tarfile.open(temporary, 'w:gz', compresslevel=1) as archive:
            for path in sorted(payload.rglob('*')):
                if path.is_file():
                    path.chmod(0o600)
                    archive.add(path, arcname=path.relative_to(payload).as_posix(), recursive=False)
        # Once a transportable snapshot can exist, the source must NEVER be
        # automatically resumed, even when final evidence/checksum writes fail.
        published = True
        temporary.chmod(0o600); temporary.rename(output)
        checksum = digest(output)
        Path(str(output) + '.sha256').write_text(checksum + '  ' + output.name + '\n', encoding='ascii')
        Path(str(output) + '.sha256').chmod(0o600)
        owner.update(phase='source-frozen', sha256=checksum); save(lock / 'owner.json', owner)
        save(stage / 'SOURCE-FROZEN.json', owner)
        print('EXPORT PASSED. Source Smart stays stopped for the move. Archive: ' + str(output), flush=True)
        print('SHA256: ' + checksum, flush=True)
    except BaseException:
        recover_export(docker, containers, lock, stage, owner, frozen, unsafe, published)
        raise


def extract_bundle(bundle, destination):
    with tarfile.open(bundle, 'r:gz') as archive:
        seen = set()
        for item in archive:
            check_member(item)
            name = str(PurePosixPath(item.name))
            if name in seen or len(seen) > 256:
                raise ValueError('Unexpected migration archive inventory')
            seen.add(name)
            path = destination / name
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.extractfile(item) as source, path.open('xb') as output:
                    shutil.copyfileobj(source, output)
                path.chmod(0o600)


def target_resources(docker, config):
    project = config['name']
    result = {'containers': docker.run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]).decode().split(),
              'volumes': [], 'networks': []}
    for service, value in config['services'].items():
        name = value.get('container_name') or project + '-' + service + '-1'
        if docker.inspect(name, optional=True): result['containers'].append(name)
    for logical, value in config.get('volumes', {}).items():
        name = value.get('name') or project + '_' + logical
        if docker.inspect(name, 'volume', optional=True): result['volumes'].append(name)
    for logical, value in config.get('networks', {}).items():
        name = value.get('name') or project + '_' + logical
        if docker.inspect(name, 'network', optional=True): result['networks'].append(name)
    return result


def set_env(text, key, value):
    lines = text.splitlines()
    matches = [index for index, line in enumerate(lines) if re.match(r'^(?:export\s+)?' + re.escape(key) + '=', line)]
    if len(matches) > 1: raise ValueError('Repeated environment key: ' + key)
    if matches: lines[matches[0]] = key + '=' + value
    else: lines.append(key + '=' + value)
    return '\n'.join(lines) + '\n'


def check_ports(config):
    seen = set()
    for service in config['services'].values():
        for port in service.get('ports', []):
            protocol = port.get('protocol', 'tcp')
            if protocol != 'tcp': raise ValueError('Only the reviewed Smart TCP bindings are supported')
            number, host = int(port['published']), port.get('host_ip', '0.0.0.0')
            key = (host, number)
            if key in seen: continue
            seen.add(key)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
                    handle.bind(key)
            except OSError:
                raise ValueError('Destination address/port is unavailable: ' + host + ':' + str(number)) from None


def assign_owner(folder, owner):
    if not owner: return
    import pwd
    account = pwd.getpwnam(owner)
    for path in [folder, *folder.rglob('*')]:
        if path.is_symlink(): raise ValueError('Unexpected link in new installation')
        os.chown(path, account.pw_uid, account.pw_gid)


def owned_target_service(info, project, target, resources_reserved):
    labels = info['Config'].get('Labels') or {}
    return (resources_reserved and labels.get('com.docker.compose.project') == project
            and Path(labels.get('com.docker.compose.project.working_dir', '')).resolve() == target.resolve()
            and labels.get('com.docker.compose.service') in ('proxy', 'frontend', 'backend', 'worker', 'beat'))


def import_target(args):
    with destination_lock(args.target.resolve()):
        return import_target_locked(args)


def import_target_locked(args):
    bundle, target = args.bundle.resolve(), args.target.resolve()
    expected = Path(str(bundle) + '.sha256').read_text(encoding='ascii').split()[0]
    actual = digest(bundle)
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or actual != expected:
        raise ValueError('The complete source snapshot SHA256 does not match')
    state_path = target / '.server-move-state.json'
    retry = False
    state = None
    if target.exists():
        if state_path.is_file():
            state = json.loads(state_path.read_text(encoding='utf-8'))
            if state.get('bundle_sha256') == actual:
                if state.get('phase') == 'complete':
                    completed_replay(state, state['migration_id'])
                    print('ALREADY IMPORTED. Current database and manual edits were not restored or changed.', flush=True)
                    return
                retry = bool(getattr(args, 'resume_preflight', False))
        if not retry:
            raise ValueError('Destination directory must not already exist; partial data is preserved')
        require_preflight_state(state)
    elif getattr(args, 'resume_preflight', False):
        raise ValueError('Preflight retry requires the original failed destination directory')
    if args.owner:
        import pwd
        pwd.getpwnam(args.owner)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not retry and shutil.disk_usage(target.parent).free < 2 * bundle.stat().st_size + 1024**3:
        raise ValueError('Insufficient space to unpack and verify the source snapshot')
    history = target / 'backups' / 'server-move'
    payload = history / 'snapshot'
    if not retry:
        target.mkdir(mode=0o700)
        history.mkdir(parents=True, mode=0o700); payload.mkdir(mode=0o700)
        state = {'phase': 'unpacking', 'bundle_sha256': actual, 'bundle': str(bundle)}
        save(state_path, state)
    elif not payload.is_dir() or payload.is_symlink() or history.is_symlink():
        raise ValueError('The original verified preflight snapshot directory is required')
    docker = Docker(history)
    project = None
    activated = False
    resources_reserved = False
    retry_authorized = not retry
    try:
        print('Checking the complete snapshot before creating any application resource...', flush=True)
        if not retry: extract_bundle(bundle, payload)
        manifest = original_cached_manifest(bundle, payload) if retry else json.loads((payload / 'manifest.json').read_text(encoding='utf-8'))
        if manifest.get('format') != FORMAT or not manifest.get('independently_restored') or not re.fullmatch(r'[0-9a-f]{32}', manifest.get('migration_id', '')):
            raise ValueError('An independently restored source snapshot is required')
        verify_files(payload, manifest)
        if manifest.get('maintenance_package') != TOOLS_FOLDER:
            raise ValueError('Reviewed maintenance package is missing from the migration')
        maintenance_inventory(payload / 'maintenance' / TOOLS_FOLDER)
        if set(manifest['images']) != {'backend', 'frontend', 'proxy', 'db', 'redis'}:
            raise ValueError('All five exact Smart runtime images must be present')
        verify_runtime_archive(payload / 'images.tar', manifest['images'])
        if set(manifest['config']['services']) not in (SERVICES, SERVICES | {'beat'}):
            raise ValueError('Unexpected application services in the snapshot')
        project = args.project or manifest['project']
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', project): raise ValueError('Invalid destination project name')
        if not retry:
            state.update(migration_id=manifest['migration_id'], project=project, phase='preflight')
            save(state_path, state)
        for key in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', *set(ROLE_ENV.values())):
            if os.environ.get(key): raise ValueError('Unset shell project/image overrides before importing')
        if docker.run(['docker', 'version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']).decode().strip() != 'linux/amd64':
            raise ValueError('Destination must be a Linux amd64 Docker server')
        config_env = rewrite_env((payload / 'source' / '.env').read_text(encoding='utf-8-sig'), manifest['source_ip'], str(args.ip))
        config_env = set_env(config_env, 'STACK_NAME', project)
        configuration_file(target / '.env', config_env, retry)
        images_env = (payload / 'source' / 'images.env').read_text(encoding='utf-8-sig')
        for role, item in manifest['images'].items():
            images_env = set_env(images_env, ROLE_ENV[role], item['tag'])
        configuration_file(target / 'images.env', images_env, retry)
        for name in ('docker-compose.yml', 'source-revision.txt', 'ctl.sh'):
            if (payload / 'source' / name).is_file():
                configuration_file(target / name, (payload / 'source' / name).read_bytes(), retry)
        base = docker.compose(target)
        config = docker.json(base + ['config', '--format', 'json'])
        if config['name'] != project: raise ValueError('Source compose does not accept the chosen destination project name')
        compare_configs(manifest['config'], config, manifest['source_ip'], str(args.ip))
        if any(service['image'] != manifest['images']['backend' if name in ('worker', 'beat') else name]['tag'] for name, service in config['services'].items()):
            raise ValueError('Destination compose does not select the transferred runtime images')
        resources = target_resources(docker, config)
        if retry:
            require_preflight_retry(state, actual, manifest['migration_id'], project, resources)
            save(history / ('PREFLIGHT-RETRY-' + now() + '-' + uuid.uuid4().hex[:8] + '.json'), state)
            retry_authorized = True
            state = {'phase': 'preflight', 'bundle_sha256': actual, 'bundle': str(bundle),
                     'migration_id': manifest['migration_id'], 'project': project, 'resumed_preflight_utc': now()}
            save(state_path, state)
            print('PREFLIGHT RETRY VERIFIED. Same snapshot; no destination containers or volumes exist; original evidence retained.', flush=True)
        else:
            require_empty_resources(resources)
        check_ports(config)
        storage = manifest['storage_estimate']
        docker_root = Path(docker.run(['docker', 'info', '--format', '{{.DockerRootDir}}']).decode().strip())
        remaining = storage['volumes'] + storage['images'] + storage['maintenance'] + 1024**3
        if shutil.disk_usage(target).free < remaining or shutil.disk_usage(docker_root).free < remaining:
            raise ValueError('Destination needs more free space for restored volumes and runtime images; required bytes: ' + str(remaining))
        for name, item in manifest['volumes'].items():
            if (not SAFE_NAME.fullmatch(name) or name not in config.get('volumes', {})
                    or item['archive'] != 'volumes/' + name + '.tar.gz'
                    or config['volumes'][name]['name'] != project + '_' + name):
                raise ValueError('Unaccounted or shared storage in snapshot')
            check_archive(payload / item['archive'])
        for role, item in manifest['images'].items():
            if item['tag'] != 'smart-josparlau/server-move-' + manifest['migration_id'] + ':' + role:
                raise ValueError('Runtime image tag is outside the private migration namespace')
            found = docker.inspect(item['tag'], 'image', optional=True)
            if found: verify_loaded_image(docker, found, item)
        print('Loading only migration-specific image tags; restoring new Smart volumes...', flush=True)
        resources_reserved = True
        state['resource_creation_started'] = True; save(state_path, state)
        docker.run(['docker', 'load', '-i', str(payload / 'images.tar')])
        image_refs = {}
        for role, item in manifest['images'].items():
            info = docker.inspect(item['tag'], 'image'); verify_loaded_image(docker, info, item); image_refs[role] = info['Id']
        state['phase'] = 'restoring-volumes'; state['volumes'] = {}; save(state_path, state)
        for logical, item in manifest['volumes'].items():
            name = config['volumes'][logical]['name']
            if docker.inspect(name, 'volume', optional=True): raise ValueError('Destination volume appeared during import')
            docker.run(['docker', 'volume', 'create', '--label', 'com.docker.compose.project=' + project,
                        '--label', 'com.docker.compose.volume=' + logical,
                        '--label', 'sj-server-migration=' + manifest['migration_id'], name])
            state['volumes'][logical] = name; save(state_path, state)
            restore_volume(docker, image_refs['backend'], name, payload / item['archive'])
        expected_uploads = json.loads((payload / 'uploads-before.json').read_text(encoding='utf-8'))
        for logical, expected_files in expected_uploads.items():
            if volume_files(docker, image_refs['backend'], state['volumes'][logical]) != expected_files:
                raise RuntimeError('Restored application files differ from the source snapshot')
        docker.run(base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '180', 'db', 'redis'])
        ids = {}
        def collect(names):
            for service in names:
                raw = docker.run(base + ['ps', '-q', service]).decode().split()
                if len(raw) != 1: raise RuntimeError('Expected exactly one destination service: ' + service)
                info = docker.inspect(raw[0]); labels = info['Config'].get('Labels') or {}
                if labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.service') != service:
                    raise RuntimeError('Destination service ownership mismatch')
                ids[service] = raw[0]
        collect(('db', 'redis'))
        checks = (payload / 'checks-source.py').read_text(encoding='utf-8')
        frozen = json.loads((payload / 'database-before.json').read_text(encoding='utf-8'))
        database = probe(docker, image_refs['backend'], ids['db'], config['services']['backend']['environment'], checks)
        if database != frozen: raise RuntimeError('Destination database differs from the complete frozen source snapshot')
        state['phase'] = 'database-verified'; save(state_path, state)
        print('Database, roles/physical cluster and uploaded files restored. Checking application before opening ingress...', flush=True)
        docker.run(base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '300', 'backend', 'frontend'])
        collect(('backend', 'frontend'))
        if probe(docker, image_refs['backend'], ids['db'], config['services']['backend']['environment'], checks) != frozen:
            raise RuntimeError('Application startup changed source data before opening ingress')
        for logical in ('media', 'private'):
            if logical in expected_uploads and volume_files(docker, image_refs['backend'], state['volumes'][logical]) != expected_uploads[logical]:
                raise RuntimeError('Application startup changed source uploads')
        workers = ['worker'] + (['beat'] if 'beat' in config['services'] else [])
        state['phase'] = 'activating'; save(state_path, state); activated = True
        docker.run(base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '240', *workers])
        collect(workers)
        docker.run(base + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '180', 'proxy'])
        collect(('proxy',))
        state.update(phase='complete', containers=ids, completed_utc=now(), source_frozen=True,
                     full_database_verified=True, uploaded_files_verified=True)
        save(state_path, state)
        for file in (target / '.env', target / 'images.env'): file.chmod(0o600)
        shutil.copytree(payload / 'maintenance', target / 'updates')
        if (target / 'ctl.sh').is_file():
            (target / 'ctl.sh').chmod(0o700)
        assign_owner(target, args.owner)
        print('IMPORT PASSED. Full Smart restored. Source remains stopped. Destination: http://' + str(args.ip) + ':3300', flush=True)
    except BaseException:
        if retry_authorized:
            state.update(phase='recovery-required', activation_attempted=bool(activated or state.get('activation_attempted')))
            save(state_path, state)
        if project and resources_reserved:
            for cid in docker.run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + project]).decode().split():
                info = docker.inspect(cid)
                if owned_target_service(info, project, target, resources_reserved):
                    docker.run(['docker', 'stop', '--time', '120', cid])
        if retry_authorized: assign_owner(target, args.owner)
        print('Import stopped. Source snapshot and target data are preserved; no volume was overwritten.', file=sys.stderr)
        raise


def resume_source(args):
    stack = args.stack.resolve(); lock = stack / '.offline-update-lock'
    owner = json.loads((lock / 'owner.json').read_text(encoding='utf-8'))
    if owner.get('mode') != 'server-migration' or not args.destination_not_activated:
        raise ValueError('Only this migration can resume its source, before destination activation')
    stage = Path(owner['backup'])
    docker = Docker(stage)
    containers = json.loads((stage / 'source-containers.private.json').read_text(encoding='utf-8'))
    resume_exact(docker, containers)
    save(stage / 'SOURCE-RESUMED.json', {'source_resumed': True, 'destination_not_activated_asserted': True})
    (lock / 'owner.json').unlink(); lock.rmdir()
    print('SOURCE RESUMED. The previous export is now a backup, not a current cutover snapshot.', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    export = modes.add_parser('export', help='Freeze existing Smart and create one complete restored-and-verified archive')
    export.add_argument('--stack', type=Path, required=True)
    export.add_argument('--tools', type=Path, default=Path.cwd())
    export.add_argument('--out', type=Path, required=True)
    export.add_argument('--source-ip', type=ipaddress.IPv4Address, default=ipaddress.IPv4Address('10.15.3.187'))
    install = modes.add_parser('import', help='Restore into new resources on the destination; never overwrite')
    install.add_argument('--bundle', type=Path, required=True)
    install.add_argument('--target', type=Path, required=True)
    install.add_argument('--ip', type=ipaddress.IPv4Address, required=True)
    install.add_argument('--project')
    install.add_argument('--owner', help='Owner of new host installation files, e.g. SSH user')
    install.add_argument('--resume-preflight', action='store_true', help='Continue the same verified snapshot only after a failure before any Docker resources were created')
    resume = modes.add_parser('resume-source', help='Cancel cutover only while the destination has never been activated')
    resume.add_argument('--stack', type=Path, required=True)
    resume.add_argument('--destination-not-activated', action='store_true', required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    if sys.platform != 'linux': raise ValueError('Run the operator on the Linux Docker server')
    if args.mode == 'export': export_source(args)
    elif args.mode == 'import': import_target(args)
    else: resume_source(args)


if __name__ == '__main__':
    try:
        main()
    except BaseException as exc:
        if isinstance(exc, SystemExit): raise
        print('MIGRATION STOPPED: ' + str(exc), file=sys.stderr)
        raise SystemExit(1)
