const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{QueryClient}=require('@tanstack/react-query');
function fixture(codes=['*'], pathname='/workspace',state={}) {
  const access={permissions:new Set(codes),roles:[],isLoading:false,error:null,hasPermission:c=>codes.includes('*')||codes.includes(c),hasGlobalPermission:c=>codes.includes('*')||codes.includes(c),...state};
  const client=new QueryClient(),cache=new Map();
  const overrides={
    'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
    'next/navigation':{usePathname:()=>pathname,useSearchParams:()=>new URLSearchParams(state.query || '')},
    '@/hooks/use-ops-permissions':{useOpsPermissions:()=>access},
    '@/lib/auth':{useAuth:()=>({user:{id:'test',name:'Test user'}})},
    '@/hooks/use-security-events':{useSecurityEvents:()=>({data:{total:0}})},
    '@/components/dashboard-layout':{DashboardLayout:({children})=>children},
    '@/features/portal-workspace/work-queues':{AssistantWorkQueue:()=>null,DepartmentWorkQueue:()=>null,PersonalWork:()=>null,WorkdeskComposer:()=>null,ResourceCalculationQueue:()=>React.createElement('section',{'aria-label':'Сохранённые расчёты'})},
    '@/shared/config/in-development':{inDevelopmentOfRoute:()=>null,inDevelopmentSummary:()=>''},
    '@tanstack/react-query':{useQueryClient:()=>client},
  };
  if(state.queue) {
    delete overrides['@/features/portal-workspace/work-queues'];
    overrides['@/features/om-assistant/api']={useAssistantTasks:()=>state.queue};
    overrides['@/features/om-assistant/brief']={};
    overrides['@/hooks/use-ops-protected-read']={useOpsReadAccess:()=>({allowed:true}),useOpsProtectedRead:()=>state.queue};
    overrides['@/hooks/use-my-employee']={};
    overrides['@/widgets/my-profile/ui/MyNextShift']={};
    overrides['@/lib/ops-api']={};
  }
  function load(name) {
    if(name.endsWith('.css'))return {default:new Proxy({},{get:(_,key)=>String(key)})};
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(!name.startsWith('@/'))return require(name);
    if(cache.has(name))return cache.get(name);
    const p=path.join(__dirname,'../..',name.slice(2)),file=[p+'.ts',p+'.tsx',path.join(p,'index.ts')].find(fs.existsSync);
    assert.ok(file,name);const exports={};cache.set(name,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:dependency=>load(dependency.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file.endsWith('index.ts') ? name+'/index' : name),dependency)):dependency),URLSearchParams,process,Date});
    return exports;
  }
  return {load,client};
}
test('home retains the main admin action without a duplicate navigation catalogue',()=>{
  const f=fixture();try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/workspace').PortalWorkspace));
    assert.match(html,/aria-label="Главное действие"/);
    assert.match(html,/href="\/settings\/users"/);
    assert.doesNotMatch(html,/<aside|Быстрый переход|Основные рабочие задачи/);
  }finally{f.client.clear();}
});

test('dedicated calculation reader and planner see their desk without an extra sidebar module',()=>{
  for(const grant of ['resource_calculation.view','resource_calculation.manage']) {
    const f=fixture(['event.view',grant]);try {
      const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/workspace').PortalWorkspace));
      assert.match(html,/<h1[^>]*>Расчёт сил и средств<\/h1>/);
      assert.match(html,/aria-label="Сохранённые расчёты"/);
      const sidebar=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
      assert.doesNotMatch(sidebar,/resource-calculations|force-calculation/);
    }finally{f.client.clear();}
  }
});

