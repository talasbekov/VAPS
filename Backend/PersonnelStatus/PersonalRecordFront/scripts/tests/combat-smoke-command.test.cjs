const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function helper(output) {
  const calls = [];
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../e2e/native-combat-smoke.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, URL, process: { env: {
    PR_DB_HOST: '127.0.0.1', PR_DB_PORT: '15434', PR_DB_NAME: 'sj_combat_smoke',
    DJANGO_SETTINGS_MODULE: 'combat_smoke_settings', SMOKE_PURGE_PYTHON: 'test-only-not-executed',
  } }, require: name => {
    assert.equal(name, './backend-command');
    return { runBackendCommandSync: args => { calls.push(args); return output; } };
  } });
  return { run: () => exports.nativeCombatSmokeDatabase('http://127.0.0.1:8312', 'http://127.0.0.1:3318'), calls };
}

test('native smoke preserves Python line breaks and indentation in one structured argument', () => {
  const h = helper('{"verified":true}');
  assert.equal(h.run(), 'sj_combat_smoke');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].length, 3);
  assert.deepEqual(Array.from(h.calls[0].slice(0, 2)), ['shell', '-c']);
  // Inspect the emitted command boundary, without a Python or DB dependency.
  assert.match(h.calls[0][2], /\ntry:\n    /);
  assert.match(h.calls[0][2], /\nfinally:\n    /);
  assert.doesNotMatch(h.calls[0][2], /\\n|\\r/);
});

for (const newline of ['\n', '\r\n']) test(`native smoke reads its final verification after a shell banner (${JSON.stringify(newline)})`, () => {
  const h = helper(`Objects imported automatically${newline}{"verified":true}${newline}`);
  assert.equal(h.run(), 'sj_combat_smoke');
});
