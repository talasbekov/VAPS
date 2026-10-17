import { expect, test } from '@playwright/test'
import { dockerBackendInvocation } from './backend-command'
import { futureExpenseOverrideCommand } from './autonomous-global-setup'

test('Docker commands preserve exact arguments and only forward explicit environment overrides', () => {
  const script = 'print("fixture with spaces")\nprint("second line")'
  const invocation = dockerBackendInvocation('smart-soak-20261007-backend-1', ['shell', '-c', script], { FIXTURE_SNAPSHOT: '{"id":1}', DJANGO_SETTINGS_MODULE: 'settings.test' })
  expect(invocation.executable).toBe('docker')
  expect(invocation.args).toEqual(['exec', '-e', 'FIXTURE_SNAPSHOT={"id":1}', '-e', 'DJANGO_SETTINGS_MODULE=settings.test', 'smart-soak-20261007-backend-1', 'python', 'manage.py', 'shell', '-c', script])
  expect(invocation.args.join(' ')).not.toContain('PR_DB_PORT')
})

test('Docker helper rejects an empty container name and invalid environment names', () => {
  expect(() => dockerBackendInvocation('', ['check'])).toThrow(/container/i)
  expect(() => dockerBackendInvocation('stand', ['check'], { 'bad=name': 'value' })).toThrow(/environment/i)
})

test('Docker fixtures keep container settings instead of the known legacy local PostgreSQL override', () => {
  const legacy = 'organization_management.config.settings.local_postgres'
  for (const flags of [[`--settings=${legacy}`], ['--settings', legacy]]) {
    const invocation = dockerBackendInvocation('stand', ['reserve_e2e_fixture_dates', '--count', '256', ...flags], { DJANGO_SETTINGS_MODULE: legacy, FIXTURE_MARKER: 'own-fixture' })
    expect(invocation.args).toEqual(['exec', '-e', 'FIXTURE_MARKER=own-fixture', 'stand', 'python', 'manage.py', 'reserve_e2e_fixture_dates', '--count', '256'])
  }
})

test('Docker fixtures retain explicit custom Django settings and identical text inside Python scripts', () => {
  const script = 'print("--settings=organization_management.config.settings.local_postgres")'
  const invocation = dockerBackendInvocation('stand', ['shell', '-c', script, '--settings=custom_validation_settings'], { DJANGO_SETTINGS_MODULE: 'custom_validation_settings' })
  expect(invocation.args).toEqual(['exec', '-e', 'DJANGO_SETTINGS_MODULE=custom_validation_settings', 'stand', 'python', 'manage.py', 'shell', '-c', script, '--settings=custom_validation_settings'])
})

const isolatedExpenseEnv = { AUTONOMOUS_ALLOW_FUTURE_EXPENSE: '1', SMOKE_LIVE: '1', SMOKE_APP: 'http://127.0.0.1:3345', SMOKE_BASE_URL: 'http://127.0.0.1:3345', SMOKE_API: 'http://127.0.0.1:18345', PR_DB_HOST: '127.0.0.1', PR_DB_PORT: '15345', PR_DB_NAME: 'isolated_validation', SMOKE_DOCKER_CONTAINER: 'smart-soak-20261007-backend-1', SMOKE_USERNAME: 'admin' }
test('Future expense command requires explicit opt-in and rejects shared stand targets', () => {
  for (const override of [{ AUTONOMOUS_ALLOW_FUTURE_EXPENSE: '0' }, { SMOKE_API: 'http://127.0.0.1:8100' }, { SMOKE_APP: 'http://localhost:3106' }, { PR_DB_PORT: '5434' }, { PR_DB_HOST: 'shared-postgres' }, { SMOKE_DOCKER_CONTAINER: 'shared-backend' }, { SMOKE_USERNAME: '' }]) {
    expect(() => futureExpenseOverrideCommand({ ...isolatedExpenseEnv, ...override })).toThrow()
  }
})

test('Future expense command sends the actor as structured environment and keeps host database credentials outside Docker', () => {
  const command = futureExpenseOverrideCommand(isolatedExpenseEnv)
  const invocation = dockerBackendInvocation(isolatedExpenseEnv.SMOKE_DOCKER_CONTAINER, command.args, command.env)
  expect(invocation.args.slice(0, 8)).toEqual(['exec', '-e', 'E2E_FIXTURE_OVERRIDE_USERNAME=admin', 'smart-soak-20261007-backend-1', 'python', 'manage.py', 'shell', '-c'])
  expect(invocation.args.join(' ')).not.toContain('PR_DB_PASSWORD')
})