test('calculation queue distinguishes true emptiness from a failed or paginated read',()=>{
  const row={eventId:'test-event',title:'Изолированный расчёт',dateFrom:'2026-10-23',dateTo:null,stage:'BULLETIN',ownerDivisionName:'Тестовый отдел',version:2,updatedAt:'2026-10-23T06:00:00Z',routeCount:2};
  for(const queue of [
    {data:{results:[row],count:26,next:'?page=2',previous:null}},
    {data:{results:[],count:0,next:null,previous:null}},
    {data:{results:[row],count:26,next:null,previous:'?page=1'},isError:true,readAccessBlocked:true},
  ]) {
    const f=fixture(['event.view','resource_calculation.view'],'/workspace',{queue:{...queue,refetch:()=>{}}});try {
      const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/work-queues').ResourceCalculationQueue));
      if(queue.isError) {assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Изолированный расчёт|Расчётов пока нет/);}
      else if(queue.data.count===0) {assert.match(html,/Расчётов пока нет/);assert.doesNotMatch(html,/Следующая страница/);}
      else {assert.match(html,/events\/test-event\/force-calculation/);assert.match(html,/Следующая страница/);assert.match(html,/26/);}
    }finally{f.client.clear();}
  }
});
test('all authorized employee work modes stay reachable without duplicate destinations',()=>{
  for(const codes of [['*'],['forces.allocate','forces.command','status.view']]) for(const query of ['', 'view=forces&tab=collections', 'view=daily&businessDate=2026-10-23']) {
    const f=fixture(codes, query ? '/employees' : '/workspace', {query});try {
      const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
      const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
      const hrefs=[...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
      for(const wanted of [{view:'forces',tab:'collections'},{view:'daily'}]) {
        assert.equal(hrefs.filter(href=>{const [path,search]=href.split('?'); const params=new URLSearchParams(search); return path==='/employees' && Object.entries(wanted).every(([key,value])=>params.get(key)===value);}).length,1,JSON.stringify(wanted));
      }
      assert.equal(new Set(hrefs).size,hrefs.length);
      assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
    }finally{f.client.clear();}
  }
});
test('home never renders protected task links from retained permissions after a failed refresh',()=>{
  const f=fixture(['*'],'/workspace',{error:Error('offline')});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/workspace').PortalWorkspace));
    assert.match(html,/role="alert"/);assert.doesNotMatch(html,/href=/);
  }finally{f.client.clear();}
});
test('sidebar displays current category plus common and system groups, retaining searchable other categories',()=>{
  const f=fixture();try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    const current=html.match(/<section aria-label="Ежедневный расход"[\s\S]*?<\/section>/)[0];
    assert.ok(current.includes('href="/statuses"'));
    for(const group of ['Общие разделы','Система'])assert.ok(html.includes(`aria-label="${group}"`));
    assert.match(html,/Все разделы/);assert.match(html,/Найти раздел/);
    assert.doesNotMatch(html,/<details[^>]*\bopen=/);
    for(const href of ['/security-ops/objects','/security-ops/events','/security-ops/analytics/operations'])assert.ok(html.includes(`href="${href}"`),href);
  }finally{f.client.clear();}
});
test('deep links select their real category and keep a single current destination without duplicates',()=>{
  for(const pathname of ['/security-ops/dictionaries/','/security-ops/assistant/','/security-ops/analytics/operations/']) {
  const f=fixture(['*'],pathname);try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    assert.doesNotMatch(html,/<details[^>]*\bopen=/);
    const expected = pathname.includes('dictionaries') ? 'Система' : 'Охранное мероприятие';
    const current=html.match(new RegExp(`<section aria-label="${expected}"[\\s\\S]*?<\\/section>`))?.[0];
    assert.ok(current,pathname);
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

test('queue preview keeps completed records inside closed history and labels its limited scope',()=>{
  const rows=[{id:'done',status:'completed',plan:{title:'Finished'},receipts:[]},{id:'open',status:'needs_information',plan:{title:'Current'},receipts:[]}];
  const f=fixture(['*'],'/workspace',{queue:{data:{results:rows,page:1,pageCount:2,total:30},refetch:()=>{}}});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/work-queues').AssistantWorkQueue));
    const history=html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] || '';
    assert.ok(history.includes('Finished'));assert.doesNotMatch(history,/<details[^>]*\bopen=/);
    assert.ok(!history.includes('Current'));assert.ok(html.includes('Уточнить сведения'));
    assert.match(html,/первой странице/);assert.match(html,/href="\/security-ops\/assistant\/\?page=1"/);
  }finally{f.client.clear();}
});
test('empty bounded preview still links to the full list and read failures hide retained history',()=>{
  for(const failed of [false,true]) {
    const f=fixture(['*'],'/workspace',{queue:{isError:failed,data:{results:[{id:'done',status:'completed',plan:{title:'Finished'},receipts:[]}],pageCount:2},refetch:()=>{}}});try {
      const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/work-queues').AssistantWorkQueue));
      if(failed) {assert.match(html,/role="alert"/);assert.ok(!html.includes('Finished'));}
      else {assert.match(html,/первой странице/);assert.match(html,/Все поручения/);assert.ok(!html.includes('Поручений пока нет'));}
    }finally{f.client.clear();}
  }
});
test('department history excludes returned requests and preserves a zero submitted answer',()=>{
  const rows=[{allocationId:'zero',title:'Zero answer',status:'DECLINED',allocating:0,stage:'FORCES',need:5,businessDate:'2026-10-23'},
    {allocationId:'returned',title:'Returned request',status:'RETURNED',allocating:null,stage:'FORCES',need:5,businessDate:'2026-10-23'}];
  const f=fixture(['*'],'/workspace',{queue:{data:{results:rows},refetch:()=>{}}});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/features/portal-workspace/work-queues').DepartmentWorkQueue));
    const history=html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] || '';
    assert.ok(history.includes('Zero answer'));assert.ok(history.includes('Ответ: 0 чел.'));
    assert.ok(!history.includes('Returned request'));assert.ok(html.includes('Исправить ответ'));
    assert.doesNotMatch(history,/<details[^>]*\bopen=/);
  }finally{f.client.clear();}
});

