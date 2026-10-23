const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function model() {
  const exports = {};
  const file = path.join(__dirname, '../../entities/service-employee/service-profile.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports });
  return exports;
}

function unknownProfile() {
  return { inventory: null, skills: { shooting: null, hand_to_hand: null, physical_fitness: null },
    health: { condition: null, chronic_conditions: null, restrictions: null },
    height_cm: null, weight_kg: null, updated_at: null };
}

test('editing other fields preserves unknown inventory, health and unassessed skills', () => {
  const m = model();
  const draft = m.draftFromProfile(unknownProfile());
  draft.height_cm = '180';
  const saved = m.profileFromDraft(draft);
  assert.equal(saved.inventory, null);
  assert.equal(saved.skills.shooting, null);
  assert.equal(saved.health.condition, null);
  assert.equal(saved.height_cm, 180);
});

test('known empty inventory and explicit zero quantity survive a round trip', () => {
  const m = model();
  const draft = m.draftFromProfile({ ...unknownProfile(), inventory: [] });
  assert.equal(m.profileFromDraft(draft).inventory.length, 0);
  draft.inventory.push({ category: 'magazine', name: 'TEST', quantity: '0' });
  assert.equal(m.profileFromDraft(draft).inventory[0].quantity, 0);
});

test('blank, fractional and unsafe quantities cannot save as zero or rounded integers', () => {
  const m = model();
  for (const quantity of ['', ' ', '-1', '1.5', '9007199254740992']) {
    const draft = m.draftFromProfile({ ...unknownProfile(), inventory: [] });
    draft.inventory.push({ category: 'weapon', name: 'TEST', quantity });
    assert.throws(() => m.profileFromDraft(draft));
  }
});

test('skills enforce 1 to 5 and measurements are positive without fake values', () => {
  const m = model();
  const draft = m.draftFromProfile(unknownProfile());
  draft.skills.shooting = '5';
  draft.weight_kg = '80.5';
  assert.equal(m.profileFromDraft(draft).skills.shooting, 5);
  assert.equal(m.profileFromDraft(draft).weight_kg, 80.5);
  draft.skills.shooting = '6';
  assert.throws(() => m.profileFromDraft(draft));
  draft.skills.shooting = '';
  draft.weight_kg = '0';
  assert.throws(() => m.profileFromDraft(draft));
});
