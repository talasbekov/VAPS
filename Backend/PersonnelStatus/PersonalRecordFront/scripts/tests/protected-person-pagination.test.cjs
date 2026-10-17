const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../hooks/use-all-security-events.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function query(get,enabled=true){
 const module={exports:{}};
 const deps={'@tanstack/react-query':{useQuery:options=>options},'@/lib/ops-api':{opsApiClient:{get}},'@/entities/security-event':{SECURITY_EVENTS_PATH:'/api/ops/security-events/'}};
 new Function('require','module','exports',code)(name=>{assert(name in deps);return deps[name]},module,module.exports);
 return module.exports.useAllSecurityEvents({enabled});
}
test('complete person links follow page numbers on our API, never an external next origin',async()=>{
 const paths=[];
 const result=await query(async path=>{paths.push(path);return paths.length===1?{results:[{id:'a'}],next:'https://untrusted.invalid/steal-token'}:{results:[{id:'b'}],next:null}}).queryFn({signal:new AbortController().signal});
 assert.deepEqual(result,[{id:'a'},{id:'b'}]);
 assert.deepEqual(paths,['/api/ops/security-events/?page=1&page_size=200','/api/ops/security-events/?page=2&page_size=200']);
});
test('failure after the first page rejects the entire selection',async()=>{
 let reads=0;
 await assert.rejects(query(async()=>{if(++reads===2)throw Error('second page failed');return {results:[{id:'a'}],next:'next'}}).queryFn({signal:new AbortController().signal}),/second page failed/);
});
test('a repeating page cannot leave an infinite request loop',async()=>{
 let reads=0;
 await assert.rejects(query(async()=>{reads++;return {results:[{id:'a'}],next:'next'}}).queryFn({signal:new AbortController().signal}),/следующую страницу/);
 assert.equal(reads,2);
});
test('disabled catalog queries preserve the common invalidation prefix',()=>{
 const options=query(()=>{throw Error('must not fetch')},false);
 assert.equal(options.enabled,false);assert.deepEqual(options.queryKey,['ops-security-events','all-person-links']);
});
test('cancellation stops before requesting another page',async()=>{
 const controller=new AbortController();let reads=0;
 await assert.rejects(query(async()=>{reads++;controller.abort();return {results:[{id:'a'}],next:'next'}}).queryFn({signal:controller.signal}),/отменена/);
 assert.equal(reads,1);
});
