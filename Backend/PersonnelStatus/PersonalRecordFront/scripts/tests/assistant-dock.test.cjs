const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function model(){const exports={};const file=path.join(__dirname,'../../features/assistant-dock/model.ts');vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});return exports;}
test('actor and authority changes synchronously hide previous assistant content',()=>{
 const m=model(),old={owner:'actor1:permissions1',open:true,message:'private proposal',taskId:'task1',visited:true};
 assert.equal(m.visibleDock(old,old.owner),old);
 for(const owner of ['actor2:permissions1','actor1:permissions2','']){
  const value=m.visibleDock(old,owner);assert.equal(value.open,false);assert.equal(value.message,'');assert.equal(value.taskId,null);assert.equal(value.visited,false);
 }
});
test('submitting retains text and starts a new proposal without a business write',()=>{
 const m=model(),state=m.visibleDock(null,'actor1');const next=m.submitDock(state,'actor1','  Поручение\nна завтра  ');
 assert.equal(next.open,true);assert.equal(next.message,'Поручение\nна завтра');assert.equal(next.taskId,null);assert.equal(next.owner,'actor1');
 assert.equal(m.submitDock(state,'actor1','   '),null);assert.equal(m.submitDock(state,'actor1','x'.repeat(4001)),null);
 assert.equal(state.open,false);
});
test('role navigation help uses only supplied permitted routes and no invented data',()=>{
 const m=model(),entries=[{id:'personal',title:'Мой профиль',description:'Личные сведения',href:'/my-profile'},
  {id:'status',title:'Статусы сотрудников',description:'Присутствие подразделения',href:'/statuses'}];
 const result=m.guideLinks('Где статусы?',entries);assert.equal(result.length,1);assert.equal(result[0].href,'/statuses');
 const fallback=m.guideLinks('Объясни неизвестный вопрос',entries);assert.equal(fallback.length,2);
 assert.ok(fallback.every(x=>entries.includes(x)));assert.equal(m.guideLinks('Мой профиль',[]).length,0);
});
test('a new documentation question retains existing task selection, page and draft',()=>{
 const m=model(),old={owner:'a',open:false,message:'draft',taskId:'saved',visited:true};
 const reopened=m.visibleDock(old,'a');assert.equal(reopened.taskId,'saved');
 assert.equal(m.submitDock({...old,page:2,taskMessage:'Existing OM',taskGeneration:4},'a','new request').taskId,'saved');
 assert.equal(m.submitDock({...old,page:2,taskMessage:'Existing OM',taskGeneration:4},'a','new request').page,2);
 assert.equal(m.submitDock({...old,page:2,taskMessage:'Existing OM',taskGeneration:4},'a','new request').taskMessage,'Existing OM');
 assert.equal(m.submitDock({...old,page:2,taskMessage:'Existing OM',taskGeneration:4},'a','new request').taskGeneration,4);
 assert.equal(m.submitDock({...old,submission:3},'a','new request').submission,4);
});
test('pending chat does not start a second submission, and new questions open dialogue',()=>{
 const m=model(),state={owner:'a',open:false,visited:true,message:'question',taskId:'saved',chatPending:true};
 assert.equal(m.submitDock(state,'a','new question'),null);
 assert.equal(m.submitDock({...state,chatPending:false},'a','new question').view,'chat');
});
test('global owner includes status-management and duty scopes through the existing authority key',()=>{
 let data={permissions:['event.create'],global_permissions:['event.create'],roles:[],status_manage_division_ids:[1],duty_register_scope:{read:['1']}};
 const React=require('react'),modules=new Map();
 const load=name=>{
  if(name==='react')return {...React,useState:()=>[null,()=>{}],useRef:()=>({current:null}),useEffect(){},useCallback:x=>x};
  if(name==='react/jsx-runtime')return require(name);
  if(name==='next-auth/react')return {useSession:()=>({status:'authenticated',data:{user:{id:'actor'}}})};
  if(name==='@tanstack/react-query')return {useQueryClient:()=>({getQueryState:()=>({status:'success',data})})};
  if(name==='@/hooks/use-ops-permissions')return {useOpsPermissions:()=>({permissions:new Set(data.permissions),globalPermissions:new Set(data.global_permissions),roles:[],isLoading:false,error:null})};
  if(name==='@/lib/ops-errors')return {OpsServerError:class extends Error{}};
  if(name==='next/navigation'||name==='lucide-react'||name.includes('.module.css')||name==='next/link'||name==='./chat')return {};
  if(name==='@/features/portal-workspace/model'||name==='@/features/om-assistant/workspace'||name==='@/features/om-assistant/model')return {};
  const file=name==='./model'?path.join(__dirname,'../../features/assistant-dock/model.ts'):path.join(__dirname,'../..',name.slice(2)+'.ts');
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:load});return exports;
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../features/assistant-dock/assistant-dock.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:load});
 const owner=()=>exports.GlobalAssistantProvider({children:null}).props.value.owner;
 const first=owner();data={...data,status_manage_division_ids:[2]};const second=owner();assert.notEqual(second,first);
 data={...data,duty_register_scope:{read:['2']}};assert.notEqual(owner(),second);
});
