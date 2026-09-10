import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { promisify } from 'node:util'
import ts from 'typescript'

// Execute the actual teardown branch, replacing ONLY external side effects.
// A regression must not acquire credentials, mutate a real API, or spawn purge.
function teardownHarness(preserve: string | undefined, alive = true) {
  const calls = { postflight: 0, token: 0, mutations: 0, logs: [] as string[] }
  const forbidden = () => { calls.mutations++; throw new Error('Unexpected cleanup mutation') }
  const exports: { default?: () => Promise<void> } = {}
  const dependencies: Record<string, unknown> = {
    'node:child_process': { execFile: forbidden },
    'node:fs': { existsSync: () => false },
    'node:path': path,
    'node:util': { promisify },
    './probe-events': { dropProbeEvents: forbidden, probeToken: async () => { calls.token++; return null } },
    './probe-statuses': { dropOpsProbeStatuses: forbidden, dropProbeStatuses: forbidden },
    './global-setup': { PREFLIGHT_FAILED: 'STAND_PREFLIGHT_FAILED' },
    './stand-alive': { standVerdict: async () => { calls.postflight++; return { alive, url: 'isolated-test', why: 'probe' } } },
    './stand-credentials': { STAND_USERNAME: 'not-a-real-account', STAND_PASSWORD: 'not-a-real-secret' },
  }
  const source = fs.readFileSync(path.join(__dirname, 'global-teardown.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  vm.runInNewContext(compiled, {
    exports, __dirname,
    process: { env: { SMOKE_LIVE: '1', SMOKE_PRESERVE_DATA: preserve } },
    console: { log: (message: string) => calls.logs.push(message) },
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Uncontrolled teardown dependency: ${name}`)
      return dependencies[name]
    },
  })
  return { calls, run: exports.default! }
}

for (const alive of [true, false]) {
  test(`preserve-data keeps postflight (${alive ? 'alive' : 'dead'}) and never acquires cleanup credentials`, async () => {
    const { calls, run } = teardownHarness('1', alive)
    await run()
    expect(calls.postflight).toBe(1)
    expect(calls.token).toBe(0)
    expect(calls.mutations).toBe(0)
    expect(calls.logs.join('\n')).toContain('SMOKE_PRESERVE_DATA=1')
    if (!alive) expect(calls.logs.join('\n')).toContain('НЕ ОТВЕЧАЕТ В КОНЦЕ ПРОГОНА')
  })
}

test('preserve-data is explicit opt-in; default still attempts ordinary cleanup', async () => {
  const { calls, run } = teardownHarness(undefined)
  await run()
  expect(calls.postflight).toBe(1)
  expect(calls.token).toBe(1)
  expect(calls.mutations).toBe(0) // The stub reports no credentials; no API may follow.
})
