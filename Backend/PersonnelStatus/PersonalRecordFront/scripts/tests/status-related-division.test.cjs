const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile the production save expression itself: the expectation is the
// employee's real section, never the broader scope root returned by the API.
function productionLookup() {
  const root = path.join(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'features/employee-status-update/ui/EditStatusDialog.tsx'), 'utf8');
  const tree = ts.createSourceFile('EditStatusDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'relatedDivision') expression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, 'The regression must exercise the actual status save lookup');
  const helpers = {};
  const helperPath = path.join(root, 'features/employee-status-update/model/row-key.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: helpers });
  const compiled = ts.transpileModule(`export function lookup(employeeId: string, staffUnits: any[], data: any) { return ${expression}; }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const result = {};
  vm.runInNewContext(compiled, { exports: result, ...helpers });
  return result.lookup;
}

test('bare employee ID uses the actual staff section despite a different scope root', () => {
  const lookup = productionLookup();
  assert.equal(lookup('42', [{ id: 900, employee: { id: 42 }, division: { id: 31 } }], { division: { id: 101 } }), 31);
});
test('a coincidentally matching staff-unit ID cannot select another employee section', () => {
  const lookup = productionLookup();
  assert.equal(lookup('42', [
    { id: 42, employee: { id: 77 }, division: { id: 32 } },
    { id: 900, employee: { id: 42 }, division: { id: 31 } },
  ], { division: { id: 101 } }), 31);
});
test('compound row keys keep the exact unit section', () => {
  const lookup = productionLookup();
  assert.equal(lookup('900-42', [{ id: 900, employee: { id: 42 }, division: { id: 31 } }], { division: { id: 101 } }), 31);
});
test('an employee without a matching slot does not inherit the read scope root', () => {
  const lookup = productionLookup();
  assert.equal(lookup('42', [], { division: { id: 101 } }), undefined);
});
