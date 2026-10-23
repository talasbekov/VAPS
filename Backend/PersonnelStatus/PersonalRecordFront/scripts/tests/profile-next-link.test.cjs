const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const portal = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../../entities/portal-access/index.ts'), 'utf8')), { exports: portal });
const state = { grants: new Set(), isLoading: false, error: null };
const exported = {};
const file = path.join(__dirname, '../../widgets/my-profile/ui/ProfileEventLink.tsx');
if (fs.existsSync(file)) vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports: exported, require: id => {
  if (id === '@/hooks/use-ops-permissions') return { useOpsPermissions: () => ({
    hasPermission: code => state.grants.has('*') || state.grants.has(code), roles: [], isLoading: state.isLoading, error: state.error,
  }) };
  if (id === '@/entities/portal-access') return portal;
  if (id === 'next/link') return { default: ({ href, children, className }) => React.createElement('a', { href, className }, children) };
  return require(id);
} });
const render = hideWithoutAccess => {
  assert.equal(typeof exported.ProfileEventLink, 'function', 'shared profile event link must be implemented');
  return renderToStaticMarkup(React.createElement(exported.ProfileEventLink, {
    eventId: '88', className: 'instruction', hideWithoutAccess,
  }, 'Инструкция в ОМ'));
};

test('personal instruction has an event link only with current module access', () => {
  state.grants = new Set(['event.view']); state.isLoading = false; state.error = null;
  assert.match(render(true), /href="\/security-ops\/events\/88"/);
  state.grants = new Set(['status.view']);
  assert.equal(render(true), '');
  assert.match(render(false), /<span[^>]*>Инструкция в ОМ<\/span>/);
});

test('loading or failed permission authority hides the instruction link despite retained event grants', () => {
  state.grants = new Set(['*']); state.isLoading = true; state.error = null;
  assert.equal(render(true), '');
  state.isLoading = false; state.error = Error('Refresh failed');
  assert.equal(render(true), '');
  assert.doesNotMatch(render(false), /<a\b/);
});