test('empty queues hide zero preview counts and only a proven empty assistant list claims no tasks',()=>{
  for(const total of [0,undefined,30]) {
    const f=fixture(['*'],'/workspace',{queue:{data:{results:[],total},refetch:()=>{}}});try {
      const queues=f.load('@/features/portal-workspace/work-queues');
      const assistant=renderToStaticMarkup(React.createElement(queues.AssistantWorkQueue));
      assert.doesNotMatch(assistant,/Показаны/);
      assert.match(assistant,/Все поручения/);
      if(total===0) {assert.match(assistant,/Поручений пока нет/);assert.doesNotMatch(assistant,/остальные страницы/);}
      else {assert.match(assistant,/На первой странице нет текущих поручений/);assert.doesNotMatch(assistant,/Поручений пока нет/);}
      const department=renderToStaticMarkup(React.createElement(queues.DepartmentWorkQueue));
      assert.doesNotMatch(department,/Показаны/);
      assert.match(department,/Все запросы/);
    }finally{f.client.clear();}
  }
});

test('selection-only access pins the authorized employee section with one active marker',()=>{
  const f=fixture(['forces.select'],'/employees',{query:'view=forces'});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
    const current=nav.match(/<section aria-label="Охранное мероприятие"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(current,/href="\/employees\?view=forces"/);
    assert.match(current,/aria-current="page"/);
    assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
    assert.equal((nav.match(/href="\/employees\?view=forces"/g)||[]).length,1);
    assert.doesNotMatch(nav,/<details[^>]*\bopen=/);
  }finally{f.client.clear();}
});
test('expense actor without status read retains the forces default on a direct legacy employees URL',()=>{
  const f=fixture(['forces.allocate'],'/employees',{roles:[{code:'DEPARTMENT_EXPENSE_OFFICER'}]});try {
    const html=renderToStaticMarkup(React.createElement(f.load('@/components/navigation/sidebar').Sidebar));
    const section=html.match(/<section aria-label="Охранное мероприятие"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(section,/aria-current="page"/);
    assert.match(section,/view=forces/);
    assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  }finally{f.client.clear();}
});
