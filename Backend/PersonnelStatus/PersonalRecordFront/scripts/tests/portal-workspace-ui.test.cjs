const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{QueryClient}=require('@tanstack/react-query');
function fixture(codes=['*'], pathname='/workspace',state={}) {
  const access={permissions:new Set(codes),roles:[],isLoading:false,error:null,hasPermission:c=>codes.includes('*')||codes.includes(c),hasGlobalPermission:c=>codes.includes('*')||codes.includes(c),...state};
  const client=new QueryClient(),cache=new Map();
  const overrides={
    'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
    'next/navigation':{usePathname:()=>pathname,useSearchParams:()=>new URLSearchParams()},
    '@/hooks/use-ops-permissions':{useOpsPermissions:()=>access},
    '@/lib/auth':{useAuth:()=>({user:{id:'test',name:'Test user'}})},
    '@/hooks/use-security-events':{useSecurityEvents:()=>({data:{total:0}})},
    '@/components/dashboard-layout':{DashboardLayout:({children})=>children},
    '@/features/portal-workspace/work-queues':{AssistantWorkQueue:()=>null,DepartmentWorkQueue:()=>null,PersonalWork:()=>null,WorkdeskComposer:()=>null},
    '@/shared/config/in-development':{inDevelopmentOfRoute:()=>null,inDevelopmentSummary:()=>''},
    '@tanstack/react-query':{useQueryClient:()=>client},
  };
  function load(name) {
    if(name.endsWith('.css'))return {default:new Proxy({},{get:(_,key)=>String(key)})};
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(!name.startsWith('@/'))return require(name);
    if(cache.has(name))return cache.get(name);
    const p=path.join(__dirname,'../..',name.slice(2)),file=[p+'.ts',p+'.tsx',path.join(p,'index.ts')].find(fs.existsSync);
    assert.ok(file,name);const exports={};cache.set(name,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:dependency=>load(dependency.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency)):dependency),URLSearchParams,process,Date});
    return exports;
  }
  return {load,client};
}
test('home promotes one admin action and keeps secondary tools compact and other tasks collapsed',()=>{
  const f=fixture();try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/workspace').PortalWorkspace));
    const primary=html.match(/<section aria-label="Основные рабочие задачи">([\s\S]*?)<\/section>/)[1];
    assert.equal((primary.match(/<a /g)||[]).length,2);
    assert.match(html,/aria-label="Главное действие"/);assert.match(html,/href="\/settings\/users"/);assert.match(primary,/href="\/settings\/roles"/);
    assert.match(html,/<details>/);assert.doesNotMatch(html,/<details[^>]*\bopen=/);
  }finally{f.client.clear();}
});
test('home never renders protected task links from retained permissions after a failed refresh',()=>{
  const f=fixture(['*'],'/workspace',{error:Error('offline')});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/workspace').PortalWorkspace));
    assert.match(html,/role="alert"/);assert.doesNotMatch(html,/href=/);
  }finally{f.client.clear();}
});
test('sidebar initially has only home and three work links; all remaining modules are still rendered in disclosure',()=>{
  const f=fixture();try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    const primary=html.match(/<section aria-label="Моя работа"[\s\S]*?<\/section>/)[0];
    assert.equal((primary.match(/<a /g)||[]).length,4);
    assert.match(html,/Все разделы/);assert.match(html,/Найти раздел/);
    assert.doesNotMatch(html,/<details[^>]*\bopen=/);
    for(const href of ['/security-ops/objects','/security-ops/events','/security-ops/analytics/operations'])assert.ok(html.includes(`href="${href}"`),href);
  }finally{f.client.clear();}
});
test('rare deep links keep the full menu closed and pin one current destination without duplicates',()=>{
  for(const pathname of ['/security-ops/dictionaries/','/security-ops/assistant/','/security-ops/analytics/operations/']) {
  const f=fixture(['*'],pathname);try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    assert.doesNotMatch(html,/<details[^>]*\bopen=/);
    const current=html.match(/<section aria-label="Текущий раздел"[\s\S]*?<\/section>/)?.[0];
    assert.ok(current,pathname);
    assert.equal((current.match(/<a /g)||[]).length,1);
    assert.match(current,/aria-current="page"/);
    assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
    const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
    const hrefs=[...nav.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(new Set(hrefs).size,hrefs.length);
  }finally{f.client.clear();}
  }
});

test('a failed permissions refresh removes a rare pinned destination as well as primary links',()=>{
  const f=fixture(['*'],'/security-ops/assistant/',{error:Error('403')});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    assert.doesNotMatch(html,/aria-label="Текущий раздел"/);
    assert.doesNotMatch(html,/href="\/security-ops\/assistant/);
    assert.match(html,/role="alert"/);
  }finally{f.client.clear();}
});
test('embedded sidebar has no duplicate brand and a failed access refresh hides protected navigation',()=>{
  const embedded=fixture();try {
    const html=renderToStaticMarkup(React.createElement(embedded.load('@/components/navigation/sidebar').Sidebar,{embedded:true}));
    assert.doesNotMatch(html,/data-slot="sidebar-brand"/);
  }finally{embedded.client.clear();}
  const failed=fixture(['*'],'/workspace',{error:Error('403')});try {
    const html=renderToStaticMarkup(React.createElement(failed.load('@/components/navigation/sidebar').Sidebar));
    assert.match(html,/role="alert"/);assert.doesNotMatch(html,/href="\/(settings|statuses|employees)/);
  }finally{failed.client.clear();}
});
