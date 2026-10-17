const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function buttons(endDate,state='active',action=null,type='in_service'){
 let index=0;const current={id:5256,status_type:type,state,start_date:'2026-10-09',end_date:endDate,comment:''};
 const exports={};const deps={
  react:{...require('react'),useState(initial){const i=index++;return[i===2?{current,planned:[]}:i===7?action:initial,()=>{}];},useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect(){}},
  '@tanstack/react-query':{useQueryClient:()=>({})},
  '@/hooks/use-staff-units-page':{useStaffUnitsPage:()=>({data:{staff_units:[{id:10,employee:{id:1}}]}})},
  '@/hooks/use-employee-status-types':{useEmployeeStatusTypes:()=>({types:[]})},
  '@/hooks/use-ops-status-types':{useOpsStatusTypes:()=>({all:[]})},
  '@/entities/status':{useStatusNaming:()=>({colorOf:()=>'',labelOf:()=>type})},
  '@/entities/daily-grid':{EVENT_PARTICIPATION_STATUS_CODES:new Set()},
  '../model/row-key':{employeeIdOfKey:()=>1},
 };
 const source=fs.readFileSync(path.join(__dirname,'../../features/employee-status-update/ui/PlannedStatusesDialog.tsx'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:id=>deps[id]??(id.startsWith('@/')?new Proxy({},{get:(_,key)=>key}):require(id))});
 const nodes=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);walk(n.props?.children);}walk(exports.PlannedStatusesDialog({open:true,employeeId:'10-1',onOpenChange(){}}));
 function label(n){if(typeof n==='string')return n;if(Array.isArray(n))return n.map(label).join('');return n?.props?label(n.props.children):'';}
 return nodes.filter(n=>n.type==='Button').map(label);
}
for(const value of [null,undefined,''])test('no extension for absent end date '+String(value),()=>assert.equal(buttons(value).includes('Продлить'),false));
test('stale extension form cannot submit against a now indefinite status',()=>assert.equal(buttons(null,'active','extend').includes('Продлить'),false));
test('finite active status retains extension and termination',()=>{const actions=buttons('2026-10-30','active',null,'vacation');assert.equal(actions.includes('Продлить'),true);assert.equal(actions.includes('Завершить досрочно'),true);});
test('indefinite non-service status retains its other action',()=>assert.equal(buttons(null,'active',null,'other_absence').includes('Завершить досрочно'),true));
test('completed finite status never offers extension',()=>assert.equal(buttons('2026-10-01','completed').includes('Продлить'),false));
