const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(enabled) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../lib/login-forwarding.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require, process: { env: { TRUST_LOGIN_PROXY_HEADER: enabled } } });
  return exports.loginForwardingHeaders;
}

test('forwarding is disabled unless deployment explicitly enables its closed frontend', () => {
  assert.equal(Object.keys(harness(undefined)({ 'x-real-ip': '203.0.113.10' })).length, 0);
});

test('only nginx-overwritten single X-Real-IP is forwarded, never client XFF or credentials', () => {
  const output = harness('1')({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '1.2.3.4', authorization: 'secret' });
  assert.deepEqual(JSON.parse(JSON.stringify(output)), { 'X-Forwarded-For': '203.0.113.10' });
});

for (const value of ['', 'not-an-ip', '1.2.3.4, 5.6.7.8', ['1.2.3.4'], undefined]) {
  test(`invalid proxy IP ${JSON.stringify(value)} cannot become a forwarded identity`, () => {
    assert.equal(Object.keys(harness('1')({ 'x-real-ip': value })).length, 0);
  });
}

test('real authorize passes request headers through the bounded helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../lib/auth-config.ts'), 'utf8');
  assert.match(source, /async authorize\(credentials,\s*request\)/);
  assert.match(source, /\.\.\.loginForwardingHeaders\(request\.headers\)/);
});
