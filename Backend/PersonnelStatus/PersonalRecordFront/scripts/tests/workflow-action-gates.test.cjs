const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function render(file, name, deps) {
 const exports = {};
 const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') + `\nexports.subject=${name};`;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:id=>deps[id]??(id==='react'?{...require('react'),useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial})}:id.startsWith('@/')||id.startsWith('../')||id.startsWith('next/')?new Proxy({},{get:(_,key)=>key}):require(id))});
 const nodes=[]; function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);walk(n.props?.children);} walk(exports.subject());return nodes;
}
for(const audit of [false,true])test('reports audit link follows audit.view='+audit,()=>{
 const nodes=render('app/reports/page.tsx','ReportsPage',{
  '@tanstack/react-query':{useQueryClient:()=>({})},
  '@/hooks/use-ops-permissions':{useOpsPermissions:()=>({hasPermission:code=>code==='daily_report.generate'||(audit&&code==='audit.view')})},
  '@/entities/portal-access':{modulePermissionsOf:()=>['daily_report.generate']},
  '@/shared/hooks/use-toast':{useToast:()=>({toast(){}})},
  '@/lib/utils':{cn:()=>''},
 });
 assert.equal(nodes.some(n=>n.props.href==='/security-ops/audit'),audit);
});
function secondments(status,pending=false,allowed=true,override={},query={}){
 let index=0;const calls=[];
 const nodes=render('features/secondment-requests/ui/SecondmentRequestsDialog.tsx','SecondmentRequestsDialog',{
  '@/hooks/use-ops-permissions':{useOpsPermissions:()=>({})},
  '@/entities/status/access':{canManageStatusInDivision:()=>allowed},
  '@tanstack/react-query':{useQueryClient:()=>({invalidateQueries(){}}),useQuery:()=>({data:[{id:1,status,employee_detail:{full_name:'Person'},from_division_detail:{name:'A'},to_division_detail:{name:'B'},...override}],...query}),useMutation:()=>{const approve=index++===0;return{isPending:approve&&pending,mutate:id=>calls.push([approve,id])};}},
 });return{nodes,calls};
}
for(const status of ['approved','rejected','cancelled'])test(status+' secondment has no decision buttons',()=>{
 const {nodes}=secondments(status);assert.equal(nodes.filter(n=>n.type==='Button'&&['Одобрить','Отклонить'].includes(n.props.children)).length,0);
});
test('pending decision blocks both opposing actions',()=>{
 const {nodes}=secondments('pending',true);
 for(const label of ['Одобрить','Отклонить']) assert.equal(nodes.find(n=>n.type==='Button'&&n.props.children===label).props.disabled,true);
});
test('pending request still offers both decisions',()=>{
 const {nodes}=secondments('pending');assert.equal(nodes.filter(n=>n.type==='Button'&&['Одобрить','Отклонить'].includes(n.props.children)).length,2);
});
test('pending request outside receiving-side write scope offers no decision',()=>{
 const {nodes}=secondments('pending',false,false);assert.equal(nodes.filter(n=>n.type==='Button'&&['Одобрить','Отклонить'].includes(n.props.children)).length,0);
});
for (const field of ['employee_detail', 'to_division_detail']) test('missing '+field+' renders without decision actions',()=>{
 const {nodes}=secondments('pending',false,true,{[field]:null});
 assert.equal(nodes.filter(n=>n.type==='Button'&&['Одобрить','Отклонить'].includes(n.props.children)).length,0);
 assert.ok(nodes.some(n=>typeof n.props.children==='string'&&n.props.children.includes('Недостаточно данных')));
});
test('missing sending division does not prevent valid receiving decision',()=>{
 const {nodes}=secondments('pending',false,true,{from_division_detail:null});
 assert.equal(nodes.filter(n=>n.type==='Button'&&['Одобрить','Отклонить'].includes(n.props.children)).length,2);
});
test('failed incoming request provides retry within the dialog',()=>{
 let retries=0;const {nodes}=secondments('pending',false,true,{}, {error:Error('fixture'),refetch:()=>retries++});
 const retry=nodes.find(n=>n.type==='Button'&&n.props.children==='Повторить загрузку');
 assert.ok(retry);retry.props.onClick();assert.equal(retries,1);
});
