const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsOfModel = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'scene3d-label-resolution.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsOfModel });
const { labelTextureWidth } = exportsOfModel;

test('reset working scale retains two samples per device pixel within a quarter of the old buffer area', () => {
  const cardCssWidth = 13 * 1040 / 92;
  for (const dpr of [1, 1.5]) {
    const physical = cardCssWidth * dpr;
    const width = labelTextureWidth(physical);
    assert.ok(width >= physical * 2);
    assert.ok(width ** 2 <= 1040 ** 2 / 4);
  }
});
test('close-up resolution is preserved while invisible labels remain inexpensive', () => {
  assert.equal(labelTextureWidth(700, 520, true), 1040);
  assert.equal(labelTextureWidth(700, 1040, false), 260);
  assert.equal(labelTextureWidth(20, 1040, true), 260);
});
test('small zoom oscillations around tier boundaries do not repeatedly replace textures', () => {
  let width = labelTextureWidth(140);
  let changes = 0;
  for (const physical of [129, 131, 127, 135, 128, 130]) {
    const next = labelTextureWidth(physical, width);
    if (next !== width) changes++;
    width = next;
  }
  assert.equal(changes, 0);
  assert.equal(labelTextureWidth(90, width), 260);
});
