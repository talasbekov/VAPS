const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.join(__dirname,'../../entities/protected-person/model');
function load(name){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',code)(request=>{assert.equal(request,'./types');return load('types')},module,module.exports);
 return module.exports;
}
const {eventsForProtectedPerson,objectsForProtectedPerson}=load('event-links');
const person={id:'1',name:'Одинаковое Имя'};
const event=(id,fields={})=>({id,code:'ОМ-'+id,protectedPersonId:null,protectedPersons:[],visitObjects:[],objectId:'old-object',objectName:'Старый единственный объект',...fields});
test('all three direct identities survive missing assembled summaries',()=>{
 const events=[event('main',{protectedPersonId:'1'}),event('list',{protectedPersons:[{id:'1'}]}),event('visit',{visitObjects:[{protectedPersonId:'1'}]}),event('other')];
 assert.deepEqual(eventsForProtectedPerson(person,events,{}).map(e=>e.id),['main','list','visit']);
});
test('a foreign stable identity cannot match by the same name',()=>{
 const events=[event('foreign'),event('own'),event('legacy')];
 const summaries=Object.fromEntries(events.map(e=>[e.code,{summary:{persons:[{name:'  ОДИНАКОВОЕ ИМЯ ',...(e.id==='legacy'?{}:{personId:e.id==='own'?'1':'2'})}]}}]));
 assert.deepEqual(eventsForProtectedPerson(person,events,summaries).map(e=>e.id),['own','legacy']);
});
test('only visits explicitly belonging to the person become object links',()=>{
 const events=[event('multi',{protectedPersonId:'1',visitObjects:[{objectId:'a',objectName:'Свой',protectedPersonId:'1'},{objectId:'b',objectName:'Чужой',protectedPersonId:'2'}]})];
 assert.deepEqual(objectsForProtectedPerson(person,events),[{id:'a',name:'Свой'}]);
});
test('a bulletin-only relation does not imply an unspecified visit',()=>{
 assert.deepEqual(objectsForProtectedPerson(person,[event('main',{protectedPersonId:'1',visitObjects:[{objectId:'a',objectName:'Без привязки',protectedPersonId:null}]})]),[]);
});
test('legacy single-object records remain usable and repeated visits deduplicate',()=>{
 const events=[event('legacy'),event('new',{visitObjects:[{objectId:'old-object',objectName:'Старый единственный объект',protectedPersonId:'1'},{objectId:'b',objectName:'Второй',protectedPersonId:'1'},{objectId:'b',objectName:'Второй',protectedPersonId:'1'}]})];
 assert.deepEqual(objectsForProtectedPerson(person,events),[{id:'old-object',name:'Старый единственный объект'},{id:'b',name:'Второй'}]);
});
test('blank legacy object names are not rendered as empty links',()=>{
 assert.deepEqual(objectsForProtectedPerson(person,[event('blank',{objectId:null,objectName:' '})]),[]);
});
