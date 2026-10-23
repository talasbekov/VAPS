const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../features/security-event-stages/approval-decision.ts'),'utf8');
const exportsObject={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsObject});
const reason=exportsObject.approvalDecisionReason;
const route=[{name:'Первый',username:'first',status:'PENDING'},{name:'Второй',username:'second',status:'PENDING'}];
const base={route,index:0,username:'first',loading:false,canApprove:true,canBypassIdentity:false};
test('first signer can decide own pending step',()=>assert.equal(reason(base),null));
test('another signer cannot decide this step',()=>assert.match(reason({...base,username:'second'}),/first/));
test('second signer waits for first signature',()=>assert.match(reason({...base,index:1,username:'second'}),/Первый/));
test('second signer can decide after first signed',()=>assert.equal(reason({...base,index:1,username:'second',route:[{...route[0],status:'APPROVED'},route[1]]}),null));
test('administrator bypasses identity but never sequence',()=>{assert.equal(reason({...base,username:'admin',canBypassIdentity:true}),null);assert.match(reason({...base,index:1,username:'admin',canBypassIdentity:true}),/Первый/)});
test('loading and missing session never authorize a decision',()=>{assert.ok(reason({...base,loading:true}));assert.ok(reason({...base,username:null}));});
test('permission denial closes even own and unbound steps',()=>{assert.ok(reason({...base,canApprove:false}));assert.ok(reason({...base,canApprove:false,route:[{...route[0],username:''}]}));});
test('legacy unbound row accepts authenticated approver',()=>assert.equal(reason({...base,username:'different',route:[{...route[0],username:''}]}),null));
test('decided, unsent and missing steps cannot be decided',()=>{for(const status of ['APPROVED','RETURNED','NOT_SENT'])assert.ok(reason({...base,route:[{...route[0],status}]}));assert.ok(reason({...base,index:5}));});

const portal={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../entities/portal-access/index.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:portal});
function authority(codes,extra={}) {
  return {permissions:new Set(codes),roles:[],isLoading:false,error:null,...extra,
    hasPermission:code=>codes.includes('*')||codes.includes(code)};
}
function renderRoute({username='first',firstStatus='APPROVED',returnFor=null,loading=false,permissions=['assignment.approve'],grantState,emptyRoute=false,reusable=false}={}) {
  let stateIndex=0;
  const react=require('react');
  const emptyHook=()=>({isPending:false,mutate(){},data:{results:[]}});
  const deps={
    react:{...react,useState:initial=>[stateIndex++===0?returnFor:initial,()=>{}]},
    'next-auth/react':{useSession:()=>({status:'authenticated',data:{user:{name:username,userData:{username}}}})},
    'next/link':{default:'a'},
    'next/navigation':{usePathname:()=>'/security-ops/events/53/',useSearchParams:()=>new URLSearchParams()},
    '../approval-decision':exportsObject,
    '@/hooks/use-ops-permissions':{useOpsPermissions:()=>typeof grantState==='function'?grantState():grantState??authority(permissions,{isLoading:loading})},
    '@/entities/portal-access':portal,
    '@/hooks/use-security-event-stages':new Proxy({},{get:()=>emptyHook}),
    '@/features/forces-split/ui/chain-access':{useChainAccess:()=>({can:()=>false})},
    '@/entities/security-event':{EVENT_STEPS:[{key:'PLACEMENT'}]},
    '@/shared/lib/date':{formatIsoDateTime:s=>s,formatIsoDate:s=>s},
  };
  const moduleExports={};
  const screen=fs.readFileSync(path.join(__dirname,'../../features/security-event-stages/ui/ApprovalStage.tsx'),'utf8')+'\nexports.subject=ApprovalRoute;';
  vm.runInNewContext(ts.transpileModule(screen,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:moduleExports,URLSearchParams,require:id=>deps[id]??(id.startsWith('@/')||id.startsWith('./')?new Proxy({},{get:(_,key)=>key}):require(id))});
  function render() {
  stateIndex=0;
  const rows=emptyRoute?[]:route.map((row,index)=>({...row,id:String(index+1),status:index===0?firstStatus:row.status,unit:'',position:'',comment:'',decidedAt:null}));
  const root=moduleExports.subject({event:{id:'53',reconSectorPosts:[],visitObjects:emptyRoute?[{id:'visit-53'}]:[]},view:{route:rows,documentStatus:emptyRoute?'DRAFT':'SUBMITTED',status:emptyRoute?'NOT_SENT':'PENDING',documentVersion:emptyRoute?0:1,documentVersions:[],stale:false,canFixPlacement:false,...(emptyRoute?{visitObjectId:'visit-53'}:{})},rights:{approve:true,returnBack:true,send:false,manageRoute:false}});
  const nodes=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);if(n.type==='RightGate')walk(n.props.children('hint'));else walk(n.props?.children);}walk(root);return nodes;
  }
  return reusable?render:render();
}
for(const [username,firstStatus,enabled] of [['first','APPROVED',false],['second','PENDING',false],['second','APPROVED',true]])test('rendered decision buttons: '+username+' / '+firstStatus,()=>{
  const nodes=renderRoute({username,firstStatus});
  const tableRows=nodes.filter(n=>n.type==='tr');const row=tableRows.at(-1);
  const buttons=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;if(n.type==='Button')buttons.push(n);if(n.type==='RightGate')walk(n.props.children('hint'));else walk(n.props?.children);}walk(row);
  for(const label of ['Согласовать','Вернуть']){const button=buttons.find(n=>n.props.children===label);assert.ok(button);assert.equal(button.props.disabled,!enabled);}
});
test('open return dialog closes decision when identity no longer matches',()=>{const nodes=renderRoute({username:'first',returnFor:'2'});const button=nodes.find(n=>n.type==='Button'&&n.props.children==='Подтвердить возврат');assert.ok(button);assert.equal(button.props.disabled,true);});
test('own return dialog permits current signer',()=>{const nodes=renderRoute({username:'second',returnFor:'2'});const button=nodes.find(n=>n.type==='Button'&&n.props.children==='Подтвердить возврат');assert.equal(button.props.disabled,false);});

