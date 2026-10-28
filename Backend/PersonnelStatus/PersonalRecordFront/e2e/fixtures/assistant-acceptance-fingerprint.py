"""Read-only fingerprints of every public table outside dialogue and audit."""
import hashlib
import json
import os
import re
import uuid
import django
django.setup()
from django.conf import settings
from django.db import connection, transaction

stand_marker = os.environ.get('ASSISTANT_ACCEPTANCE_STAND_MARKER', '')
expected_database = os.environ.get('ASSISTANT_ACCEPTANCE_DATABASE', '')
if (os.environ.get('ASSISTANT_ACCEPTANCE_FINGERPRINT') != '1' or
        not re.fullmatch(r'assistant-acceptance-[a-f0-9]{10}', stand_marker) or
        expected_database != 'sj_assistant_acceptance_' + stand_marker.replace('-', '_') or
        settings.DATABASES['default']['NAME'] != expected_database or settings.DATABASES['default']['HOST'] != 'db'):
    raise RuntimeError('Read only the exact explicitly identified assistant acceptance database on its owned stand.')
audit_task_id = os.environ.get('ASSISTANT_ACCEPTANCE_AUDIT_TASK_ID', '')
if audit_task_id:
    try:
        if str(uuid.UUID(audit_task_id)) != audit_task_id:
            raise ValueError('non-canonical task identifier')
    except ValueError as error:
        raise RuntimeError('A valid task UUID is required for the read-only persisted-task audit.') from error
from organization_management.config.celery import app
if app.conf.task_always_eager:
    raise RuntimeError('Assistant acceptance requires the actual Redis/Celery queue.')
result = {}
excluded = {'ops_assistant_tasks', 'ops_assistant_messages', 'ops_audit_logs'}
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        names = [row[0] for row in cursor.fetchall() if row[0] not in excluded]
        for name in names:
            cursor.execute('SELECT to_jsonb(t)::text FROM ' + connection.ops.quote_name(name) + ' t ORDER BY 1')
            digest, count = hashlib.sha256(), 0
            for row in cursor.fetchall():
                digest.update(row[0].encode('utf8'))
                digest.update(b'\n')
                count += 1
            result[name] = {'rows': count, 'sha256': digest.hexdigest()}
    task_audit = None
    if audit_task_id:
        from organization_management.apps.operations.models_assistant import OpsAssistantTask
        task = OpsAssistantTask.objects.get(pk=audit_task_id)
        messages = list(task.messages.order_by('id').values('role', 'text', 'request_key'))
        task_audit = {'taskId': str(task.pk), 'initiatedBy': task.initiated_by,
            'eventId': str(task.event_id) if task.event_id else None, 'revision': task.revision,
            'userMessages': [{'text': row['text'], 'requestKey': row['request_key']} for row in messages if row['role'] == 'user'],
            'assistantMessages': sum(row['role'] == 'assistant' for row in messages),
            'briefing': task.plan.get('briefing'), 'committedBriefing': task.plan.get('committedBriefing'),
            'receipts': [{'operation': row.operation_key, 'executedBy': row.executed_by} for row in task.receipts.order_by('operation_key')]}
output = {'complete': True, 'readOnly': True, 'database': expected_database, 'standMarker': stand_marker,
    'taskAlwaysEager': False, 'tables': result, 'excluded': sorted(excluded)}
if task_audit is not None:
    output['taskAudit'] = task_audit
print(json.dumps(output, sort_keys=True))
