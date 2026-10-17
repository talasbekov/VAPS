const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsUnderTest={};
const source=fs.readFileSync(path.join(__dirname,'../../entities/status/access.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsUnderTest});
const {canManageStatusInDivision}=exportsUnderTest;
function access(ids,global=false,granted=true){return{statusManageDivisionIds:ids,hasPermission:()=>granted,hasGlobalPermission:()=>global};}
test('scope A cannot edit readable B or unknown actual division',()=>{assert.equal(canManageStatusInDivision(access([3,4]),3),true);assert.equal(canManageStatusInDivision(access([3,4]),5),false);assert.equal(canManageStatusInDivision(access([3]),null),false);});
test('global and scoped wildcard follow server scope, not aggregate wildcard',()=>{assert.equal(canManageStatusInDivision(access(null),5),true);assert.equal(canManageStatusInDivision(access([3]),5),false);});
test('old response only permits explicit global status manage',()=>{assert.equal(canManageStatusInDivision(access(undefined),3),false);assert.equal(canManageStatusInDivision(access(undefined,true),3),true);});
test('empty or revoked scope cannot enable actions',()=>{assert.equal(canManageStatusInDivision(access([]),3),false);assert.equal(canManageStatusInDivision(access([3],false,false),3),false);});

test('mixed selection blocks whole status operation rather than silently dropping unreadable targets',()=>{
 const {canManageStatusSelection}=exportsUnderTest;
 const units=[{id:10,division:{id:3},employee:{id:1}},{id:20,division:{id:5},employee:{id:2}}];
 assert.equal(canManageStatusSelection(access([3]),['10-1','20-2'],units),false);
 assert.equal(canManageStatusSelection(access([3]),['10-1'],units),true);
 assert.equal(canManageStatusSelection(access(null),['10-99'],units),false);
 assert.equal(canManageStatusSelection(access(null),['missing'],units),false);
 assert.equal(canManageStatusSelection(access(null),['30-3'],units),false);
});
