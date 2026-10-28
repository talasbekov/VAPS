const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(name) {
  const base=path.join(__dirname,'../..',name.replace(/^@\//,''));
  const file=[base+'.ts',path.join(base,'index.ts')].find(fs.existsSync);
  assert.ok(file,`Missing workspace module: ${name}`);
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:load,URLSearchParams});
  return exports;
}
function access(codes=[],roles=[],global=codes) {
  return {permissions:new Set(codes),roles:roles.map(code=>({code})),isLoading:false,error:null,
    hasPermission:code=>codes.includes('*')||codes.includes(code),hasGlobalPermission:code=>global.includes('*')||global.includes(code)};
}
const ids = rows=>Array.from(rows,row=>row.id);
test('employee gets their own work first without registers filling the home',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['status.view','status.workspace','catalog.view','object.view'],['EMPLOYEE']));
  assert.deepEqual(ids(result.primary),['personal']);
});
test('status manager sees their daily work and only explicitly granted OM preparation',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const a=access(['status.view','status.workspace','status.manage','event.view','event.create','object.view']);
  const result=portalWorkspace(a);
  assert.deepEqual(ids(result.primary),['statuses','assistant','events']);
});
test('combined department and headquarters grants retain distinct work entries',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['forces.allocate','forces.command','status.view','status.workspace'],['FORCES_GATHERING_OFFICER','OPS_STAFF']));
  const all=[...result.primary,...result.more];
  assert.ok(all.some(task=>task.id==='department-forces'&&task.href.includes('tab=requests')));
  assert.ok(all.some(task=>task.id==='headquarters'&&task.href.includes('tab=collections')));
  assert.ok(result.primary.length<=3);
});

test('bulletin-only author sees assistant work without gaining the event registry or headquarters',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['event.bulletin']));
  const all=[...result.primary,...result.more];
  assert.ok(all.some(task=>task.id==='assistant'));
  assert.equal(all.some(task=>['events','headquarters','department-forces'].includes(task.id)),false);
});
test('global access administrator has account management first; scoped admin grant cannot open it',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const global=portalWorkspace(access(['admin.roles','audit.view']));
  assert.deepEqual(ids(global.primary),['users','roles','audit']);
  const scoped=portalWorkspace(access(['admin.roles','status.view','status.workspace'],[],[]));
  assert.ok(![...scoped.primary,...scoped.more].some(task=>['users','roles'].includes(task.id)));
});
test('permission loading, errors and revocation never reuse protected cards',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  for(const patch of [{isLoading:true},{error:new Error('403')},{permissions:undefined}]) {
    const result=portalWorkspace({...access(['*']),...patch});
    assert.deepEqual(ids(result.primary),[]);assert.deepEqual(ids(result.more),[]);
  }
  assert.deepEqual(ids(portalWorkspace(access()).primary),['personal']);
});
test('home actions keep existing OR and conjunctive page gates for all grant subsets',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const {moduleOpenFor}=load('@/entities/portal-access');
  const grants=['status.view','status.workspace','service_summary.view','forces.allocate','forces.command','event.create','event.view','object.view'];
  for(let mask=0;mask<2**grants.length;mask++) {
    const a=access(grants.filter((_,i)=>mask&(1<<i))),result=portalWorkspace(a);
    assert.ok(result.primary.length<=3);
    const all=[...result.primary,...result.more];
    assert.equal(new Set(all.map(task=>task.id)).size,all.length);
    for(const task of all) assert.equal(moduleOpenFor(task.accessHref,a.hasPermission),true,task.id);
  }
});
test('switching department and headquarters work preserves date and clears incompatible targets',()=>{
  const {portalWorkspace,portalTaskHref}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['forces.command','forces.allocate']));
  const hq=[...result.primary,...result.more].find(task=>task.id==='headquarters');
  const href=portalTaskHref(hq,new URLSearchParams('businessDate=2026-10-23&employee=31&request=12&collection=7&campaign=8&tab=requests'));
  const query=new URLSearchParams(href.split('?')[1]);
  assert.equal(query.get('businessDate'),'2026-10-23');assert.equal(query.get('tab'),'collections');
  for(const key of ['employee','request','collection','campaign']) assert.equal(query.has(key),false);
});
test('explicit headquarters locations select only the headquarters navigation action',()=>{
  const {portalWorkspace,activePortalTask}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['forces.command','forces.allocate','status.view']));
  const all=[...result.primary,...result.more];
  for(const query of ['tab=collections','collection=7','campaign=9']) assert.equal(activePortalTask(all,'/employees/',new URLSearchParams(query)),'headquarters');
  assert.equal(activePortalTask(all,'/employees/',new URLSearchParams('view=forces&tab=requests')),'department-forces');
});

test('employee selection capability does not imply department incoming-request capability',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['forces.select','status.view','status.workspace','status.manage']));
  assert.equal(result.primary[0].id,'statuses');
  assert.ok(![...result.primary,...result.more].some(task=>task.id==='department-forces'));
});

test('both permitted report sources retain one active shared report action',()=>{
  const {portalWorkspace,activePortalTask}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['daily_report.generate','report.generate']));
  const all=[...result.primary,...result.more];
  for(const path of ['/reports/','/reports/history/','/security-ops/service-reports/','/security-ops/service-reports/history/']) {
    assert.equal(activePortalTask(all,path,new URLSearchParams()),'reports');
  }
});

test('daily report responsibilities open their workspace without force allocation',()=>{
  const {portalWorkspace,activePortalTask}=load('@/features/portal-workspace/model');
  const {moduleOpenFor}=load('@/entities/portal-access');
  for(const permission of ['daily_report.mark_update','daily_report.generate','daily_report.correct']) {
    const a=access(['status.view',permission]);
    const result=portalWorkspace(a),all=[...result.primary,...result.more];
    assert.equal(moduleOpenFor('/daily-expense',a.hasPermission),true);
    assert.equal(moduleOpenFor('/employees',a.hasPermission),false);
    assert.equal(all.find(task=>task.id==='daily')?.href,'/daily-expense');
    assert.equal(activePortalTask(all,'/daily-expense/',new URLSearchParams()),'daily');
    assert.ok(!all.some(task=>['department-forces','headquarters'].includes(task.id)));
  }
});

test('daily workspace requires both a daily responsibility and status read authority',()=>{
  const {portalWorkspace}=load('@/features/portal-workspace/model');
  const {moduleOpenFor}=load('@/entities/portal-access');
  for(const codes of [[],['status.view'],['daily_report.generate'],['daily_report.mark_update'],['daily_report.correct'],['forces.allocate','status.view']]) {
    const a=access(codes),result=portalWorkspace(a);
    assert.equal(moduleOpenFor('/daily-expense',a.hasPermission),false,JSON.stringify(codes));
    assert.ok(![...result.primary,...result.more].some(task=>task.id==='daily'));
  }
});

test('switching into daily work preserves date filters and clears force targets',()=>{
  const {portalWorkspace,portalTaskHref}=load('@/features/portal-workspace/model');
  const result=portalWorkspace(access(['status.view','daily_report.generate']));
  const entry=[...result.primary,...result.more].find(task=>task.id==='daily');
  assert.ok(entry,'daily responsibility needs a task');
  const href=portalTaskHref(entry,new URLSearchParams('businessDate=2026-10-27&dateFrom=2026-10-20&dateTo=2026-10-27&request=4&collection=6&campaign=8&tab=requests&view=forces&employee=9'));
  assert.equal(href,'/daily-expense?businessDate=2026-10-27&dateFrom=2026-10-20&dateTo=2026-10-27');
});
