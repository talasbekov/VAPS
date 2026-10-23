const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function model() {
  const file = path.join(__dirname, '../../features/om-assistant/progress-model.ts'), exports = {};
  if (fs.existsSync(file)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
  return exports;
}
const progress={need:200,collected:160,remaining:40,departments:[]};
test('commander progress uses published need and accepted roster independently of instruction total',()=>{
  const result=model().progressPresentation({status:'collecting',plan:{personnelTotal:300},event:{stage:'FORCES',progress}});
  assert.equal(result.need,200);assert.equal(result.collected,160);assert.equal(result.remaining,40);
});
test('unknown demand and older backend do not become zero or a fabricated complete result',()=>{
  const present=model().progressPresentation;
  assert.equal(present({status:'collecting',event:{stage:'FORCES'}}),null);
  assert.equal(present({status:'event_unavailable',event:{stage:'FORCES',progress}}),null);
  assert.equal(present({status:'awaiting_recon',event:{stage:'RECON',progress:{...progress,need:null,remaining:null}}}).remaining,null);
});
test('zero response is distinct from unanswered and return or lateness is concrete',()=>{
  const result=model().progressPresentation({status:'collecting',event:{stage:'FORCES',progress:{...progress,departments:[
    {id:'1',name:'A',requested:20,responded:null,status:'NOTIFIED',overdue:true},
    {id:'2',name:'B',requested:20,responded:0,status:'DECLINED',overdue:false},
    {id:'3',name:'C',requested:20,responded:15,status:'RETURNED',overdue:false},
    {id:'4',name:'D',requested:20,responded:20,status:'SUBMITTED',overdue:false},
  ]}}});
  assert.match(result.departments[0].label,/Нет ответа/);assert.equal(result.departments[0].overdue,true);
  assert.match(result.departments[1].label,/Выделить людей не могут/);
  assert.match(result.departments[2].label,/Исправляют ответ/);
  assert.match(result.departments[3].label,/Список передан/);
});
test('closed collection does not present stale department deadlines as active delays',()=>{
  for(const stage of ['APPROVAL','ACKNOWLEDGEMENT','CONDUCT','CLOSED']){
    const result=model().progressPresentation({status:'completed',event:{stage,progress:{...progress,departments:[{id:'1',name:'A',requested:20,responded:null,status:'NOTIFIED',overdue:true}]}}});
    assert.equal(result.closed,true);assert.equal(result.departments[0].overdue,false);
  }
});
test('server handover closes placement while active placement still collects',()=>{
  const task={status:'prepared',event:{stage:'PLACEMENT',progress:{...progress,collectionClosed:true,departments:[{id:'1',name:'A',requested:20,responded:null,status:'NOTIFIED',overdue:true}]}}};
  assert.equal(model().progressPresentation(task).closed,true);
  assert.equal(model().progressPresentation(task).departments[0].overdue,false);
  task.event.progress.collectionClosed=false;
  assert.equal(model().progressPresentation(task).closed,false);
});
