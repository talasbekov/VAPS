#!/usr/bin/env python3
"""Check/apply the original Akorda data on the existing Smart server."""
import argparse
from datetime import date, datetime
import hashlib
import importlib.util
import io
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib import error, parse, request
import uuid

HERE = Path(__file__).resolve().parent
DATA_NAME = 'SMART-AKKORDA-2026-10-20.tar.gz'
DATA_SHA256 = '0167b449b40746fb870db518122dce11fd91357dbe8fcb7341913bb55b78c640'
BATCH_ID = 'akorda-initial-profiles-20261020'

spec = importlib.util.spec_from_file_location('smart_data_transition', HERE / 'update-with-migrations.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def strict_json(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError('Repeated JSON key')
            result[key] = item
        return result
    return json.loads(value, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


def positive_id(value):
    text = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,18}', text) or int(text) > 2**63 - 1:
        raise ValueError('A positive production ID is required')
    return text


def read_delivery(path, *, expected_sha256=DATA_SHA256):
    """Verify the original archive and all nested hashes without extracting it."""
    path = Path(path)
    if path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError('Unexpected data archive size')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('Original Smart data archive SHA256 mismatch')
    files = {}
    root = 'SMART-AKKORDA-2026-10-20/'
    wanted = {'README.md', 'OBJECT-IMPORT.md', 'manifest.json', 'SHA256SUMS',
              'payload/object.json', 'payload/tools/object_catalog_transfer.py',
              'payload/tools/initialize_service_profiles.py'}
    directories = {root.rstrip('/'), root + 'payload', root + 'payload/tools'}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members) > 16:
            raise ValueError('Unexpected archive inventory')
        seen = set()
        for member in members:
            name = member.name.rstrip('/')
            if name in seen or '..' in PurePosixPath(name).parts or name.startswith('/'):
                raise ValueError('Unsafe data archive member')
            seen.add(name)
            if member.isdir() and name in directories:
                continue
            if (not member.isfile() or not name.startswith(root)
                    or name[len(root):] not in wanted or member.size > 3 * 1024 * 1024):
                raise ValueError('Unexpected data archive member')
            files[name[len(root):]] = archive.extractfile(member).read()
    if set(files) != wanted:
        raise ValueError('Incomplete Smart data archive')
    checksums = {}
    for line in files['SHA256SUMS'].decode('utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match or match[2] in checksums:
            raise ValueError('Invalid internal checksum list')
        checksums[match[2]] = match[1]
    if set(checksums) != wanted - {'SHA256SUMS'}:
        raise ValueError('Incomplete internal checksum list')
    for name, digest in checksums.items():
        if hashlib.sha256(files[name]).hexdigest() != digest:
            raise ValueError('Internal data checksum mismatch')
    manifest = strict_json(files['manifest.json'])
    bound = wanted - {'manifest.json', 'SHA256SUMS'}
    if (manifest.get('targetServer') != 'smart' or manifest.get('posts') != 20
            or set(manifest.get('files', {})) != bound
            or any(manifest['files'][name] != checksums[name] for name in bound)):
        raise ValueError('Data manifest does not match Smart delivery')
    return {'bundle': strict_json(files['payload/object.json']),
            'catalog_source': files['payload/tools/object_catalog_transfer.py'].decode('utf-8'),
            'profiles_source': files['payload/tools/initialize_service_profiles.py'].decode('utf-8')}


def validate_receipt(value, bundle, department_id, department_name):
    try:
        if (value['format'] != 'smart-object-transfer-receipt/v1' or value['applied'] is not True
                or value['exportId'] != bundle['exportId'] or value['bundleSha256'] != bundle['bundleSha256']
                or value['source'] != {key: bundle['source'][key] for key in ('namespace', 'objectId')}
                or value['target']['departmentId'] != department_id
                or value['target']['departmentName'] != department_name):
            raise ValueError('Receipt does not confirm this production import')
        positive_id(value['target']['objectId'])
        for kind, expected in (
            ('sectors', {sector['id'] for sector in bundle['sectors']}),
            ('posts', {post['id'] for sector in bundle['sectors'] for post in sector['posts']}),
        ):
            if set(value[kind]) != expected:
                raise ValueError('Incomplete target mapping')
            ids = [positive_id(entry['id']) for entry in value[kind].values()]
            if len(ids) != len(set(ids)):
                raise ValueError('Duplicate target mapping')
    except (KeyError, TypeError) as exc:
        raise ValueError('Invalid production import receipt') from exc


REMOTE_SOURCE = r'''
import json,sys,types
def main():
    payload=json.load(sys.stdin)
    import django
    django.setup()
    from django.db import connection,transaction
    checks=types.ModuleType('smart_data_checks')
    exec(payload['checks_source'],checks.__dict__)
    action=payload['action']
    with transaction.atomic():
        with connection.cursor() as cursor:
            if action!='apply':
                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            cursor.execute('SHOW transaction_read_only')
            if cursor.fetchone()[0] != ('off' if action=='apply' else 'on'):
                raise ValueError('Incorrect transaction write mode')
            if action=='apply':
                cursor.execute("SET LOCAL lock_timeout='15s'")
                cursor.execute("SET LOCAL statement_timeout='15min'")
                cursor.execute('LOCK TABLE '+','.join('public.'+connection.ops.quote_name(t) for t in sorted(payload['before']['tables']))+' IN ACCESS EXCLUSIVE MODE')
                if checks.capture()!=payload['before']:
                    raise ValueError('Frozen production snapshot changed')
        if action=='ids':
            from django.contrib.auth import get_user_model
            from organization_management.apps.divisions.models import Division
            return {'users':[{'id':str(u.pk),'name':u.get_username()} for u in get_user_model().objects.filter(is_active=True).order_by('pk')],
                    'departments':[{'id':str(d.pk),'name':d.name} for d in Division.objects.filter(division_type='department',is_active=True,archived_at__isnull=True).order_by('pk')]}
        if checks.pending_plan():
            raise ValueError('Update Smart and apply the current release migrations first')
        catalog=types.ModuleType('smart_data_catalog')
        profiles=types.ModuleType('smart_data_profiles')
        exec(payload['catalog_source'],catalog.__dict__)
        exec(payload['profiles_source'],profiles.__dict__)
        args={'actor_id':payload['actor_id'],'department_id':payload['department_id'],
              'expected_department_name':payload['department_name'],
              'target_object_id':payload.get('target_object_id'),'mapping':payload.get('mapping')}
        # Validate both permissions and operations before any sequence can advance.
        planned_catalog=catalog.import_bundle(payload['bundle'],**args,apply=False)
        planned_profiles=profiles.initialize(actor_id=payload['actor_id'],batch_id=payload['batch_id'],apply=False)
        if action=='check':
            return {'catalog':planned_catalog,'profiles':planned_profiles}
        if action!='apply':
            raise ValueError('Unknown data action')
        result={'catalog':catalog.import_bundle(payload['bundle'],**args,apply=True),
                'profiles':profiles.initialize(actor_id=payload['actor_id'],batch_id=payload['batch_id'],apply=True)}
        after=checks.capture()
        from organization_management.apps.operations.models_object import OpsSecurityObject,OpsObjectSector,OpsSecurityPost
        from organization_management.apps.operations.models_audit import OpsAuditLog
        from organization_management.apps.employees.models import EmployeeServiceProfile
        from organization_management.apps.audit.domain.models import AuditLog
        models=(OpsSecurityObject,OpsObjectSector,OpsSecurityPost,OpsAuditLog,EmployeeServiceProfile,AuditLog)
        allowed={m._meta.db_table for m in models}
        before=payload['before']
        if after['schema']!=before['schema'] or set(after['tables'])!=set(before['tables']):
            raise ValueError('Data import changed the database schema')
        if after['seed_keys']!=before['seed_keys']:
            raise ValueError('Data import changed permission or migration identities')
        for table in before['tables']:
            if table not in allowed and after['tables'][table]!=before['tables'][table]:
                raise ValueError('Data import changed unrelated rows')
        mutable=set()
        with connection.cursor() as cursor:
            for model in models:
                cursor.execute('SELECT pg_get_serial_sequence(%s,%s)',[model._meta.db_table,model._meta.pk.column])
                value=cursor.fetchone()[0]
                if value:
                    mutable.add(value.rsplit('.',1)[-1].strip('"'))
        for name,state in before['sequences'].items():
            if name not in mutable and after['sequences'].get(name)!=state:
                raise ValueError('Data import changed an unrelated sequence')
        result['after']=after
        return result
try:
    print(json.dumps(main(),ensure_ascii=False,sort_keys=True))
except Exception as exc:
    code=str(exc) if type(exc).__name__=='TransferError' else 'DATA_OPERATION_FAILED'
    print(json.dumps({'error':code}),file=sys.stderr)
    raise SystemExit(1)
'''


def run_remote(owner, action, payload, *, readonly):
    data = {**payload, 'action': action, 'batch_id': BATCH_ID,
            'checks_source': engine.CHECK_SOURCE}
    identity = []
    if action == 'apply':
        live = owner.live_data
        if (not re.fullmatch(r'sj-data-live-[0-9a-f]{32}', live['container'])
                or live['label'] != 'sj-data-live=' + live['container']):
            raise ValueError('Invalid live data writer identity')
        identity = ['--name', live['container'], '--label', live['label']]
    command = owner.base + ['run', '--rm', '--no-deps', '-T', '-i', *identity,
        '-e', 'PGOPTIONS=-c default_transaction_read_only=' + ('on' if readonly else 'off'),
        '--entrypoint', 'python', 'backend', '-c', REMOTE_SOURCE]
    with tempfile.TemporaryFile() as stream:
        stream.write(json.dumps(data).encode('utf-8'))
        stream.seek(0)
        return strict_json(engine.base.run(command, stdin=stream,
            env={**os.environ, 'BACKEND_IMAGE': owner.new_backend}))


def inspect_live_writer(identity):
    """Observe only this invocation's writer; never stop or delete another one."""
    status = {'state': 'unknown', 'closure_confirmed': False}
    try:
        name, label = identity['container'], identity['label']
        if not re.fullmatch(r'sj-data-live-[0-9a-f]{32}', name) or label != 'sj-data-live=' + name:
            return status
        found = engine.base.run(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).split()
        if not found:
            # An interrupted create/start request can still be pending in Docker.
            # Absence in one probe does not prove that an uncertain writer is closed.
            return {'state': 'not-found', 'closure_confirmed': False}
        if len(found) != 1:
            return status
        current = engine.base.inspect(found[0])
        if (current['Config'].get('Labels') or {}).get('sj-data-live') != name:
            return {'state': 'ownership-mismatch', 'closure_confirmed': False}
        state = current['State']
        observed = state.get('Status')
        if observed not in {'created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'}:
            observed = 'unknown'
        return {'container_id': current['Id'], 'state': observed,
                'closure_confirmed': state.get('Running') is False and observed in {'exited', 'dead'}
                                     and not state.get('Restarting', False),
                'ownership_confirmed': True}
    except BaseException:
        # Even a second interruption or Docker outage must leave recoverable evidence.
        return status


class DataImport(engine.TransitionUpdate):
    def require_ready(self):
        self.require_current_schema()
        current = engine.base.inspect(self.old_backend)
        reviewed = engine.base.inspect(self.new_backend)
        expected_label = hashlib.sha256(engine.app.ENTRYPOINT.encode('utf-8')).hexdigest()
        if (current['RootFS']['Layers'][:-1] != reviewed['RootFS']['Layers']
                or current['Config'].get('Cmd') != reviewed['Config'].get('Cmd')
                or current['Config'].get('Entrypoint') != ['/bin/sh', '/sj-app-only-entrypoint.sh']
                or (current['Config'].get('Labels') or {}).get('smart-josparlau.app-only-entrypoint') != expected_label
                or self.old_frontend != engine.base.inspect(self.new_frontend)['Id']
                or self.old_proxy != engine.base.inspect(self.new_proxy)['Id']):
            raise RuntimeError('Install this complete application update first; data import will not change images')

    def prepare_live_writer(self, folder):
        name = 'sj-data-live-' + uuid.uuid4().hex
        self.live_data = {'container': name, 'label': 'sj-data-live=' + name}
        self.live_data_writer = {'state': 'prepared', 'closure_confirmed': False}
        engine.base.save_json(folder / 'live-data.json', self.live_data)
        if hasattr(self, 'lock_owner'):
            self.lock_owner.update(live_data=self.live_data, live_data_writer=self.live_data_writer)
            engine.base.save_json(self.lock_path, self.lock_owner)

    def record_data_recovery(self, folder, *, attempted, committed):
        self.live_data_writer = (inspect_live_writer(self.live_data) if attempted else
                                 {'state': 'not-attempted', 'closure_confirmed': True})
        report = {'live_write_attempted': attempted, 'commit_confirmed': committed,
                  'application_closure_confirmed': self.application_closure_confirmed,
                  'live_data': getattr(self, 'live_data', None), 'live_data_writer': self.live_data_writer,
                  'database_restored': False,
                  'instruction': 'Keep application closed. Preserve dump and lock. Inspect the exact named/labeled writer in live-data.json and confirm it has exited before recovery. Review durable audits and retry the same export and fixed batch only after recovery review; never seed or automatically restore the working volume.'}
        if hasattr(self, 'lock_owner'):
            self.lock_owner.update(phase='data-recovery-required', live_data=report['live_data'],
                                  live_data_writer=self.live_data_writer,
                                  application_closure_confirmed=self.application_closure_confirmed)
        try:
            if folder.exists():
                engine.base.save_json(folder / 'DATA-RECOVERY-REQUIRED.json', report)
        finally:
            if hasattr(self, 'lock_owner'):
                engine.base.save_json(self.lock_path, self.lock_owner)

    def apply_data(self, folder, payload):
        self.recovery_required = False
        self.require_ready()
        self.check_space(folder)
        before = uploads = None
        stopped = attempted = committed = False
        try:
            stopped = True
            print('Stopping application writers before the data backup; PostgreSQL remains running.', flush=True)
            engine.base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', *self.schedulers])
            engine.base.run(self.base + ['stop', '-t', '600', 'worker'])
            worker = engine.base.inspect(self.ids['worker'])['State']
            if worker.get('OOMKilled') or worker.get('ExitCode') == 137:
                raise RuntimeError('Worker did not drain cleanly')
            before, uploads = self.database_snapshot(), self.upload_snapshot()
            self.backup(folder, uploads=True)
            engine.base.save_json(folder / 'database-before.json', before)
            engine.base.save_json(folder / 'uploads-before.json', uploads)
            restored = self.rehearse_transition(folder, before, no_migrations=True)
            if restored != before:
                raise RuntimeError('Independent backup restore did not reproduce the frozen database')
            engine.base.save_json(folder / 'data-backup-verified.json', {
                'database_dump_sha256': engine.base.sha(folder / 'database.dump'),
                'independently_restored': True, 'restored_snapshot_matches_frozen_database': True,
                'no_pending_migrations': True})
            if self.database_snapshot() != before or self.upload_snapshot() != uploads:
                raise RuntimeError('Data changed during maintenance; inspect external writers')
            self.verify_database_identity()
            self.prepare_live_writer(folder)
            attempted = True
            result = run_remote(self, 'apply', {**payload, 'before': before}, readonly=False)
            committed = True
            self.live_data_writer = {'state': 'completed', 'closure_confirmed': True}
            validate_receipt(result['catalog'], payload['bundle'], payload['department_id'], payload['department_name'])
            if result['profiles'].get('batch_id') != BATCH_ID or result['profiles'].get('mode') != 'apply':
                raise RuntimeError('Profile initialization did not confirm the fixed production batch')
            if self.database_snapshot() != result['after'] or self.upload_snapshot() != uploads:
                raise RuntimeError('Data changed after the guarded import transaction')
            self.verify_database_identity()
            engine.base.save_json(folder / 'database-after-data.json', result['after'])
            engine.base.save_json(folder / 'smart-applied.json', result['catalog'])
            engine.base.save_json(folder / 'profiles-applied.json', result['profiles'])
            self.start_application()
            if self.database_snapshot() != result['after'] or self.upload_snapshot() != uploads:
                raise RuntimeError('Application startup changed data before background jobs resumed')
            self.verify_database_identity()
            self.start_writers()
            engine.base.save_json(folder / 'DATA-SUCCESS.json', {
                'batch_id': BATCH_ID, 'export_id': payload['bundle']['exportId'],
                'backup_restored_and_verified': True, 'catalog_and_profiles_committed_together': True,
                'database_container_unchanged': True, 'database_volume': self.volume,
                'live_data': self.live_data, 'live_data_writer': self.live_data_writer,
                'receipt': 'smart-applied.json'})
            print('DATA IMPORT PASSED. Target receipt and verified backup: ' + str(folder), flush=True)
        except BaseException:
            if stopped:
                self.recovery_required = True
                self.application_closure_confirmed = False
                try:
                    engine.base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                    self.application_closure_confirmed = True
                    self.verify_database_identity()
                    if attempted or (before is not None and self.database_snapshot() != before) or (
                            uploads is not None and self.upload_snapshot() != uploads):
                        raise RuntimeError('Keep ingress closed; review the preserved backup and durable import audits')
                    # No live write was attempted. Resume the same installed images.
                    self.start_application()
                    if before is not None and self.database_snapshot() != before:
                        raise RuntimeError('Application startup changed data')
                    self.start_writers()
                    self.recovery_required = False
                finally:
                    if self.recovery_required:
                        try:
                            engine.base.run(self.base + ['stop', '-t', '120', 'proxy', 'frontend', 'backend', 'worker', *self.schedulers])
                            self.application_closure_confirmed = True
                        except BaseException:
                            self.application_closure_confirmed = False
                        self.record_data_recovery(folder, attempted=attempted, committed=committed)
            raise


def execute(args, delivery):
    if args.stack is None:
        raise ValueError('--stack must explicitly select the existing Smart installation')
    payload = dict(delivery)
    if args.mode != 'ids':
        if not args.department_name.strip() or args.department_name != args.department_name.strip() or len(args.department_name) > 255:
            raise ValueError('Use the exact nonempty production department name')
        if bool(args.mapping) != bool(args.target_object_id):
            raise ValueError('--target-object-id and a host --mapping file must be supplied together')
        mapping = None
        if args.mapping:
            if args.mapping.stat().st_size > 2 * 1024 * 1024:
                raise ValueError('Mapping is too large')
            mapping = strict_json(args.mapping.read_bytes())
        payload.update(actor_id=args.actor_id, department_id=args.department_id,
                       department_name=args.department_name, target_object_id=args.target_object_id, mapping=mapping)
    args.stack = args.stack.resolve()
    lock = args.stack / '.offline-update-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('Another or interrupted update owns .offline-update-lock; inspect owner.json') from None
    owner = {'pid': os.getpid(), 'phase': 'data-' + args.mode, 'mode': 'smart-data-import',
             'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'stack': str(args.stack)}
    update = None
    try:
        engine.base.save_json(lock / 'owner.json', owner)
        update = DataImport(args)
        update.lock_owner = owner
        update.lock_path = lock / 'owner.json'
        update.load()
        if args.mode == 'ids':
            print(json.dumps(run_remote(update, 'ids', {}, readonly=True), ensure_ascii=False, indent=2))
            return
        update.require_ready()
        root = (args.backup_root or args.stack / 'backups' / 'data-imports').resolve()
        folder = root / (args.mode + '-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
        owner['backup'] = str(folder)
        engine.base.save_json(lock / 'owner.json', owner)
        if args.mode == 'check':
            result = run_remote(update, 'check', payload, readonly=True)
            if (result['catalog'].get('applied') is not False or result['profiles'].get('mode') != 'dry-run'
                    or result['profiles'].get('batch_id') != BATCH_ID):
                raise RuntimeError('Expected strictly read-only import plans')
            folder.mkdir(mode=0o700, parents=True, exist_ok=False)
            engine.base.save_json(folder / 'smart-plan.json', result['catalog'])
            engine.base.save_json(folder / 'profiles-plan.json', result['profiles'])
            print('DATA CHECK PASSED. No database or audit writes. Plans: ' + str(folder), flush=True)
        else:
            update.apply_data(folder, payload)
    finally:
        if update is not None and getattr(update, 'recovery_required', False):
            owner['phase'] = 'data-recovery-required'
            if hasattr(update, 'live_data'):
                owner['live_data'] = update.live_data
                owner['live_data_writer'] = getattr(update, 'live_data_writer', {'state': 'unknown', 'closure_confirmed': False})
            owner['application_closure_confirmed'] = getattr(update, 'application_closure_confirmed', False)
            engine.base.save_json(lock / 'owner.json', owner)
            print('RECOVERY REQUIRED. Preserve backup and lock: ' + str(lock / 'owner.json'), file=sys.stderr)
        else:
            (lock / 'owner.json').unlink(missing_ok=True)
            lock.rmdir()


def validate_origin(value):
    parsed = parse.urlsplit(value)
    hostname = parsed.hostname
    if (parsed.scheme not in ('http', 'https') or not hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Use only the externally reachable Smart http(s) origin')
    normalized_host = hostname.lower().rstrip('.')
    if normalized_host in {'localhost', 'backend', 'api', 'db', 'proxy', 'frontend', 'smart-backend'} or normalized_host.endswith('.localhost'):
        raise ValueError('Use the Smart address reachable from the twin server')
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
        if re.fullmatch(r'[0-9.]+', normalized_host):
            raise ValueError('Use a canonical network IP address or DNS name')
    if address is not None and (address.is_loopback or address.is_unspecified):
        raise ValueError('Use the Smart address reachable from the twin server')
    # Accessing .port also rejects malformed authority/port combinations.
    parsed.port
    return value.rstrip('/')


def aware_time(value):
    if not isinstance(value, str):
        raise ValueError('Expected an explicit timestamp')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError('Timestamp must include its UTC offset')
    return result


def validate_roster(value, receipt):
    target = receipt['target']
    expected = {'source': 'employee_status', 'department_id': target['departmentId'],
                'department_name': target['departmentName']}
    if not isinstance(value, dict) or value.get('scope') != expected or not isinstance(value.get('results'), list):
        raise ValueError('API did not confirm the selected department status source')
    rows = value['results']
    if (value.get('next') is not None or (isinstance(value.get('page'), dict) and value['page'].get('next') is not None)
            or ('count' in value and (type(value['count']) is not int or value['count'] != len(rows)))):
        raise ValueError('API returned an incomplete roster')
    for row in rows:
        if not isinstance(row, dict) or row.get('department_id') != target['departmentId'] or row.get('source') is not None:
            raise ValueError('API mixed another department or dispatch source')
        placement = row.get('placement')
        if not isinstance(placement, dict) or str(placement.get('object_id')) != target['objectId']:
            raise ValueError('API returned an unexpected placement')
        if 'intervals' in placement:
            if not isinstance(placement.get('time_zone'), str) or not placement['time_zone'] or not isinstance(placement['intervals'], list):
                raise ValueError('Schedule timezone must be on placement')
            for interval in placement['intervals']:
                if (not isinstance(interval, dict) or set(interval) != {'start_at', 'end_at'}
                        or aware_time(interval['start_at']) >= aware_time(interval['end_at'])):
                    raise ValueError('API returned an invalid interval')
        if 'service_profile' not in row:
            raise ValueError('Current Smart profile contract is missing')
        profile = row['service_profile']
        if profile is not None:
            if (not isinstance(profile, dict) or not {'inventory', 'skills', 'height_cm', 'weight_kg', 'health', 'updated_at'} <= set(profile)
                    or not isinstance(profile['skills'], dict) or not {'shooting', 'hand_to_hand', 'physical_fitness'} <= set(profile['skills'])
                    or not isinstance(profile['health'], dict) or not {'condition', 'chronic_conditions', 'restrictions'} <= set(profile['health'])):
                raise ValueError('API profile fields differ from the agreed contract')
    return len(rows)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_json(opener, url, *, body=None, token=None):
    headers = {'Accept': 'application/json'}
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token is not None:
        headers['Authorization'] = 'Bearer ' + token
    response = opener.open(request.Request(url, data=data, headers=headers), timeout=30)
    with response:
        raw = response.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError('Unexpected API response size')
    return strict_json(raw)


def verify_api(args, delivery):
    origin = validate_origin(args.origin)
    credentials_path = args.credentials.resolve()
    if os.name == 'posix' and stat.S_IMODE(credentials_path.stat().st_mode) & 0o077:
        raise ValueError('Credentials file must be private (chmod 600)')
    if credentials_path.stat().st_size > 8192:
        raise ValueError('Invalid private credentials file')
    credentials = strict_json(credentials_path.read_bytes())
    if (not isinstance(credentials, dict) or set(credentials) != {'username', 'password'}
            or any(not isinstance(credentials[key], str) or not credentials[key] for key in credentials)):
        raise ValueError('Private JSON must contain username and password')
    applied = strict_json(args.receipt.read_bytes())
    target = applied.get('target', {})
    validate_receipt(applied, delivery['bundle'], target.get('departmentId'), target.get('departmentName'))
    date.fromisoformat(args.date)
    opener = request.build_opener(NoRedirect())
    try:
        authentication = api_json(opener, origin + '/api/token/', body=credentials)
        token = authentication.get('access')
        if not isinstance(token, str) or not token:
            raise ValueError('Smart authentication failed')
        obj = api_json(opener, origin + '/api/ops/objects/' + target['objectId'] + '/', token=token)
        if str(obj.get('id')) != target['objectId']:
            raise ValueError('Object API did not return the imported target object')
        present = {str(post['id']) for sector in obj.get('sectors', []) for post in sector.get('posts', [])}
        if not {entry['id'] for entry in applied['posts'].values()} <= present:
            raise ValueError('Object API is missing imported target posts')
        query = parse.urlencode({'object_id': target['objectId'], 'date': args.date,
                                 'source': 'employee_status', 'department_id': target['departmentId']})
        roster = api_json(opener, origin + '/api/statuses/statuses/duty-assignments/?' + query, token=token)
        count = validate_roster(roster, applied)
    except (error.URLError, error.HTTPError, OSError, ValueError, KeyError, TypeError):
        # Do not persist or echo credentials, tokens, API bodies or personnel.
        raise ValueError('API verification failed; check address, reader permissions and contract') from None
    print('API CHECK PASSED. Selected department confirmed; complete roster rows: ' + str(count) + '.')


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--stack', type=Path, help='Existing Smart installation; required for ids/check/apply')
    result.add_argument('--data-archive', type=Path, default=HERE / 'smart-data' / DATA_NAME)
    modes = result.add_subparsers(dest='mode', required=True)
    modes.add_parser('ids', help='Read active user IDs/names and active department IDs/names')
    for name in ('check', 'apply'):
        command = modes.add_parser(name)
        command.add_argument('--actor-id', required=True, type=positive_id)
        command.add_argument('--department-id', required=True, type=positive_id)
        command.add_argument('--department-name', required=True)
        command.add_argument('--target-object-id', type=positive_id)
        command.add_argument('--mapping', type=Path, help='Host JSON mapping, required together with target object ID')
        command.add_argument('--backup-root', type=Path, help='New run directory is created below this location')
    api = modes.add_parser('verify-api')
    api.add_argument('--origin', required=True)
    api.add_argument('--credentials', type=Path, required=True, help='Private JSON with username/password; never command-line secrets')
    api.add_argument('--receipt', type=Path, required=True)
    api.add_argument('--date', required=True, help='Smart calendar date, YYYY-MM-DD')
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    os.umask(0o077)
    try:
        delivery = read_delivery(args.data_archive)
        if args.mode == 'verify-api':
            verify_api(args, delivery)
        else:
            execute(args, delivery)
        return 0
    except (RuntimeError, ValueError, OSError, KeyError, TypeError, tarfile.TarError,
            KeyboardInterrupt, subprocess.SubprocessError) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
