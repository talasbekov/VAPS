import {test,expect} from '@playwright/test';
import {STAND_USERNAME,STAND_PASSWORD} from './stand-credentials';
import type {SecurityEvent} from '@/entities/security-event';
test.skip(process.env.SMOKE_LIVE!=='1','Authenticated UI with isolated stage responses');
test.use({serviceWorkers:'block'});
const APP=process.env.SMOKE_APP??'http://localhost:3106',API=process.env.SMOKE_API??'http://127.0.0.1:8100';
for(const stage of ['APPROVAL','ACKNOWLEDGEMENT','CONDUCT'] as const)for(const active of [false,true]){
 test(`${stage}: ${active?'active':'inactive'} chief delegated actions`,async({page})=>{
  await page.clock.install();
  const tokenResponse=await fetch(API+'/api/token/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:STAND_USERNAME,password:STAND_PASSWORD})});const {access}=await tokenResponse.json();
  const registryResponse=await fetch(API+'/api/ops/security-events/?stage=CONDUCT&page_size=50',{headers:{Authorization:'Bearer '+access}});expect(registryResponse.ok).toBeTruthy();
  const registry=await registryResponse.json();const source:SecurityEvent=registry.results.find((e:SecurityEvent)=>e.placementAssignments.length&&e.visitObjects.length===1);expect(source).toBeTruthy();
  const chief='70001';let identityFails=false,identityReads=0,writes=0;
  const event={...source,stage,chiefEmployeeId:chief,approvalStatus:'DRAFT',visitObjects:source.visitObjects.map(v=>({...v,stage,chiefEmployeeId:chief,deputies:[],approvalStatus:'DRAFT',approvalSentAt:null,approvalStale:false,approvalRoute:v.approvalRoute.map(a=>({...a,status:'WAITING',signature:null}))}))};
  if(stage==='ACKNOWLEDGEMENT')event.placementAssignments=event.placementAssignments.map(a=>({...a,acknowledgedAt:null,declinedAt:null}));
  await page.route(url=>url.pathname==='/api/operations/my-permissions/',route=>route.fulfill({json:{permissions:['event.view','personnel.view'],roles:[]}}));
  await page.route(url=>url.pathname==='/api/operations/my-employee/',route=>{identityReads++;return route.fulfill(identityFails?{status:503,json:{message:'Не удалось проверить кадровую запись'}}:{json:{employee:{id:Number(chief),is_active:active,full_name:'Учебный старший'},unlinked_reason:null}})});
  await page.route(url=>url.pathname===`/api/ops/security-events/${source.id}/`,route=>route.fulfill({json:event}));
  await page.route('**/api/ops/security-events/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes++;return route.fulfill({status:409,json:{message:'Read-only fixture'}})}return route.fallback()});
  const csrf=await(await page.request.get(APP+'/api/auth/csrf/')).json();await page.request.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:csrf.csrfToken,username:STAND_USERNAME,password:STAND_PASSWORD,json:'true'}});
  await page.goto(APP+`/security-ops/events/${source.id}/`);
  const label=stage==='APPROVAL'?'Отправить на согласование':stage==='ACKNOWLEDGEMENT'?'Завершить ознакомление':'Закрыть объект';
  const button=page.getByRole('button',{name:label,exact:true});await expect(button).toBeVisible();
  if(active){
   await expect(button).toBeEnabled();
   // Keep a confirmation open while identity is revalidated.
   const confirm=page.getByRole('button',{name:stage==='ACKNOWLEDGEMENT'?'Завершить без подтверждения всех':'Подтвердить закрытие',exact:true});
   if(stage!=='APPROVAL'){
    await button.click();
    if(stage==='ACKNOWLEDGEMENT')await page.getByRole('dialog').getByLabel('Комментарий',{exact:true}).fill('Проверка отзыва полномочий до подтверждения');
    await expect(confirm).toBeEnabled();
   }
   const before=identityReads;identityFails=true;
   await page.clock.fastForward(61000);
   await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
   await expect.poll(()=>identityReads).toBeGreaterThan(before);
   if(stage!=='APPROVAL'){
    await expect(confirm).toBeDisabled();
    await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
   }
   await expect(button).toBeDisabled();
  }
  else await expect(button).toBeDisabled();
  expect(writes).toBe(0);
 });
}
