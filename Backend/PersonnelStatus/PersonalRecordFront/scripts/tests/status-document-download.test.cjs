const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(client) {
  const source = fs.readFileSync(path.join(__dirname, '../../features/employee-status-update/model/status-documents.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, require: () => ({ opsApiClient: client }),
  });
  return exports;
}

test('reads parent metadata and downloads bytes with the authenticated API client', async () => {
  const calls = [];
  const row = { id: 7, title: 'Private', file_url: '/api/statuses/statuses/42/documents/7/content/' };
  const api = load({
    get: async endpoint => { calls.push(['get', endpoint]); return { documents: [row] }; },
    download: async endpoint => { calls.push(['download', endpoint]); return { blob: 'bytes', filename: 'original.pdf' }; },
  });
  assert.equal((await api.fetchStatusDocuments(42))[0].title, 'Private');
  assert.equal((await api.downloadStatusDocument(42, row)).filename, 'original.pdf');
  assert.deepEqual(calls, [['get', '/api/statuses/statuses/42/'], ['download', '/api/statuses/statuses/42/documents/7/content/']]);
});

for (const url of ['https://outside.test/api/statuses/statuses/42/documents/7/content/', '/media/status_documents/private.pdf', '/api/statuses/statuses/43/documents/7/content/', '/api/statuses/statuses/42/documents/8/content/', '/api/statuses/statuses/42/documents/7/content/?token=secret']) {
  test('never forwards authentication to an unexpected URL: ' + url, async () => {
    let calls = 0;
    const api = load({ download: async () => calls++ });
    await assert.rejects(api.downloadStatusDocument(42, { id: 7, file_url: url }));
    assert.equal(calls, 0);
  });
}

test('download failure remains a failure instead of navigating to public media', async () => {
  const api = load({ download: async () => { throw Error('Forbidden'); } });
  await assert.rejects(api.downloadStatusDocument(42, { id: 7, file_url: '/api/statuses/statuses/42/documents/7/content/' }), /Forbidden/);
});

test('actual API download sends Bearer in a header and preserves the server filename', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../lib/ops-api.ts'), 'utf8');
  const exports = {};
  const calls = [];
  const deps = {
    '@/shared/config/env': { BACKEND_URL: '' },
    '@/lib/access-token': { getAccessToken: async () => 'test-access-token' },
    '@/lib/ops-errors': {},
    '@/lib/ops-write-authority': {},
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, require: id => deps[id],
    fetch: async (url, options) => { calls.push([url, options]); return { ok: true, headers: { get: () => 'attachment; filename="original.pdf"' }, blob: async () => 'private bytes' }; },
  });
  const result = await exports.opsApiClient.download('/api/statuses/statuses/42/documents/7/content/');
  assert.equal(result.filename, 'original.pdf');
  assert.equal(calls[0][0], '/api/statuses/statuses/42/documents/7/content/');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-access-token');
  assert.equal(calls[0][1].cache, 'no-store');
});

function viewer({ failure = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../features/employee-status-update/ui/StatusDocuments.tsx'), 'utf8');
  const exports = {}; const calls = []; const states = []; let cursor = 0;
  const row = { id: 7, title: 'Personnel note', file_url: '/api/statuses/statuses/42/documents/7/content/' };
  const deps = {
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; } },
    '@tanstack/react-query': { useQuery: options => ({ data: options.enabled ? [row] : undefined, isLoading: false, isError: false }) },
    '@/components/ui/button': { Button: 'button' },
    '../model/status-documents': { downloadStatusDocument: async (id, doc) => { calls.push(['download', id, doc.id]); if (failure) throw Error('Denied'); return { blob: 'bytes', filename: 'original.pdf' }; } },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: id => deps[id] ?? require(id),
    URL: { createObjectURL: () => 'blob:private', revokeObjectURL: () => calls.push(['revoke']) },
    document: { body: { appendChild() {} }, createElement: () => ({ click: () => calls.push(['save']), remove() {} }) },
  });
  return { calls, render() { cursor = 0; const nodes = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); } walk(exports.StatusDocuments({ statusId: 42 })); return nodes; } };
}

test('document viewer lazy opens and saves authenticated bytes without an API anchor', async () => {
  const ui = viewer();
  ui.render().find(n => n.type === 'button').props.onClick();
  const expanded = ui.render();
  assert.equal(expanded.filter(n => n.type === 'a').length, 0);
  await expanded.find(n => n.type === 'button' && n.props.children === 'Personnel note').props.onClick();
  assert.deepEqual(ui.calls, [['download', 42, 7], ['save'], ['revoke']]);
});

test('failed document download shows an error and does not save a broken file', async () => {
  const ui = viewer({ failure: true });
  ui.render().find(n => n.type === 'button').props.onClick();
  await ui.render().find(n => n.type === 'button' && n.props.children === 'Personnel note').props.onClick();
  assert.deepEqual(ui.calls, [['download', 42, 7]]);
  assert.ok(ui.render().some(n => n.props.role === 'alert'));
});
