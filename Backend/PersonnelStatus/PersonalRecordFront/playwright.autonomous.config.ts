import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import smoke from './playwright.smoke.config'
import walk from './playwright.walk.config'

// Dedicated to the disposable October validation stand. Never reuse a shared
// stand accidentally: management commands and browser tests both mutate data.
const required = {
  SMOKE_LIVE: '1',
  SMOKE_APP: 'http://127.0.0.1:3345',
  SMOKE_BASE_URL: 'http://127.0.0.1:3345',
  SMOKE_API: 'http://127.0.0.1:18345',
  PR_DB_PORT: '15345',
} as const
for (const [name, expected] of Object.entries(required)) {
  if (process.env[name] !== expected) throw new Error(`${name} must be ${expected} for autonomous validation`)
}
if (!['127.0.0.1', 'localhost'].includes(process.env.PR_DB_HOST ?? '') || !process.env.PR_DB_NAME) {
  throw new Error('Autonomous validation requires a named database on the isolated local PostgreSQL stand')
}
if (process.env.SMOKE_DOCKER_CONTAINER && process.env.SMOKE_DOCKER_CONTAINER !== 'smart-soak-20261007-backend-1') {
  throw new Error('SMOKE_DOCKER_CONTAINER must name the dedicated smart-soak-20261007 backend')
}
if (!['0', '1'].includes(process.env.AUTONOMOUS_ALLOW_FUTURE_EXPENSE ?? '0')) {
  throw new Error('AUTONOMOUS_ALLOW_FUTURE_EXPENSE must be 0 or 1')
}
if (process.env.SMOKE_MOCK_APP || process.env.NEXT_PUBLIC_OPS_MOCK_DOMAINS) {
  throw new Error('Autonomous validation requires the live backend without an application mock server')
}
process.env.SMOKE_PRESERVE_DATA = '1'

const suite = process.env.AUTONOMOUS_SUITE ?? 'live'
if (!['live', 'smoke', 'roles', 'walk', 'core', 'harness'].includes(suite)) {
  throw new Error('AUTONOMOUS_SUITE must be live, smoke, roles, walk, core or harness')
}
const resultRoot = path.resolve(process.env.AUTONOMOUS_RESULTS_DIR ?? path.join(os.tmpdir(), 'smart-soak-20261007', 'playwright'))
const repositoryRoot = path.resolve(__dirname, '../..')
const relativeResult = path.relative(repositoryRoot, resultRoot)
if (relativeResult === '' || (!relativeResult.startsWith('..') && !path.isAbsolute(relativeResult))) {
  throw new Error('AUTONOMOUS_RESULTS_DIR must be outside the Git repository')
}
const label = (process.env.AUTONOMOUS_RUN_LABEL ?? new Date().toISOString()).replace(/[^a-zA-Z0-9_.-]/g, '-')
const resultDir = path.join(resultRoot, `${suite}-${label}`)
fs.mkdirSync(resultDir, { recursive: true })
process.env.AUTONOMOUS_RUN_RESULTS_DIR = resultDir
process.env.SMOKE_RESULTS_DIR = path.join(resultDir, 'walk-details')

const smokeFiles = (Array.isArray(smoke.testMatch) ? smoke.testMatch : [smoke.testMatch])
  .filter((file): file is string => typeof file === 'string')
const classification = { live: [] as string[], intercepted: [] as string[], management: [] as string[], sourceOrApi: [] as string[], missing: [] as string[] }
for (const file of smokeFiles) {
  const filename = path.join(__dirname, 'e2e', file)
  if (!fs.existsSync(filename)) { classification.missing.push(file); continue }
  const source = fs.readFileSync(filename, 'utf8')
  // Conservative file classification: mixed specs remain in the full smoke
  // suite but cannot silently count as a complete live browser workflow.
  if (/\.\s*route\s*\(|\.fulfill\s*\(|page\.setContent\s*\(|SMOKE_MOCK_APP/.test(source)) {
    classification.intercepted.push(file)
  } else if (/resolvePurgeTarget|runBackendCommand|\.venv\/bin\/python/.test(source)) {
    classification.management.push(file)
  } else if (/page\.goto\s*\(/.test(source)) {
    classification.live.push(file)
  } else {
    classification.sourceOrApi.push(file)
  }
}
const portableLiveManagement = ['main-daily-expense-walkthrough.spec.ts', 'status-set-dialog.spec.ts']
const matches: Record<string, string[]> = {
  live: [...classification.live, ...portableLiveManagement, 'fixture-date-reservation.spec.ts'],
  smoke: smokeFiles,
  roles: ['role-accounts-walk.spec.ts'],
  walk: ['smoke-buttons.spec.ts'],
  core: ['main-om-walkthrough.spec.ts', 'main-daily-expense-walkthrough.spec.ts', 'lagging-reminders.spec.ts'],
  harness: ['backend-command.spec.ts'],
}
if (suite === 'walk' && process.env.SMOKE_PERSONAS === undefined) {
  process.env.SMOKE_PERSONAS = `${process.env.SMOKE_USERNAME ?? 'admin'},observer,erda,forces-officer`
}
fs.writeFileSync(path.join(resultDir, 'spec-classification.json'), JSON.stringify({ suite, testMatch: matches[suite], classification,
  note: 'File-level candidates can contain source assertions. Intercepted and core hybrid tests are reported separately from unmocked live browser coverage.' }, null, 2))

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? 'C:/Users/amant/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
if (!fs.existsSync(executablePath)) throw new Error(`Chromium executable is missing: ${executablePath}`)

export default defineConfig(suite === 'walk' ? walk : smoke, {
  testMatch: matches[suite],
  workers: 1,
  retries: suite === 'walk' ? 1 : 0,
  globalSetup: suite === 'harness' ? undefined : path.join(__dirname, 'e2e/autonomous-global-setup.ts'),
  globalTeardown: suite === 'harness' ? undefined : smoke.globalTeardown,
  outputDir: path.join(resultDir, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(resultDir, 'results.json') }], ['junit', { outputFile: path.join(resultDir, 'results.xml') }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  use: {
    baseURL: required.SMOKE_APP,
    headless: true,
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
})
