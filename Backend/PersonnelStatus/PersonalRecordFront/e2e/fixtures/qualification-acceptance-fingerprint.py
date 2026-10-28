"""Read-only hashes of every table in the exact owned qualification fixture."""
import hashlib
import json
import os
import re
import django
django.setup()
from django.conf import settings
from django.db import connection, transaction
from organization_management.apps.audit.domain.models import AuditLog as CoreAuditLog
from organization_management.apps.employees.models import EmployeeServiceProfile
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification

marker = os.environ.get('QUALIFICATION_ACCEPTANCE_STAND_MARKER', '')
database = os.environ.get('QUALIFICATION_ACCEPTANCE_DATABASE', '')
if (os.environ.get('QUALIFICATION_ACCEPTANCE_READ') != '1' or
        not re.fullmatch(r'qualification-browser-[a-f0-9]{10}', marker) or
        marker != os.environ.get('FIXTURE_STAND_MARKER') or
        database != 'sj_qualification_acceptance_' + marker.replace('-', '_') or
        settings.DATABASES['default']['NAME'] != database or settings.DATABASES['default']['HOST'] != 'db'):
    raise RuntimeError('Read only the exact explicitly identified owned qualification database.')
tables = {}
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        for name in [row[0] for row in cursor.fetchall()]:
            cursor.execute('SELECT to_jsonb(t)::text FROM ' + connection.ops.quote_name(name) + ' t ORDER BY 1')
            digest, count = hashlib.sha256(), 0
            for row in cursor.fetchall():
                digest.update(row[0].encode('utf8')); digest.update(b'\n'); count += 1
            tables[name] = {'rows': count, 'sha256': digest.hexdigest()}
audit_tables = sorted({CoreAuditLog._meta.db_table, OpsAuditLog._meta.db_table})
print(json.dumps({'complete': True, 'readOnly': True, 'database': database, 'standMarker': marker,
    'tables': tables, 'auditTables': audit_tables,
    'businessTables': sorted({*audit_tables, EmployeeServiceProfile._meta.db_table, OpsEmployeeQualification._meta.db_table})}, sort_keys=True))
