const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function renderAccount(query={},global=true) {
 const exports={};
 const overrides={
  '@/hooks/use-ops-permissions':{useOpsPermissions:()=>({hasGlobalPermission:()=>global})},
  '@/hooks/use-ops-protected-read':{useOpsReadAccess:()=>({allowed:true,scope:'test',actor:'1'}),useOpsProtectedRead:()=>query},
  '@/lib/ops-api':{opsApiClient:{}},
  '@/components/ui/button':{Button:({children,...props})=>React.createElement('button',props,children)},
  '@/shared/lib/date':{formatIsoDateTime:value=>value},
 };
 const source=fs.readFileSync(path.join(__dirname,'../../app/settings/users/account-effective-access.tsx'),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output,{exports,require:name=>overrides[name]??require(name)});
 return renderToStaticMarkup(React.createElement(exports.AccountEffectiveAccess,{userId:7}));
}
const data={isActive:true,checkedAt:'2026-10-27T10:00:00Z',permissions:['status.view'],globalPermissions:[],
 grants:[{roleCode:'READER',roleName:'Scoped Reader',scopeDivisionId:5,scopeName:'Department Five',
 sources:['temporary'],temporaryEndsAt:['2026-10-28T10:00:00Z'],permissions:[{code:'status.view',name:'Read statuses'}]}],scopeNotice:'Scope notice'};
test('effective access explains actual role scope and temporary expiry',()=>{
 const html=renderAccount({data,isFetching:false,isError:false});
 assert.match(html,/Scoped Reader/);assert.match(html,/Department Five/);assert.match(html,/2026-10-28/);assert.match(html,/Read statuses/);
});
test('cached permission details disappear when refresh fails',()=>{
 const html=renderAccount({data,isError:true,isFetching:false});
 assert.match(html,/Не удалось проверить права/);assert.doesNotMatch(html,/Scoped Reader|Department Five|Read statuses/);
});
test('permission details stay hidden during revalidation',()=>{
 const html=renderAccount({data,isFetching:true,isError:false});
 assert.match(html,/Проверяем действующие права/);assert.doesNotMatch(html,/Scoped Reader|Department Five/);
});
test('scoped administrative permission never shows global account inspection',()=>{
 assert.equal(renderAccount({data},false),'');
});
test('blocked account does not claim its stored roles are usable',()=>{
 const html=renderAccount({data:{...data,isActive:false,permissions:[]},isFetching:false});
 assert.match(html,/Учётная запись заблокирована/);assert.doesNotMatch(html,/Действующих разрешений:/);
});

