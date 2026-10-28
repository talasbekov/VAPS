const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const ts = require('typescript');
const file = path.join(__dirname, '../../features/duty-dispatch/model/empty-state.ts');
const api = {};
if (fs.existsSync(file)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api});
const base = {tab:'waiting', people:0, waiting:0, active:0, invalid:0, history:0, hasFilters:false};
test('unallocated day explains prerequisite without claiming everyone placed', () => {
 assert.equal(typeof api.dispatchEmptyState, 'function');
 const state=api.dispatchEmptyState(base);
 assert.equal(state.kind,'unallocated'); assert.equal(state.action,undefined);
});
test('completed placement leads to current assignments',()=>{
 const state=api.dispatchEmptyState({...base,people:3,active:3});
 assert.equal(state.kind,'placed');assert.equal(state.action,'assigned');
});
test('legacy status placements lead to overall roster, not empty hourly assignments',()=>{
 const state=api.dispatchEmptyState({...base,people:3});
 assert.equal(state.kind,'placed');assert.equal(state.action,'roster');
});
test('invalid placements require attention rather than a success state',()=>{
 const state=api.dispatchEmptyState({...base,active:1,invalid:1});
 assert.equal(state.kind,'attention');assert.equal(state.action,'assigned');
});
test('filtered emptiness retains controls and never claims no allocations',()=>{
 const state=api.dispatchEmptyState({...base,hasFilters:true});
 assert.equal(state.kind,'filtered');assert.equal(state.action,'clear');
 assert.equal(api.showDispatchFilters(0,true),true);assert.equal(api.showDispatchFilters(0,false),false);assert.equal(api.showDispatchFilters(2,false),true);
});
test('empty history and assigned views describe their own list',()=>{
 assert.equal(api.dispatchEmptyState({...base,tab:'history'}).kind,'no-history');
 assert.equal(api.dispatchEmptyState({...base,tab:'assigned',people:2,waiting:2}).action,'waiting');
});