function emptyRoutePanel(nodes) {
  const panel=nodes.find(node=>node.props?.['data-slot']==='approval-route-empty');
  assert.ok(panel,'the real selected-visit empty route must remain readable');
  return panel;
}
function textOf(node) {
  if(Array.isArray(node))return node.map(textOf).join('');
  if(node===null||node===undefined||typeof node==='boolean')return '';
  return typeof node==='object'?textOf(node.props?.children):String(node);
}
const settingsLinks=nodes=>nodes.filter(node=>node.type==='a'&&node.props.href==='/security-ops/settings');
for(const [name,grants,linked] of [
  ['source-only reader',authority(['event.view','assignment.approve']),false],
  ['settings destination grant',authority(['event.view','settings.view']),true],
  ['wildcard',authority(['*']),true],
  ['unknown authority despite cached checker',authority(['*'],{permissions:undefined}),false],
  ['loading cached settings grant',authority(['event.view','settings.view'],{isLoading:true}),false],
  ['failed cached settings grant',authority(['event.view','settings.view'],{error:Error('permissions unavailable')}),false],
])test('selected-visit empty approval route settings destination: '+name,()=>{
  const nodes=renderRoute({emptyRoute:true,grantState:grants});
  assert.equal(settingsLinks(nodes).length,linked?1:0);
  assert.match(textOf(emptyRoutePanel(nodes)),/администратор/);
  assert.ok(nodes.some(node=>node.props?.['data-slot']==='approval-subtitle'));
  const send=nodes.find(node=>node.type==='Button'&&node.props.children==='Отправить на согласование');
  assert.equal(send.props.disabled,true,'an empty route must not acquire send rights');
});
test('same approval route drops the settings anchor after destination grant revocation',()=>{
  let grants=authority(['event.view','settings.view']);
  const render=renderRoute({emptyRoute:true,grantState:()=>grants,reusable:true});
  const before=render();
  assert.equal(settingsLinks(before).length,1);
  const explanation=textOf(emptyRoutePanel(before));
  grants=authority(['event.view','assignment.approve']);
  const after=render();
  assert.equal(settingsLinks(after).length,0);
  assert.equal(textOf(emptyRoutePanel(after)),explanation);
});
