import type { FullConfig } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { runBackendCommand } from './backend-command'
import { fixtureRangeSize, PREFLIGHT_FAILED } from './global-setup'
import { standVerdict } from './stand-alive'

/** Building the command also guards callers that bypass the Playwright config. */
export function futureExpenseOverrideCommand(env: Readonly<Record<string, string | undefined>> = process.env): { args: string[]; env: Record<string, string> } {
  const required = { AUTONOMOUS_ALLOW_FUTURE_EXPENSE: '1', SMOKE_LIVE: '1', SMOKE_APP: 'http://127.0.0.1:3345', SMOKE_BASE_URL: 'http://127.0.0.1:3345', SMOKE_API: 'http://127.0.0.1:18345', PR_DB_PORT: '15345', SMOKE_DOCKER_CONTAINER: 'smart-soak-20261007-backend-1' }
  for (const [key, value] of Object.entries(required)) {
    if (env[key] !== value) throw new Error(`Future expense fixtures require isolated ${key}=${value}`)
  }
  if (!['127.0.0.1', 'localhost'].includes(env.PR_DB_HOST ?? '') || !env.PR_DB_NAME || !env.SMOKE_USERNAME) {
    throw new Error('Future expense fixtures require a named local database and the stand actor')
  }
  const script = [
    'import json, os',
    'from datetime import timedelta',
    'from django.contrib.auth import get_user_model',
    'from django.db import transaction',
    'from organization_management.apps.operations.clock import Clock',
    'from organization_management.apps.operations.block_override import override_tomorrow_block',
    'from organization_management.apps.operations.models_submission import OpsTomorrowBlockOverride, OpsSubmissionControlSettings',
    "actor = get_user_model().objects.get(username=os.environ['E2E_FIXTURE_OVERRIDE_USERNAME'], is_active=True)",
    'today = Clock.today_local()',
    'created = 0',
    'existing = 0',
    'with transaction.atomic():',
    "    before = list(OpsSubmissionControlSettings.objects.values('singleton_key', 'control_hour', 'required_division_ids', 'default_notify_recipient'))",
    "    today_before = list(OpsTomorrowBlockOverride.objects.filter(business_date=today).values('id', 'reason', 'overridden_by'))",
    '    for offset in range(1, 63):',
    '        business_date = today + timedelta(days=offset)',
    '        if OpsTomorrowBlockOverride.objects.filter(business_date=business_date).exists():',
    '            existing += 1',
    '            continue',
    "        override_tomorrow_block(business_date=business_date, actor=str(actor.pk), reason='AUTONOMOUS-E2E: подготовка будущего расхода на изолированном тестовом стенде')",
    '        created += 1',
    "    after = list(OpsSubmissionControlSettings.objects.values('singleton_key', 'control_hour', 'required_division_ids', 'default_notify_recipient'))",
    "    today_after = list(OpsTomorrowBlockOverride.objects.filter(business_date=today).values('id', 'reason', 'overridden_by'))",
    "    if before != after or today_before != today_after: raise RuntimeError('Expense fixture preparation changed current-day controls')",
    "print('FIXTURE_JSON=' + json.dumps({'created': created, 'existing': existing, 'days': 62, 'today': str(today), 'firstDate': str(today + timedelta(days=1)), 'lastDate': str(today + timedelta(days=62)), 'controlsPreserved': True, 'todayPreserved': True}))",
  ].join('\n')
  return { args: ['shell', '-c', script], env: { E2E_FIXTURE_OVERRIDE_USERNAME: env.SMOKE_USERNAME } }
}

async function prepareFutureExpenseFixtures(): Promise<void> {
  const command = futureExpenseOverrideCommand()
  const stdout = await runBackendCommand(command.args, { env: command.env })
  const prefix = 'FIXTURE_JSON='
  const line = stdout.split(/\r?\n/).find(row => row.startsWith(prefix))
  if (!line) throw new Error('Future expense preparation returned no fixture report')
  const report = JSON.parse(line.slice(prefix.length)) as { created: number; existing: number; days: number; controlsPreserved: boolean; todayPreserved: boolean }
  if (report.days !== 62 || report.created + report.existing !== 62 || !report.controlsPreserved || !report.todayPreserved) {
    throw new Error('Future expense preparation returned an invalid fixture report')
  }
  const resultDir = process.env.AUTONOMOUS_RUN_RESULTS_DIR
  if (!resultDir) throw new Error('Autonomous results directory is required for the expense fixture audit')
  fs.writeFileSync(path.join(resultDir, 'future-expense-fixtures.json'), JSON.stringify(report, null, 2))
}

/** Keep fixture allocation inside the exact backend serving this isolated run. */
export default async function autonomousGlobalSetup(config: FullConfig): Promise<void> {
  const verdict = await standVerdict()
  if (!verdict.alive) {
    process.env[PREFLIGHT_FAILED] = '1'
    throw new Error(`Autonomous frontend ${verdict.url} is unavailable: ${verdict.why}`)
  }
  const token = await fetch(`${process.env.SMOKE_API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.SMOKE_USERNAME ?? 'admin', password: process.env.SMOKE_PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  })
  if (token.status !== 200) {
    process.env[PREFLIGHT_FAILED] = '1'
    throw new Error(`Autonomous backend admin authentication failed: HTTP ${token.status}`)
  }
  const count = fixtureRangeSize(config.workers)
  const stdout = await runBackendCommand(['reserve_e2e_fixture_dates', '--count', String(count), '--settings=organization_management.config.settings.local_postgres'])
  const reservation = JSON.parse(stdout.trim()) as { businessDate?: string; count?: number }
  if (!reservation.businessDate || reservation.count !== count) throw new Error('Backend returned an invalid fixture date reservation')
  process.env.E2E_FIXTURE_DATE_RANGE_START = reservation.businessDate
  process.env.E2E_FIXTURE_DATE_WORKERS = String(config.workers)
  process.env.E2E_FIXTURE_DATE_RANGE_DAYS = String(count)
  if (process.env.AUTONOMOUS_ALLOW_FUTURE_EXPENSE === '1') await prepareFutureExpenseFixtures()
}
