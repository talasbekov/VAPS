const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relative, overrides = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported, require: name => overrides[name] ?? require(name) });
  return exported;
}
const photos = load('entities/employee/model/photo-src.ts');
function portrait(props, broken = null) {
  const { EmployeePortrait } = load('components/employee-portrait.tsx', {
    react: { useState: () => [broken, () => {}] },
    '@/entities/employee/model/photo-src': photos,
  });
  return renderToStaticMarkup(EmployeePortrait(props));
}

test('server media portrait is lazy loaded with accessible name', () => {
  const html = portrait({ name: 'Иван Петров', photoUrl: '/media/employees/photos/one.jpg' });
  assert.match(html, /src="\/media\/employees\/photos\/one.jpg"/);
  assert.match(html, /alt="Фото: Иван Петров"/);
  assert.match(html, /loading="lazy"/);
});
test('missing or failed photo renders initials instead of broken image', () => {
  for (const url of [undefined, null, '', '/media/missing.jpg']) {
    const html = portrait({ name: '  Иван   Петров ', photoUrl: url }, '/media/missing.jpg');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, />ИП</);
  }
});
test('portraits do not request external or protocol-relative image hosts', () => {
  for (const url of ['https://outside.test/photo.jpg', '//outside.test/photo.jpg', '/\\outside.test/photo.jpg', 'data:image/png;base64,AAAA']) {
    assert.doesNotMatch(portrait({ name: 'Иван Петров', photoUrl: url }), /<img/);
  }
});
test('a new photo can render after a previous source failed', () => {
  assert.match(portrait({ name: 'Иван Петров', photoUrl: '/media/new.jpg' }, '/media/old.jpg'), /src="\/media\/new.jpg"/);
});
