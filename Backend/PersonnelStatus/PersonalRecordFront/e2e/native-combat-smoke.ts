import { runBackendCommandSync } from './backend-command';

/** Explicit native Windows contour, separate from every live personnel DB.
 * The normal Docker allowlists remain unchanged. Validate the actual database
 * connection before any owned-fixture mutation is admitted on this contour.
 */
export function nativeCombatSmokeDatabase(api: string, app: string): string | null {
  if (new URL(api).href !== 'http://127.0.0.1:8312/' || new URL(app).href !== 'http://127.0.0.1:3318/') return null;
  if (process.env.SMOKE_DOCKER_CONTAINER || process.env.PR_DB_HOST !== '127.0.0.1' ||
      process.env.PR_DB_PORT !== '15434' || process.env.PR_DB_NAME !== 'sj_combat_smoke' ||
      process.env.DJANGO_SETTINGS_MODULE !== 'combat_smoke_settings' || !process.env.SMOKE_PURGE_PYTHON) {
    throw new Error('Native combat smoke requires its complete isolated API/UI/database tuple');
  }
    const output = runBackendCommandSync(['shell', '-c', [
      'import json, os, uuid, urllib.request',
      'from django.conf import settings',
      'from django.db import connection',
      'from organization_management.apps.operations.models import Role',
      "assert settings.DATABASES['default']['NAME'] == 'sj_combat_smoke'",
      "assert settings.DATABASES['default']['PORT'] == '15434'",
      "assert 'smoke-files' in settings.OPS_PRIVATE_STORAGE_ROOT",
      "cursor = connection.cursor()",
      "cursor.execute('SELECT current_database()')",
      "assert cursor.fetchone()[0] == 'sj_combat_smoke'",
      "assert os.environ.get('SMOKE_PASSWORD'), 'An external smoke password is required'",
      "marker = 'SMOKE_PROOF_' + uuid.uuid4().hex",
      "Role.objects.create(code=marker, name=marker, description=marker)",
      'try:',
      "    credentials = json.dumps({'username': os.environ.get('SMOKE_USERNAME', 'admin'), 'password': os.environ['SMOKE_PASSWORD']}).encode()",
      "    login = urllib.request.Request('http://127.0.0.1:8312/api/token/', data=credentials, headers={'Content-Type': 'application/json'})",
      '    with urllib.request.urlopen(login, timeout=20) as response:',
      "        token = json.load(response)['access']",
      "    for origin in ['http://127.0.0.1:8312', 'http://127.0.0.1:3318']:",
      "        request = urllib.request.Request(origin + '/api/operations/roles/' + marker + '/', headers={'Authorization': 'Bearer ' + token})",
      '        with urllib.request.urlopen(request, timeout=20) as response:',
      '            observed = json.load(response)',
      "            assert observed.get('code') == marker and observed.get('description') == marker, 'HTTP worker is not connected to the verified copy database'",
      'finally:',
      '    Role.objects.filter(code=marker, description=marker).delete()',
      "print(json.dumps({'verified': True}))",
    ].join('\n')]);
    const lastLine = output.trim().split(/\r?\n/).at(-1) ?? '';
    if (JSON.parse(lastLine).verified !== true) throw new Error('Native smoke database verification failed');
  return 'sj_combat_smoke';
}
