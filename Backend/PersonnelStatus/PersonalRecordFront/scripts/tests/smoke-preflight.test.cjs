const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const ts = require('typescript');

// Execute the real hook lifecycle with a private environment. Every dependency
// capable of network access, authentication, subprocesses or cleanup is mocked.
function hooks(options = {}) {
  const env = { SMOKE_LIVE: '1', ...options.env };
  const calls = { stand: 0, reservations: 0, auth: 0, cleanup: [], preparationFlags: [] };
  const recordCleanup = name => { calls.cleanup.push(name); };
  function execFile() { throw new Error('Uncontrolled callback subprocess'); }
  execFile[promisify.custom] = async (_python, args) => {
    if (args[1] !== 'reserve_e2e_fixture_dates') {
      recordCleanup('subprocess');
      return { stdout: 'mocked cleanup' };
    }
    calls.reservations++;
    calls.preparationFlags.push(env.STAND_PREFLIGHT_FAILED);
    if (options.reservationError) throw new Error('reservation failed');
    return { stdout: options.stdout ?? JSON.stringify({ businessDate: '2040-01-01', count: 256 }) };
  };
  const dependencies = {
    'node:child_process': { execFile },
    'node:fs': { existsSync: () => options.filesExist !== false },
    'node:path': path,
    'node:util': { promisify },
    './backend-layout': { findBackendRoot: () => '/virtual/backend' },
    './purge-python': { resolvePurgeTarget: async () => {
      if (options.targetError) throw new Error('target unavailable');
      return { backendRoot: '/virtual/backend', python: '/virtual/python' };
    } },
    './stand-alive': { standVerdict: async () => {
      calls.stand++;
      calls.preparationFlags.push(env.STAND_PREFLIGHT_FAILED);
      if (options.standError) throw new Error('stand probe failed');
      return options.alive === false ? { alive: false, url: 'mock-stand', why: 'offline' } : { alive: true };
    } },
    './stand-credentials': { STAND_USERNAME: 'mock-user', STAND_PASSWORD: 'mock-password' },
    './probe-events': {
      probeToken: async () => { calls.auth++; return 'mock-token'; },
      dropProbeEvents: async () => { recordCleanup('events'); return { dropped: 0, refused: 0 }; },
    },
    './probe-statuses': {
      dropProbeStatuses: async () => { recordCleanup('statuses'); return { closed: 0, refused: 0, broke: null }; },
      dropOpsProbeStatuses: async () => { recordCleanup('ops statuses'); return { closed: 0, refused: 0, sameDay: 0, broke: null }; },
    },
  };
  function load(name) {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '../../e2e', name + '.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText, {
      exports, __dirname: '/virtual/frontend/e2e', process: { env },
      console: { log() {} },
      fetch: async () => { recordCleanup('HTTP mutation'); return { ok: true, status: 200 }; },
      require: id => {
        if (!(id in dependencies)) throw new Error('Uncontrolled hook dependency: ' + id);
        return dependencies[id];
      },
    });
    return exports;
  }
  const setup = load('global-setup');
  dependencies['./global-setup'] = setup;
  return { env, calls, setup: setup.default, teardown: load('global-teardown').default };
}

test('an alive stand followed by a failed date reservation prevents all teardown authentication and mutations', async () => {
  const lifecycle = hooks({ reservationError: true });
  await assert.rejects(lifecycle.setup({ workers: 1 }), /reservation failed/);
  await lifecycle.teardown();
  assert.equal(lifecycle.calls.reservations, 1);
  assert.equal(lifecycle.env.STAND_PREFLIGHT_FAILED, '1');
  assert.equal(lifecycle.calls.auth, 0);
  assert.deepEqual(lifecycle.calls.cleanup, []);
  assert.equal(lifecycle.calls.stand, 1, 'failed preparation must not trigger postflight work');
});

for (const [name, options, error] of [
  ['dead stand', { alive: false }, /прогон не начат/],
  ['rejected stand probe', { standError: true }, /stand probe failed/],
  ['missing command files', { filesExist: false }, /manage.py/],
  ['failed Python resolution', { targetError: true }, /target unavailable/],
  ['invalid reservation JSON', { stdout: 'not JSON' }, /JSON/],
  ['invalid reservation count', { stdout: JSON.stringify({ businessDate: '2040-01-01', count: 1 }) }, /некорректную бронь/],
]) test(`${name} keeps teardown disabled`, async () => {
  const lifecycle = hooks(options);
  await assert.rejects(lifecycle.setup({ workers: 1 }), error);
  await lifecycle.teardown();
  assert.equal(lifecycle.env.STAND_PREFLIGHT_FAILED, '1');
  assert.equal(lifecycle.calls.auth, 0);
  assert.deepEqual(lifecycle.calls.cleanup, []);
});

test('the failure mark covers all preparation and clears only after a fully successful setup', async () => {
  const lifecycle = hooks({ env: { STAND_PREFLIGHT_FAILED: '1' } });
  await lifecycle.setup({ workers: 1 });
  assert.deepEqual(lifecycle.calls.preparationFlags, ['1', '1']);
  assert.equal(lifecycle.env.STAND_PREFLIGHT_FAILED, undefined);
  assert.equal(lifecycle.env.E2E_FIXTURE_DATE_RANGE_START, '2040-01-01');
  assert.equal(lifecycle.env.E2E_FIXTURE_DATE_RANGE_DAYS, '256');
  await lifecycle.teardown();
  assert.equal(lifecycle.calls.auth, 1, 'ordinary cleanup remains available after successful preparation');
  assert.ok(lifecycle.calls.cleanup.includes('events'));
});

test('non-live hooks never prepare, authenticate or mutate', async () => {
  const lifecycle = hooks({ env: { SMOKE_LIVE: undefined } });
  await lifecycle.setup({ workers: 1 });
  await lifecycle.teardown();
  assert.equal(lifecycle.calls.stand, 0);
  assert.equal(lifecycle.calls.reservations, 0);
  assert.equal(lifecycle.calls.auth, 0);
  assert.deepEqual(lifecycle.calls.cleanup, []);
});
