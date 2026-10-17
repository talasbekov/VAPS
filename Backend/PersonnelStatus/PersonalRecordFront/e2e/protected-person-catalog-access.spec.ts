import { test, expect, type Page } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated UI, catalog responses intercepted without application writes');
const APP=process.env.SMOKE_APP ?? 'http://localhost:3106';
const person={id:'catalog-probe-1',code:'OL-ПРОБА',name:'Каталог Проверка Фото',callsign:'Тест',category:'OURS',bio:'',photoUrl:null,country:'',position:'',facts:[]};
const event=(id: string,changes: Record<string, unknown>={})=>({id,code:'ОМ-КАТАЛОГ-'+id,title:'Проверка связи '+id,businessDate:'2026-10-12',objectId:'catalog-object-1',objectName:'Первый объект',protectedPersonId:null,protectedPersons:[],visitObjects:[],...changes});
async function setup(page: Page,{allowed=true,photo=false,photoFailure=false,pages=[[event('1')]],summaries=[],failSecond=false}={}) {
 const state={allowed,eventReads:[] as number[],linkReads:[] as number[],summaryReads:0,photoReads:0,permissionReads:0};
 await page.route(url=>url.pathname==='/api/operations/my-permissions/',route=>{
  state.permissionReads++;
  return route.fulfill({json:{permissions:['catalog.view',...(state.allowed?['event.view']:[])],roles:[]}});
 });
 await page.route(url=>url.pathname==='/api/ops/protected-persons/',route=>route.fulfill({json:{results:[{...person,photoUrl:photo?'/api/ops/protected-persons/catalog-probe-1/photo/':null}]}}));
 await page.route(url=>url.pathname==='/api/ops/protected-persons/catalog-probe-1/photo/',route=>{
  state.photoReads++;
  if(photoFailure)return route.fulfill({status:403,json:{message:'Фото недоступно'}});
  return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=','base64')});
 });
 await page.route(url=>url.pathname==='/api/ops/security-events/',route=>{
  const params=new URL(route.request().url()).searchParams;
  const pageNumber=Number(params.get('page')||1);state.eventReads.push(pageNumber);
  if(params.get('page_size')==='200')state.linkReads.push(pageNumber);
  if(!state.allowed)return route.fulfill({status:403,json:{message:'Нет права'}});
  if(failSecond&&pageNumber===2)return route.fulfill({status:503,json:{message:'Вторая страница недоступна'}});
  return route.fulfill({json:{count:pages.flat().length,owners:[],previous:null,next:pageNumber<pages.length?APP+'/api/ops/security-events/?page=2&page_size=200':null,results:pages[pageNumber-1]||[]}});
 });
 await page.route(url=>url.pathname==='/api/ops/gvo-summaries/assembled/',route=>{
  state.summaryReads++;
  return route.fulfill(state.allowed?{json:{results:summaries}}:{status:403,json:{message:'Нет права'}});
 });
 const csrf=await(await page.request.get(APP+'/api/auth/csrf/')).json();
 const response=await page.request.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:csrf.csrfToken,username:STAND_USERNAME,password:STAND_PASSWORD,json:'true'}});
 expect((await response.json()).url).not.toContain('error=');
 await page.goto(APP+'/security-ops/persons/');
 const card=page.locator('article',{has:page.getByRole('heading',{name:person.name,exact:true})});
 await expect(card).toBeVisible();
 return {state,card};
}
test('catalog-only user does not request forbidden event data',async({page})=>{
 const {state,card}=await setup(page,{allowed:false});
 await card.getByRole('button',{name:'Все мероприятия с ОЛ',exact:true}).click();
 await expect(card).toContainText('Для просмотра связанных мероприятий нужно право');
 expect(state.eventReads).toEqual([]);expect(state.summaryReads).toBe(0);
});
test('links are loaded on expansion, not for every catalog visit',async({page})=>{
 const {state,card}=await setup(page);
 await page.waitForTimeout(800);
 // The sidebar may read one row for its authorized registry counter.
 expect(state.linkReads).toEqual([]);expect(state.summaryReads).toBe(0);
 await card.getByRole('button',{name:'Все мероприятия с ОЛ',exact:true}).click();
 await expect.poll(()=>state.linkReads.length).toBeGreaterThan(0);
});
test('catalog displays a protected photo with a real decoded image',async({page})=>{
 const {state,card}=await setup(page,{photo:true});
 const photo=card.getByRole('img',{name:person.name,exact:true});
 await expect(photo).toBeVisible();
 await expect.poll(()=>photo.evaluate(image=>image instanceof HTMLImageElement && image.complete && image.naturalWidth>0)).toBe(true);
 expect(state.photoReads).toBe(1);
});
test('a direct relation on the second page is included',async({page})=>{
 const {state,card}=await setup(page,{pages:[[event('1')],[event('2',{protectedPersonId:person.id})]]});
 await card.getByRole('button',{name:'Все мероприятия с ОЛ',exact:true}).click();
 await expect(card.getByRole('link',{name:'ОМ-КАТАЛОГ-2',exact:true})).toBeVisible();
 expect(state.eventReads).toContain(2);
});
test('a failed later page is not reported as no matching events',async({page})=>{
 const {card}=await setup(page,{pages:[[event('1')],[event('2')]],failSecond:true});
 await card.getByRole('button',{name:'Все мероприятия с ОЛ',exact:true}).click();
 await expect(card).toContainText('Не удалось загрузить связанные мероприятия');
 await expect(card).not.toContainText('связанных мероприятий и объектов нет');
});
test('object links belong to the selected person, not another visitor',async({page})=>{
 const {card}=await setup(page,{pages:[[event('1',{protectedPersonId:person.id,visitObjects:[
  {id:'visit-a',objectId:'object-a',objectName:'Объект выбранного лица',protectedPersonId:person.id},
  {id:'visit-b',objectId:'object-b',objectName:'Объект другого лица',protectedPersonId:'other-person'},
 ]})]]});
 await card.getByRole('button',{name:'Объекты ОЛ',exact:true}).click();
 await expect(card.getByRole('link',{name:'Объект выбранного лица',exact:true})).toBeVisible();
 await expect(card).not.toContainText('Объект другого лица');
});
test('revoking event access hides warm cached links while keeping the catalog',async({page})=>{
 await page.clock.install();
 const {state,card}=await setup(page,{pages:[[event('1',{protectedPersonId:person.id})]]});
 await card.getByRole('button',{name:'Все мероприятия с ОЛ',exact:true}).click();
 await expect(card.getByRole('link',{name:'ОМ-КАТАЛОГ-1',exact:true})).toBeVisible();
 const before=state.permissionReads;state.allowed=false;
 await page.clock.fastForward(61000);
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await expect.poll(()=>state.permissionReads).toBeGreaterThan(before);
 await expect(card).toContainText('Для просмотра связанных мероприятий нужно право');
 await expect(card.getByRole('link',{name:'ОМ-КАТАЛОГ-1',exact:true})).toHaveCount(0);
 await expect(card.getByRole('heading',{name:person.name,exact:true})).toBeVisible();
});
test('a denied photo retains a readable fallback without a broken image',async({page})=>{
 const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const {state,card}=await setup(page,{photo:true,photoFailure:true});
 await expect.poll(()=>state.photoReads).toBe(1);
 await expect(card.getByText('Фото недоступно',{exact:true})).toBeVisible();
 await expect(card.getByRole('img',{name:person.name,exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});
