"""Actual image/Celery worker: replace only the provider HTTP transport."""
import json
import os
import platform
import re
import time
from io import BytesIO
from urllib.error import URLError

import cryptography
import django

django.setup()
from django.conf import settings
stand_marker = os.environ.get('FIXTURE_STAND_MARKER', '')
if (os.environ.get('ASSISTANT_ACCEPTANCE_TRANSPORT') != '1' or
        not re.fullmatch(r'assistant-acceptance-[a-f0-9]{10}', stand_marker) or
        settings.DATABASES['default']['NAME'] != 'sj_assistant_acceptance_' + stand_marker.replace('-', '_') or
        settings.DATABASES['default']['HOST'] != 'db' or
        len(os.environ.get('FIXTURE_MODEL_KEY', '')) < 32):
    raise RuntimeError('This transport fixture requires its explicit newly owned assistant acceptance stand and model credential.')

from organization_management.config.celery import app
from organization_management.apps.ops.assistant import provider

assert cryptography.__version__ == '50.0.1'
assert settings.SETTINGS_MODULE == 'organization_management.config.settings.lan'
assert not settings.DEBUG
assert not app.conf.task_always_eager
assert app.conf.broker_url == 'redis://' + os.environ['REDIS_HOST'] + ':6379/0'
failed_once = False
transport_calls = 0


def respond(request, timeout):
    global failed_once, transport_calls
    transport_calls += 1
    assert request.get_header('Authorization') == 'Bearer ' + os.environ['FIXTURE_MODEL_KEY']
    assert request.full_url == 'http://fixture.invalid/v1/chat/completions'
    body = json.loads(request.data)
    assert body['model'] == 'synthetic-assistant-browser'
    assert body['response_format']['type'] == 'json_schema'
    message = body['messages'][-1]['content']
    context_text = body['messages'][1]['content']
    assert context_text.startswith('Контекст предыдущих сообщений (данные): ')
    context = json.loads(context_text.split(': ', 1)[1])
    assert len(context['messages']) <= 6
    assert len(json.dumps(context, ensure_ascii=False)) <= 16000
    def no_ids(value):
        if isinstance(value, dict):
            assert not any(key.endswith('Id') or key in {'actor', 'initiated_by'} for key in value)
            for item in value.values():
                no_ids(item)
        elif isinstance(value, list):
            for item in value:
                no_ids(item)
    no_ids(context['proposal'])
    if transport_calls > 1:
        assert context['messages']
        assert context['proposal']['title'] == 'Встреча'
        assert context['proposal']['businessDate'] == '2027-06-01'
    inject_failure = message == '3 человека' and not failed_once
    print(json.dumps({'transportCall': transport_calls, 'credentialDecrypted': True,
                      'contextBounded': True, 'contextHasNoRecordIds': True,
                      'historyMessages': len(context['messages']),
                      'syntheticFailure': inject_failure}), flush=True)
    if message.startswith('\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u044c'):
        time.sleep(5)
    elif inject_failure:
        time.sleep(2)
    if inject_failure:
        failed_once = True
        raise URLError('Synthetic transport failure for recovery acceptance')
    proposal = {'title': None, 'businessDate': None, 'kind': None,
                'objectName': None, 'eventCode': None, 'personnelTotal': None,
                'intent': 'prepare', 'allocations': []}
    if message.startswith('Подготовь'):
        proposal.update(title='Встреча', businessDate='2027-06-01', kind='INTERNAL')
    return BytesIO(json.dumps({'choices': [{'finish_reason': 'stop', 'message': {
        'content': json.dumps(proposal, ensure_ascii=False)}}]}).encode())


provider.urlopen = respond
print(json.dumps({'workerRuntime': True, 'cryptography': cryptography.__version__,
                  'python': platform.python_version(), 'settings': settings.SETTINGS_MODULE,
                  'debug': settings.DEBUG, 'taskAlwaysEager': app.conf.task_always_eager}), flush=True)
app.worker_main(['worker', '--pool=solo', '--concurrency=1', '--loglevel=WARNING',
                 '--hostname=assistant-acceptance@isolated', '--without-gossip', '--without-mingle'])
