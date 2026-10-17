import {test,expect,type Page} from '@playwright/test';
import {STAND_USERNAME,STAND_PASSWORD} from './stand-credentials';
test.skip(process.env.SMOKE_LIVE!=='1','Authenticated UI with intercepted read-only fixtures');
test.use({serviceWorkers:'block'});
const APP=process.env.SMOKE_APP??'http://localhost:3106';
const event=(id:string,date:string)=>({id,code:'ОМ-ПРОВЕРКА-'+id,title:'Контрольное мероприятие '+id,businessDate:date,objectName:'Учебный объект',stage:'CONDUCT',readinessPercent:50,conflictsCount:0,forceRequests:[{requestedCount:3,allocatedCount:1}]});
async function setup(page:Page,permissions:string[],failSecond=false){
 const state={permissions,eventReads:[] as number[],strengthReads:0,permissionReads:0};
 await page.route(url=>url.pathname==='/api/operations/my-permissions/',route=>{state.permissionReads++;return route.fulfill({json:{permissions:state.permissions,roles:[]}})});
 await page.route(url=>url.pathname==='/api/ops/security-events/',route=>{
  const q=new URL(route.request().url()).searchParams,p=Number(q.get('page')||1);state.eventReads.push(p);
  if(!state.permissions.includes('event.view'))return route.fulfill({status:403,json:{message:'Нет права'}});
  if(failSecond&&p===2)return route.fulfill({status:503,json:{message:'Недоступна вторая страница'}});
  return route.fulfill({json:{count:2,owners:[],previous:null,next:p===1?APP+'/api/ops/security-events/?page=2':null,results:p===1?[event('1','2026-10-16')]:[event('2','2026-10-12')]}});
 });
 await page.route(url=>url.pathname==='/api/operations/strength-report/',route=>{state.strengthReads++;return route.fulfill({status:403,json:{message:'Нет права на расход'}})});
 const csrf=await(await page.request.get(APP+'/api/auth/csrf/')).json();const auth=await page.request.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:csrf.csrfToken,username:STAND_USERNAME,password:STAND_PASSWORD,json:'true'}});expect((await auth.json()).url).not.toContain('error=');
 await page.goto(APP+'/security-ops/command-center/');return state;
}
test('denied command center makes no event or strength request',async({page})=>{
 const state=await setup(page,['forces.view']);await expect(page.getByRole('heading',{name:'Доступ закрыт',exact:true})).toBeVisible();await page.waitForTimeout(500);
 expect(state.eventReads).toEqual([]);expect(state.strengthReads).toBe(0);
});
test('registry reader has no create action',async({page})=>{
 await setup(page,['event.view']);await expect(page.getByRole('heading',{name:'Готовность',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Создать ОМ',exact:true})).toHaveCount(0);
});
test('revoking create access closes the open creation form',async({page})=>{
 const state=await setup(page,['event.view','event.create']);await page.getByRole('button',{name:'Создать ОМ',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Создать бюллетень',exact:true});await expect(dialog).toBeVisible();
 const before=state.permissionReads;state.permissions=['event.view'];await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await expect.poll(()=>state.permissionReads).toBeGreaterThan(before);await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Создать ОМ',exact:true})).toHaveCount(0);
});
test('revoked event permission hides warm cached command data',async({page})=>{
 const state=await setup(page,['event.view']);await expect(page.getByRole('link',{name:/Контрольное мероприятие 2/})).toBeVisible();
 const before=state.permissionReads;state.permissions=[];await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await expect.poll(()=>state.permissionReads).toBeGreaterThan(before);await expect(page.getByRole('heading',{name:'Доступ закрыт',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/Контрольное мероприятие/})).toHaveCount(0);
});
test('refresh does not bypass the strength permission',async({page})=>{
 const state=await setup(page,['event.view']);await expect(page.getByRole('link',{name:/Контрольное мероприятие 1/})).toBeVisible();
 await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.getByRole('button',{name:'Обновить',exact:true})).toBeEnabled();
 expect(state.strengthReads).toBe(0);
});
test('KPI and upcoming rows include the later page',async({page})=>{
 const state=await setup(page,['event.view']);await expect(page.getByRole('link',{name:/Контрольное мероприятие 2/})).toBeVisible();
 expect(state.eventReads).toContain(2);
 const active=page.locator('[data-slot="card"]',{hasText:'Активные ОМ'}).first();await expect(active.getByText('2',{exact:true})).toBeVisible();
 const deficit=page.locator('[data-slot="card"]',{hasText:'Дефицит по ОМ'}).first();await expect(deficit.getByText('4',{exact:true})).toBeVisible();
 const links=page.getByRole('link',{name:/Контрольное мероприятие/});await expect(links.first()).toContainText('Контрольное мероприятие 2');
});
test('later page failure is not displayed as a complete partial total',async({page})=>{
 await setup(page,['event.view'],true);await expect(page.getByText('Не удалось загрузить сведения о готовности.',{exact:true})).toBeVisible();
 await expect(page.locator('[data-slot="card"]',{hasText:'Активные ОМ'})).toHaveCount(0);
 await expect(page.getByText('активных мероприятий нет',{exact:true})).toHaveCount(0);
});
