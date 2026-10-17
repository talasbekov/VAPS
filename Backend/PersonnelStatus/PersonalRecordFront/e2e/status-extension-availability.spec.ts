import { expect, test } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
test.describe('current status extension availability', () => {
 test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal with explicit read fixtures; unmocked writes forbidden');
 for (const scenario of [
  { name: 'indefinite in-service', type: 'in_service', end: null, state: 'active', extend: false, terminate: false },
  { name: 'missing end date', type: 'in_service', end: undefined, state: 'active', extend: false, terminate: false },
  { name: 'indefinite other status', type: 'other_absence', end: null, state: 'active', extend: false, terminate: true },
  { name: 'dated active status', type: 'vacation', end: '2026-10-30', state: 'active', extend: true, terminate: true },
  { name: 'completed dated status', type: 'vacation', end: '2026-10-01', state: 'completed', extend: false, terminate: false },
  { name: 'reopened dialog resets extension when current status becomes indefinite', type: 'vacation', end: '2026-10-30', state: 'active', extend: true, terminate: true, switchToIndefinite: true },
 ]) test(scenario.name, async ({ page }) => {
  await page.route('**/api/**', route => !['GET','HEAD','OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.fulfill({status:403,json:{detail:'Unmocked writes forbidden'}}) : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({json:{permissions:['status.view','status.workspace','status.manage'],global_permissions:['status.manage'],status_manage_division_ids:null,roles:[]}}));
  const current = {id:5256,status_type:scenario.type,state:scenario.state,start_date:'2026-10-09',end_date:scenario.end,comment:''};
  const unit = {id:10,index:1,parent_id:null,vacancy:null,division:{id:3,name:'Отдел'},directorate_id:3,directorate_name:'Управление',employee:{id:1,last_name:'Тестовый',first_name:'Сотрудник',current_status:current},position:{id:1,name:'Инспектор',level:1}};
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({json:{division:null,staff_units:[unit],total_count:1,matched_count:1,page:1,page_size:50,has_next:false}}));
  await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({json:{current,planned:[]}}));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({json:{count:0,next:null,previous:null,results:[]}}));
  const csrf=await(await page.request.get(APP+'/api/auth/csrf/')).json();
  expect((await page.request.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:csrf.csrfToken,username:STAND_USERNAME,password:STAND_PASSWORD,json:'true'}})).ok()).toBeTruthy();
  await page.goto(APP+'/statuses/');
  await page.getByRole('button',{name:'Действия: Тестовый Сотрудник',exact:true}).click();
  await page.getByRole('menuitem',{name:'Запланированные статусы',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText('Дата окончания',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Продлить',exact:true})).toHaveCount(scenario.extend?1:0);
  await expect(dialog.getByRole('button',{name:'Завершить досрочно',exact:true})).toHaveCount(scenario.terminate?1:0);
  if ('switchToIndefinite' in scenario) {
   await dialog.getByRole('button',{name:'Продлить',exact:true}).click();
   await expect(dialog.getByText('Продление статуса',{exact:true})).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(dialog).toHaveCount(0);
   current.end_date=null; current.status_type='in_service';
   await page.getByRole('button',{name:'Действия: Тестовый Сотрудник',exact:true}).click();
   const loaded=page.waitForResponse(response=>response.url().includes('/api/statuses/statuses/planned/'));
   await page.getByRole('menuitem',{name:'Запланированные статусы',exact:true}).click();
   await loaded;
   await expect(dialog.getByText('Дата окончания',{exact:true})).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Продлить',exact:true})).toHaveCount(0);
  }
 });
});
