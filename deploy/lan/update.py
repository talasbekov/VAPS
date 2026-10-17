#!/usr/bin/env python3
"""One-command offline application update, with verified backup and no DB migrations."""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('application_update', HERE / 'update-app-only.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def clean_old_releases(update, folder, root):
    cleanup_spec = importlib.util.spec_from_file_location('release_cleanup', HERE / 'cleanup-old-releases.py')
    cleanup = importlib.util.module_from_spec(cleanup_spec)
    cleanup_spec.loader.exec_module(cleanup)
    return cleanup.cleanup_after_update(update, folder, root, HERE)


def execute(args):
    os.umask(0o077)
    args.stack = Path(args.stack or app.locate_stack()).resolve()
    lock = args.stack / '.offline-update-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('Another or interrupted update owns .offline-update-lock. Inspect owner.json; do not delete the lock blindly.')
    update = None
    owner = {'pid': os.getpid(), 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
             'stack': str(args.stack), 'phase': 'preflight'}
    try:
        app.base.save_json(lock / 'owner.json', owner)
        # Authoritative discovery occurs inside the lock, before image tags can change.
        update = app.ApplicationUpdate(args)
        platform = app.base.run(['docker', 'info', '--format', '{{.OSType}}/{{.Architecture}}']).strip()
        if platform not in ('linux/amd64', 'linux/x86_64'):
            raise RuntimeError('Linux amd64 Docker engine required')
        update.load()
        update.require_current_schema()
        if args.check:
            print('CHECK PASSED. Schema compatible; services not stopped. No migrations will run.', flush=True)
            return
        root = Path(args.backup_root or args.stack / 'backups' / 'updates').resolve()
        folder = root / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
        owner.update(phase='updating', backup=str(folder))
        app.base.save_json(lock / 'owner.json', owner)
        update.apply_without_database_changes(folder)
        if getattr(args, 'cleanup_root', None):
            try:
                clean_old_releases(update, folder, args.cleanup_root)
            except Exception as error:
                app.base.save_json(folder / 'CLEANUP.json', {'status': 'refused', 'error': str(error),
                    'application_update_succeeded': True})
                print('WARNING: Update passed; optional cleanup refused: ' + str(error), file=sys.stderr)
    finally:
        if update is not None and getattr(update, 'recovery_required', False):
            owner['phase'] = 'recovery-required'
            app.base.save_json(lock / 'owner.json', owner)
            print('RECOVERY REQUIRED. Verify application is stopped; database not restored. See ' + str(lock / 'owner.json'), file=sys.stderr)
        else:
            (lock / 'owner.json').unlink(missing_ok=True)
            lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', type=Path, help='Existing installation directory; autodetected only if unambiguous')
    parser.add_argument('--check', action='store_true', help='Check package and schema without stopping services')
    parser.add_argument('--backup-root', type=Path, help='Protected backup directory; defaults to STACK/backups/updates')
    parser.add_argument('--cleanup-root', type=Path,
        help='After success, remove verified obsolete update packages from this project updates directory; keep current and one previous release')
    args = parser.parse_args()
    try:
        execute(args)
    except (RuntimeError, OSError, ValueError, KeyboardInterrupt, subprocess.SubprocessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
