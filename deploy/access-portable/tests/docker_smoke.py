"""Opt-in test with existing old images and disposable synthetic database."""
import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'smart-josparlau/lan-backend:1172-3f4e3ab0b62c'


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='access-1193-') as temp:
        root = Path(temp)
        project = 'access1193-' + secrets.token_hex(4)
        password = secrets.token_urlsafe(24)
        compose = {'services': {
            'db': {'image': 'postgres:16-alpine', 'environment': {'POSTGRES_PASSWORD': password,
                    'POSTGRES_USER': 'access_test', 'POSTGRES_DB': 'access_test'},
                   'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U access_test -d access_test'],
                                   'interval': '1s', 'timeout': '2s', 'retries': 30}},
            'backend': {'image': IMAGE, 'entrypoint': ['python', '-c', 'import time; time.sleep(3600)'],
                        'environment': {'POSTGRES_HOST': 'db', 'POSTGRES_DB': 'access_test',
                                        'POSTGRES_USER': 'access_test', 'POSTGRES_PASSWORD': password,
                                        'DJANGO_SECRET_KEY': secrets.token_urlsafe(48),
                                        'ALLOWED_HOSTS': 'testserver,localhost'}}}}
        (root/'compose.json').write_text(json.dumps(compose))
        (root/'ctl.sh').write_text('#!/bin/bash\nset -euo pipefail\nHERE=$(cd -- "$(dirname -- "$0")" && pwd)\nexec docker compose -p '+project+' -f "$HERE/compose.json" "$@"\n')
        def call(*args, **kwargs):
            return subprocess.run(args, cwd=root, text=True, capture_output=True, check=True, **kwargs).stdout
        def ctl(*args, **kwargs):
            return call('bash',str(root/'ctl.sh'),*args,**kwargs)
        def shell(code):
            return ctl('exec','-T','backend','python','manage.py','shell','-c',code)
        payload=(ROOT/'access_transfer.py').read_text()
        try:
            ctl('up','-d','--pull','never','--no-build','--wait','db','backend')
            ctl('exec','-T','backend','python','manage.py','migrate','--noinput')
            seed = '''
from django.contrib.auth.models import User
from organization_management.apps.operations.models import Role,Permission,RolePermission,UserRole
for name in ['portable_reader','portable_writer']:
    User.objects.create_user(name,password='synthetic-password')
for code,permission in [('PORTABLE-READ','personnel.view'),('PORTABLE-WRITE','status.manage')]:
    Role.objects.create(code=code,name=code)
    p,_=Permission.objects.get_or_create(code=permission,defaults={'name':permission})
    RolePermission.objects.create(role_code_id=code,permission_code=p)
a=User.objects.get(username='portable_reader'); b=User.objects.get(username='portable_writer')
UserRole.objects.create(user_id=str(a.pk),role_code_id='PORTABLE-READ',scope_division_id=999)
UserRole.objects.create(user_id=str(b.pk),role_code_id='PORTABLE-WRITE')
'''
            shell(seed)
            dumped=shell(payload+"\nprint('SNAPSHOT='+json.dumps(export_data()))")
            data=json.loads(next(x[len('SNAPSHOT='):] for x in dumped.splitlines() if x.startswith('SNAPSHOT=')))
            (root/'roles.json').write_text(json.dumps(data))
            shell("from organization_management.apps.operations.models import UserRole; UserRole.objects.all().delete()")
            call('python3',str(ROOT/'build.py'),str(root/'apply-access.sh'))
            preview=call('bash',str(root/'apply-access.sh'))
            assert 'ПРОВЕРКА' in preview
            assert 'COUNT=0' in shell("from organization_management.apps.operations.models import UserRole; print('COUNT='+str(UserRole.objects.count()))")
            out=call('bash',str(root/'apply-access.sh'),'--apply')
            assert 'ПРИМЕНЕНО' in out
            checks='''
from django.contrib.auth.models import User
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import PermissionService
from rest_framework.test import APIClient
a=User.objects.get(username='portable_reader'); b=User.objects.get(username='portable_writer')
assert a.check_password('synthetic-password') and b.check_password('synthetic-password')
assert PermissionService.effective_permissions(str(a.pk))=={'personnel.view'}
assert PermissionService.effective_permissions(str(b.pk))=={'status.manage'}
assert UserRole.objects.count()==2
assert not UserRole.objects.exclude(scope_division_id=None).exists()
api=APIClient(); api.force_authenticate(a); assert api.get('/api/core/employees/').status_code==200
api.force_authenticate(b); assert api.get('/api/core/employees/').status_code==403
print('ACCESS-OK')
'''
            assert 'ACCESS-OK' in shell(checks)
            repeat=call('bash',str(root/'apply-access.sh'),'--apply')
            assert 'изменено учёток: 0' in repeat
            assert 'ACCESS-OK' in shell(checks)
            reports=[json.loads(p.read_text()) for p in root.glob('.access-transfer/*/result.json')]
            assert len(reports)==3 and sum(r['applied'] for r in reports)==2
            backups=list(root.glob('.access-transfer/*/before.json'))
            assert len(backups)==2 and all(p.stat().st_mode & 0o777 ==0o600 for p in backups)
            original=next(p for p in backups if not json.loads(p.read_text())['user_roles'])
            restored=call('bash',str(root/'apply-access.sh'),'--restore',str(original),'--apply')
            assert 'ПРИМЕНЕНО' in restored
            assert 'COUNT=0' in shell("from organization_management.apps.operations.models import UserRole; print('COUNT='+str(UserRole.objects.count()))")
            print('PASS: old Docker image; actual packaged shell; preview; per-login roles; global scope; unchanged passwords; API200/403; repeat; private backups; rollback.')
        except subprocess.CalledProcessError as exc:
            # Only synthetic database; prevent dumping Compose credentials on startup errors.
            print('Docker smoke command failed, exit',exc.returncode)
            print((exc.stdout or '')[-3000:]); print((exc.stderr or '')[-3000:])
            raise
        finally:
            ctl('down','--volumes','--remove-orphans')


if __name__=='__main__':
    main()
