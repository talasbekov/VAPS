const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const division={id:'3',name:'Первое управление',parent_id:'2',division_type:'directorate',notify_recipient_name:null,without_status:4};
const row={division,ids:['3'],listTotal:10,staffTotal:12,vacancies:2,offList:0,attached:0,inService:10,deviations:0,withoutStatus:4,columns:{IN_SERVICE:10},submission:null};
function render({failed=false,submitted=false}={}) {
  const source={...row,submission:submitted?{submitted_at:'2026-11-05T06:00:00Z',version:1}:null};
  const state={businessDate:'2026-11-05',scopeId:2,data:{sources:[source],direct:{...row,division:{...division,id:'2',name:'Департамент'}},total:row},
    access:{hasPermission:()=>false},report:{data:{columns:['IN_SERVICE'],column_labels:{},rows:[]}},
    divisions:{data:[division]},submissions:{isSuccess:!failed,isError:failed,data:[],refetch(){}},
    catalog:{all:[{code:'IN_SERVICE',report_column_code:'IN_SERVICE'}],labelOf:code=>code},clock:{}};
  const overrides={
    'next/navigation':{useRouter:()=>({replace(){}}),usePathname:()=>'/employees',useSearchParams:()=>new URLSearchParams()},
    '@tanstack/react-query':{useMutation:()=>({}),useQuery:()=>({})},
    '@/components/ui/button':{Button:({children,...props})=>React.createElement('button',props,children)},
    '../model/directorate-summary':{useResponsibleDaily:()=>state,summarizeDivision:()=>row,childrenOf:()=>[]},
    './SetStatusHost':{useSetStatusHost:()=>({})},
    './SummaryActionBar':{SummaryActionBar:()=>React.createElement('button',null,'Собрать свод')},
    './SummaryVersions':{SummaryVersions:()=>null},
    '@/shared/lib/date':{formatIsoDate:date=>date,formatIsoDateTime:date=>date},
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../features/daily-expense/ui/ResponsibleDailyExpense.tsx'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,URLSearchParams,require:name=>overrides[name]??(name.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>key})}:name.startsWith('.')||name.startsWith('@/')?{}:require(name))});
  return renderToStaticMarkup(React.createElement(exports.ResponsibleDailyExpense,{onBusinessDateChange(){}}));
}
test('next action precedes detailed readiness and missing sources remain available without repeating a queue',()=>{
  const html=render();
  assert.match(html,/Сдали 0 из 1/);
  const detail=html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(detail,'missing submissions need accessible details');
  assert.doesNotMatch(detail,/<details[^>]*\bopen=/);
  assert.match(detail,/Первое управление/);
  assert.match(detail,/не назначен/);
  assert.ok(html.indexOf('Собрать свод')<html.indexOf('<details'));
  assert.match(html,/не сдано/);
});
test('failed readiness does not render retained missing sources as current facts',()=>{
  const html=render({failed:true});
  assert.match(html,/Не удалось получить состояние сдачи/);
  assert.match(html,/сдача: неизвестно/);
  assert.doesNotMatch(html,/Сдали 0 из 1|Не сдали:|<details/);
});
test('all submitted sources do not leave an obsolete missing-source disclosure',()=>{
  const html=render({submitted:true});
  assert.match(html,/Сдали 1 из 1/);
  assert.doesNotMatch(html,/Не сдали:|<details/);
});
