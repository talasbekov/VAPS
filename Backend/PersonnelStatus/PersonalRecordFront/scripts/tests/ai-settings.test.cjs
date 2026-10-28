const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');

const saved = { provider: 'openai', baseUrl: 'http://model.local/v1', model: 'test-model',
  hasKey: true, revision: 'revision-1' };

function render(query = {}, permissions = {}) {
  let read;
  const exports = {};
  const wrap = tag => ({ children, asChild, variant, size, ...props }) => React.createElement(tag, props, children);
  const overrides = {
    '@tanstack/react-query': { useQuery: () => query, useQueryClient: () => ({}) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, error: null,
      hasGlobalPermission: () => true, ...permissions }) },
    '@/hooks/use-ops-protected-read': {
      useOpsReadAccess: () => ({ allowed: true, actor: 'admin-1', scope: 'scope-1' }),
      useOpsProtectedRead: (prefix, parts, access, callback, options) => {
        read = { prefix, parts, access, options }; return query;
      },
    },
    '@/lib/ops-api': { opsApiClient: {} },
    '@/lib/ops-errors': { OpsApiError: class extends Error {} },
    '@/components/dashboard-layout': { DashboardLayout: wrap('main') },
    '@/components/page-header': { PageHeader: ({ title, description }) => React.createElement('header', null, title, description) },
    '@/components/ops-access-denied': { OpsAccessDenied: () => React.createElement('p', null, 'Нет доступа') },
    '@/components/ui/button': { Button: wrap('button') },
    '@/components/ui/card': { Card: wrap('section'), CardContent: wrap('div') },
    '@/components/ui/input': { Input: wrap('input') },
    '@/components/ui/label': { Label: wrap('label') },
    'next/link': { default: wrap('a') },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../app/settings/ai/page.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, URL, Error, require: name => overrides[name] ?? require(name) });
  return { html: renderToStaticMarkup(React.createElement(exports.default)), read };
}

test('AI settings use account and live authority scoped reads', () => {
  const { html, read } = render({ data: saved, isSuccess: true, canAct: true });
  assert.match(html, /test-model/);
  assert.equal(read.access.actor, 'admin-1');
  assert.equal(read.access.scope, 'scope-1');
  assert.equal(read.options.refetchOnWindowFocus, false);
});

for (const permission of [{ error: Error('refresh failed') }, { hasGlobalPermission: () => false }]) {
  test('AI settings never show cached settings when global authority is unavailable ' + Object.keys(permission)[0], () => {
    const { html } = render({ data: saved, isSuccess: true }, permission);
    assert.match(html, /Нет доступа/);
    assert.doesNotMatch(html, /test-model|ai-key/);
  });
}

test('AI settings hide cached data after a settings refresh error', () => {
  const { html } = render({ data: saved, isError: true });
  assert.match(html, /Не удалось загрузить/);
  assert.doesNotMatch(html, /test-model|ai-key/);
});

test('unreadable saved keys ask for replacement and do not offer blank preservation', () => {
  const { html } = render({ data: { ...saved, keyError: 'Сохранённый ключ не читается.' }, isSuccess: true, canAct: true });
  assert.match(html, /Сохранённый ключ не читается/);
  assert.doesNotMatch(html, /Оставьте поле пустым, чтобы сохранить прежний ключ/);
  assert.match(html, /<button[^>]*disabled[^>]*>Проверить соединение/);
  assert.match(html, /Удалить сохранённый ключ/);
});

test('in-progress access revalidation disables settings mutations', () => {
  const { html } = render({ data: saved, isSuccess: true, isFetching: true, canAct: false });
  assert.match(html, /<button[^>]*disabled[^>]*>Проверить соединение/);
});

test('probe help distinguishes unchanged connection parameters from a recorded result', () => {
  const { html } = render({ data: saved, isSuccess: true, canAct: true });
  assert.doesNotMatch(html, /ничего не сохраняет/);
  assert.match(html, /результат проверки/);
});

