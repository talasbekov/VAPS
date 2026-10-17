const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real production module with only NextAuth's network lookup
// replaced by manually settled promises. No timing or implementation copy.
function harness() {
  const lookups = [];
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../lib/access-token.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, {
    exports, window: {}, Date,
    require(name) {
      assert.equal(name, 'next-auth/react');
      return { getSession() { return new Promise((resolve, reject) => lookups.push({ resolve, reject })); } };
    },
  }, { filename: 'access-token.js' });
  return { ...exports, lookups };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = token => ({ user: { accessToken: token } });

test('late previous-principal success cannot restore its token after the current token is cached', async () => {
  const h = harness();
  const old = h.getAccessToken(); await tick();
  h.resetAccessToken();
  const current = h.getAccessToken(); await tick();
  h.lookups[1].resolve(session('current'));
  assert.equal(await current, 'current');
  h.lookups[0].resolve(session('previous'));
  assert.equal(await old, 'current');
  assert.equal(await h.getAccessToken(), 'current');
  assert.equal(h.lookups.length, 2);
});

for (const failure of [false, true]) {
  test(`stale ${failure ? 'rejection' : 'success'} preserves the current in-flight lookup and concurrent deduplication`, async () => {
    const h = harness();
    const old = h.getAccessToken(); await tick();
    h.resetAccessToken();
    const current = h.getAccessToken(); await tick();
    let oldSettled = false;
    old.then(() => { oldSettled = true; });
    if (failure) h.lookups[0].reject(new Error('previous request failed'));
    else h.lookups[0].resolve(session('previous'));
    await tick();
    const concurrent = h.getAccessToken(); await tick();
    assert.equal(oldSettled, false);
    assert.equal(h.lookups.length, 2);
    h.lookups[1].resolve(session('current'));
    assert.deepEqual(await Promise.all([old, current, concurrent]), ['current', 'current', 'current']);
    assert.equal(await h.getAccessToken(), 'current');
  });
}

test('current lookup failures remain retryable rather than caching absence', async () => {
  const h = harness();
  const first = h.getAccessToken(); await tick();
  h.lookups[0].reject(new Error('network failure'));
  assert.equal(await first, null);
  const retry = h.getAccessToken(); await tick();
  assert.equal(h.lookups.length, 2);
  h.lookups[1].resolve(session('current'));
  assert.equal(await retry, 'current');
});

test('expired sessions never return their otherwise present token', async () => {
  const h = harness();
  const result = h.getAccessToken(); await tick();
  h.lookups[0].resolve({ ...session('expired'), error: 'RefreshAccessTokenError' });
  assert.equal(await result, null);
  assert.equal(await h.getAccessToken(), null);
  assert.equal(h.lookups.length, 1);
});
