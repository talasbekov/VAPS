import {test,expect,type Page} from '@playwright/test';
import {STAND_USERNAME,STAND_PASSWORD} from './stand-credentials';
import type {SecurityEvent} from '@/entities/security-event';
test.skip(process.env.SMOKE_LIVE!=='1','Authenticated UI, intercepted event; no mutations');
test.use({serviceWorkers:'block'});
const APP=process.env.SMOKE_APP??'http://localhost:3106',API=process.env.SMOKE_API??'http://127.0.0.1:8100';
async function setup(page:Page,mode:'reader'|'manager'|'chief'|'inactive-chief'){
 const auth=await fetch(API+'/api/token/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:STAND_USERNAME,password:STAND_PASSWORD})});const {access}=await auth.json();
 const response=await fetch(API+'/api/ops/security-events/?stage=CONDUCT&page_size=50',{headers:{Authorization:'Bearer '+access}});expect(response.ok).toBeTruthy();const registry=await response.json();
 const source:SecurityEvent=registry.results.find((e:SecurityEvent)=>e.placementAssignments.length&&e.visitObjects.length);expect(source).toBeTruthy();
 const visit=source.visitObjects[0],post=source.reconSectorPosts[0],assignment=source.placementAssignments[0];
 const event={...source,stage:'CONDUCT',chiefEmployeeId:null,visitObjects:[{...visit,id:'visit-own',stage:'CONDUCT',chiefEmployeeId:'70001',deputies:[]},{...visit,id:'visit-other',stage:'CONDUCT',chiefEmployeeId:'70002',deputies:[]}],reconSectorPosts:[{...post,id:'post-own',visitObjectId:'visit-own'},{...post,id:'post-other',visitObjectId:'visit-other'}],placementAssignments:[{...assignment,id:'assignment-own',postId:'post-own'},{...assignment,id:'assignment-other',postId:'post-other',employeeId:'70003'}]};
 const state={manage:mode==='manager',reads:0,rosterReads:0,writes:0};
 await page.route(url=>url.pathname==='/api/operations/my-permissions/',route=>{state.reads++;return route.fulfill({json:{permissions:['event.view','personnel.view',...(state.manage?['event.manage']:[])],roles:[]}})});
 await page.route(url=>url.pathname==='/api/operations/my-employee/',route=>route.fulfill({json:{employee:mode==='chief'||mode==='inactive-chief'?{id:70001,is_active:mode==='chief'}:null,unlinked_reason:'fixture'}}));
 await page.route(url=>url.pathname===`/api/ops/security-events/${source.id}/`,route=>route.fulfill({json:event}));
 await page.route(url=>url.pathname==='/api/ops/personnel/',route=>{state.rosterReads++;return route.fulfill({json:{count:1,next:null,previous:null,results:[{id:'999999991',name:'Проверочный Кандидат',fullName:'Проверочный Кандидат',unit:'Управление',unitPath:'Департамент / Управление',rankLabel:'',status:'AVAILABLE',rating:null}]}})});
 await page.route(url=>url.pathname.endsWith('/conduct/replace/'),route=>{state.writes++;return route.fulfill({status:403,json:{message:'Fixture blocks writes'}})});
 const csrf=await(await page.request.get(APP+'/api/auth/csrf/')).json();await page.request.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:csrf.csrfToken,username:STAND_USERNAME,password:STAND_PASSWORD,json:'true'}});
 await page.goto(APP+`/security-ops/events/${source.id}/`);
 const panel=page.locator('[data-slot="card"]',{has:page.getByText('Замена выбывшего',{exact:true})});await expect(panel).toBeVisible();return {panel,state};
}
test('reader does not load replacement candidates',async({page})=>{
 const {panel,state}=await setup(page,'reader');await expect(panel.getByRole('button',{name:'Заменить',exact:true})).toBeDisabled();
 await expect(panel.locator('[data-slot="personnel-picker"]')).toHaveCount(0);expect(state.rosterReads).toBe(0);
});
test('inactive object chief cannot prepare replacement by identity',async({page})=>{
 const {panel,state}=await setup(page,'inactive-chief');await expect(panel.getByLabel('Кого заменить')).toBeDisabled();
 await expect(panel.locator('[data-slot="personnel-picker"]')).toHaveCount(0);expect(state.rosterReads).toBe(0);
});
test('object chief cannot choose an assignment from another object',async({page})=>{
 const {panel}=await setup(page,'chief');await expect(panel.locator('option[value="assignment-other"]')).toBeDisabled();
 await panel.getByLabel('Кого заменить').selectOption('assignment-own');await expect(panel.locator('[data-slot="personnel-picker"]')).toBeVisible();
});
test('replacement requires a reason before sending',async({page})=>{
 const {panel,state}=await setup(page,'manager');await panel.getByLabel('Кого заменить').selectOption('assignment-own');
 await panel.getByRole('button',{name:/Проверочный Кандидат/}).click();await expect(panel.getByRole('button',{name:'Заменить',exact:true})).toBeDisabled();expect(state.writes).toBe(0);
});
test('revoked permission blocks a prepared replacement and hides candidates',async({page})=>{
 const {panel,state}=await setup(page,'manager');await panel.getByLabel('Кого заменить').selectOption('assignment-own');
 await panel.getByRole('button',{name:/Проверочный Кандидат/}).click();await panel.getByLabel('Причина *',{exact:true}).fill('Учебная причина');
 await expect(panel.getByRole('button',{name:'Заменить',exact:true})).toBeEnabled();const before=state.reads;state.manage=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await expect.poll(()=>state.reads).toBeGreaterThan(before);
 await expect(panel.getByRole('button',{name:'Заменить',exact:true})).toBeDisabled();await expect(panel.locator('[data-slot="personnel-picker"]')).toHaveCount(0);expect(state.writes).toBe(0);
});