function editor(initial = saved) {
  const cells = [];
  let cursor = 0, current = true, sourceReady = true, request, resolve;
  const exports = {};
  const identity = { actor: 'admin-1', scope: 'scope-1', allowed: true };
  const overrides = {
    react: { ...React, useState: value => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof value === 'function' ? value() : value;
      return [cells[index], next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next; }];
    } },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/hooks/use-ops-permissions': {},
    '@/hooks/use-ops-protected-read': {
      assertOpsReadAuthority: () => { if (!current || !sourceReady) throw Error('Доступ изменился'); },
      hasOpsReadAuthority: () => current && sourceReady,
    },
    '@/lib/ops-api': { opsApiClient: {
      post: (url, body) => { request = { url, body, method: 'POST' }; return new Promise(done => { resolve = done; }); },
      put: (url, body) => { request = { url, body, method: 'PUT' }; return new Promise(done => { resolve = done; }); },
    } },
    '@/lib/ops-errors': { OpsApiError: class extends Error {} },
  };
  for (const [module, names] of [
    ['@/components/dashboard-layout', ['DashboardLayout']], ['@/components/page-header', ['PageHeader']],
    ['@/components/ops-access-denied', ['OpsAccessDenied']], ['@/components/ui/button', ['Button']],
    ['@/components/ui/card', ['Card', 'CardContent']], ['@/components/ui/input', ['Input']], ['@/components/ui/label', ['Label']],
  ]) overrides[module] = Object.fromEntries(names.map(name => [name, name]));
  overrides['next/link'] = { default: 'a' };
  const source = fs.readFileSync(path.join(__dirname, '../../app/settings/ai/page.tsx'), 'utf8');
  const output = ts.transpileModule(source + '\nexports.testEditor = SettingsForm;', { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(output, { exports, URL, Error, require: name => overrides[name] ?? require(name) });
  const flat = node => !node || typeof node !== 'object' ? [] :
    [node, ...React.Children.toArray(node.props?.children).flatMap(flat)];
  function nodes() {
    cursor = 0;
    return flat(exports.testEditor({ initial, access: identity, source: ['ops-assistant-settings', 'connection', 'scope-1'],
      canAct: true, onReload: async () => {} }));
  }
  return {
    nodes,
    field: id => nodes().find(node => node.props.id === id),
    check: () => nodes().find(node => node.type === 'Button' && node.props.children === 'Проверить соединение').props.onClick(),
    save: () => nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    revoke: () => { current = false; },
    refreshFailed: () => { sourceReady = false; },
    request: () => request,
    finish: async value => { resolve(value); await new Promise(done => setImmediate(done)); },
    text: () => nodes().flatMap(node => React.Children.toArray(node.props?.children).filter(value => typeof value === 'string')).join(' '),
  };
}

test('click rechecks live authority and cannot send a typed key after access changes', () => {
  const page = editor();
  page.field('ai-key').props.onChange({ target: { value: 'synthetic-key' } });
  page.revoke();
  page.check();
  assert.equal(page.request(), undefined);
  assert.match(page.text(), /Доступ изменился/);
});

test('settings source failure blocks a stale mounted action', () => {
  const page = editor();
  page.refreshFailed();
  page.check();
  assert.equal(page.request(), undefined);
});

test('explicit replacement can be checked without claiming it is saved', async () => {
  const page = editor({ ...saved, keyError: 'Ключ не читается' });
  page.field('ai-key').props.onChange({ target: { value: 'replacement-test-key' } });
  page.check();
  assert.equal(page.request().body.apiKey, 'replacement-test-key');
  assert.equal(page.request().method, 'POST');
  await page.finish({ ok: true, message: 'Проверка выполнена' });
  assert.match(page.text(), /Проверка выполнена/);
  assert.equal(page.field('ai-key').props.value, 'replacement-test-key');
  assert.match(page.text(), /Есть несохранённые изменения/);
});

test('successful save clears typed credential from the editor', async () => {
  const page = editor();
  page.field('ai-key').props.onChange({ target: { value: 'replacement-test-key' } });
  page.save();
  assert.equal(page.request().method, 'PUT');
  await page.finish({ ...saved, revision: 'revision-2' });
  assert.equal(page.field('ai-key').props.value, '');
  assert.match(page.text(), /Настройки сохранены/);
});

test('late probe success after authority loss does not claim success', async () => {
  const page = editor();
  page.check();
  page.revoke();
  await page.finish({ ok: true, message: 'Old authority probe succeeded' });
  assert.doesNotMatch(page.text(), /Old authority probe succeeded/);
});
