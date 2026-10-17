const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

function load(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, FormData, URL, URLSearchParams, Headers, console: { ...console, error() {} },
    require: name => dependencies[name] ?? (name.startsWith('@/') || name.startsWith('../')
      ? new Proxy({}, { get: (_, key) => key }) : require(name)), ...globals });
  return exports;
}

function authorityModel() {
  const errors = load('lib/ops-errors.ts', {});
  return load('lib/ops-write-authority.ts', { '@/lib/ops-errors': errors });
}

test('live authority rejects missing, failed, and removed permission checks without trusting cached grants', t => {
  const model = authorityModel();
  const client = new QueryClient();
  t.after(() => client.clear());
  assert.equal(model.currentOpsAuthorityStamp(client, 'actor-1'), null);
  client.setQueryData(['ops-me'], { permissions: ['report.generate'], roles: [] });
  assert.notEqual(model.currentOpsAuthorityStamp(client, 'actor-1'), null);
  assert.equal(model.currentOpsAuthorityStamp(client, null), null);
  client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Unavailable') });
  assert.equal(model.currentOpsAuthorityStamp(client, 'actor-1'), null);
  client.clear();
  assert.equal(model.currentOpsAuthorityStamp(client, 'actor-1'), null);
});

test('a captured business write rejects outage, actor/scope changes, and provider disposal but permits reads and auth', () => {
  const model = authorityModel();
  let stamp = 'actor-1 / scope-1';
  const dispose = model.registerOpsWriteAuthority(() => stamp);
  const first = model.captureOpsWriteAuthority('/api/ops/duty-register/', 'POST');
  first();
  stamp = null;
  assert.throws(first, error => error.status === 503);
  assert.throws(() => model.captureOpsWriteAuthority('/api/ops/duty-register/', 'PATCH'), error => error.status === 503);
  model.captureOpsWriteAuthority('/api/operations/my-permissions/', 'GET')();
  model.captureOpsWriteAuthority('/api/token/', 'POST')();
  model.captureOpsWriteAuthority('/api/auth/logout/', 'POST')();
  stamp = 'actor-2 / scope-2';
  assert.throws(first, error => error.status === 503);
  const second = model.captureOpsWriteAuthority('/api/statuses/statuses/', 'POST');
  second();
  dispose();
  assert.throws(second, error => error.status === 503);
  assert.throws(() => model.captureOpsWriteAuthority('/api/statuses/statuses/', 'POST'), error => error.status === 503);
});

for (const [file, method, args] of [
  ['lib/ops-api.ts', 'post', ['/api/ops/duty-register/', { note: 'unsent' }]],
  ['lib/ops-api.ts', 'patch', ['/api/ops/security-events/1/', { name: 'changed' }]],
  ['lib/api.ts', 'createEmployee', [{ name: 'Example' }]],
  ['lib/api.ts', 'createEmployeeStatus', [{ employee: 1, status_type: 'leave' }]],
  ['features/secondment-requests/api/secondment-requests-api.ts', 'approveSecondmentRequest', [7]],
  ['features/secondment-requests/api/secondment-requests-api.ts', 'rejectSecondmentRequest', [7]],
]) {
  test(`${file} ${method} cannot send after authority is lost while awaiting the token`, async () => {
    let releaseToken;
    const token = new Promise(resolve => { releaseToken = resolve; });
    let authority = 'actor A / scope A';
    let requests = 0;
    const exported = load(file, {
      '@/shared/config/env': { BACKEND_URL: '' },
      '@/entities/employee/model/photo-src': { photoSrc: value => value },
      '@/lib/access-token': { getAccessToken: () => token },
      '@/lib/api': { getAccessToken: () => token },
      '@/lib/ops-errors': { OpsNetworkError: Error },
      '@/lib/ops-write-authority': { captureOpsWriteAuthority: () => {
        const captured = authority;
        if (!captured) throw Error('No current permission authority');
        return () => { if (authority !== captured) throw Error('Permission authority changed'); };
      } },
    }, { window: {}, fetch: async () => { requests++; return { ok: true, status: 200, json: async () => ({}) }; } });
    const client = exported.opsApiClient ?? exported.apiClient ?? exported;
    assert.equal(typeof client[method], 'function', 'the real transport operation must exist');
    const pending = client[method](...args);
    authority = null;
    releaseToken('token');
    await assert.rejects(pending, /authority changed/);
    assert.equal(requests, 0, 'no business write reaches fetch');
  });
}

test('an open secondment form cannot POST after authority is lost during token lookup', async () => {
  let releaseToken, submit;
  const token = new Promise(resolve => { releaseToken = resolve; });
  let authority = 'actor-1 / scope-1', requests = 0;
  const errors = [];
  const form = { control: {}, register: () => ({}), handleSubmit: callback => { submit = callback; return () => {}; },
    reset() {}, setError: (...args) => errors.push(args), watch: () => new Date('2030-10-20T12:00:00Z'),
    formState: { errors: {}, isSubmitting: false } };
  const subject = load('features/employee-status-update/ui/SecondEmployeeDialog.tsx', {
    react: { ...require('react'), useMemo: fn => fn(), useEffect() {} },
    '@/lib/api': { getAccessToken: () => token },
    '@/shared/config/env': { BACKEND_URL: '' },
    '@/hooks/use-divisions-tree': { useDivisionsTree: () => ({ data: null, isLoading: false, error: null }) },
    '@/shared/hooks/use-toast': { useToast: () => ({ toast() {} }) },
    '@/shared/lib/form': { useZodForm: () => form, focusFirstOf() {}, focusFirstError() {} },
    '@/shared/lib/api-error': { ApiRequestError: class extends Error {} },
    '@/lib/utils': { cn: () => '' },
    '@/lib/ops-write-authority': { captureOpsWriteAuthority: () => {
      const captured = authority;
      if (!captured) throw Error('No authority');
      return () => { if (authority !== captured) throw Error('Authority changed'); };
    } },
  }, { fetch: async () => { requests++; return { ok: true, json: async () => ({ status: 'pending' }) }; } });
  const tree = subject.SecondEmployeeDialog({ open: true, employeeId: '1-7', onOpenChange() {} });
  function findForm(node) {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map(findForm).find(Boolean);
    return node.type === 'form' ? node : findForm(node.props?.children);
  }
  findForm(tree).props.onSubmit({ preventDefault() {} });
  assert.equal(typeof submit, 'function');
  const pending = submit({ divisionId: '4', startDate: new Date('2030-10-20T12:00:00Z'), endDate: new Date('2030-10-21T12:00:00Z'), comment: 'Synthetic request' });
  authority = null; releaseToken('token');
  await pending;
  assert.equal(requests, 0);
  assert.ok(errors.length > 0, 'the unsent form receives a recoverable permission error');
});
