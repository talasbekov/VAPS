import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { AssistantTask } from '@/features/om-assistant/model';
import path from 'node:path';

const id = '63333333-3333-4333-8333-333333333333';
const task: AssistantTask = { id, initiatedBy: 'chief', message: 'Наряд 300 человек', revision: 1,
  status: 'collecting', delegated: false, canEdit: false, canContinue: false, questions: [], interpretationNotice: null,
  plan: { title: 'Учебное ОМ', businessDate: '2026-10-25', personnelTotal: 300, objectName: 'Аккорда' },
  event: { id: '70', code: 'ОМ-70', title: 'Учебное ОМ', stage: 'FORCES', forceDemandTotal: 200, requested: 200, rosterCount: 160,
    progress: { need: 200, collected: 160, remaining: 40, departments: [
      { id: '1', name: 'Шестой департамент', requested: 40, responded: null, status: 'NOTIFIED', overdue: true },
      { id: '2', name: 'Первый департамент', requested: 160, responded: 160, status: 'ACCEPTED', overdue: false },
    ] } },
  receipts: [], updatedAt: '2026-10-23T10:00:00Z' };
async function setup(page: Page, state: {task: AssistantTask; status?:number}) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({json:{permissions:['event.create','event.view'],global_permissions:['event.create','event.view'],roles:[]}}));
  await page.route('**/api/ops/assistant/tasks/**', route => {
    if(route.request().method()!=='GET')return route.fallback();
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/configuration/'))return route.fulfill({json:{enabled:true,isHeadquarters:false}});
    if(path.endsWith('/catalogs/'))return route.fulfill({json:{objects:[],departments:[]}});
    if(path.includes(id))return route.fulfill({status:state.status??200,json:state.status?{message:'Нет доступа'}:state.task});
    return route.fulfill({json:{results:[state.task],isHeadquarters:false}});
  });
  await signIn(page);await page.goto('/security-ops/assistant/?task='+id);
}
for(const width of [320,1440])test(`commander sees actual progress and overdue department at ${width}px`,async({page,businessWrites})=>{
  await page.setViewportSize({width,height:950});await setup(page,{task});
  const progress=page.getByRole('region',{name:'Готовность наряда',exact:true});
  await expect(progress).toContainText('200');await expect(progress).toContainText('160');await expect(progress).toContainText('40');
  await expect(progress).not.toContainText('300');await expect(progress).toContainText('Шестой департамент');
  await expect(progress).toContainText('Нет ответа · Срок прошёл');
  await expect(progress.getByText('Первый департамент',{exact:true})).not.toBeVisible();
  if(process.env.UX_RESULTS_DIR)await page.screenshot({path:path.join(process.env.UX_RESULTS_DIR,`assistant-progress-${width}.png`),fullPage:true});
  await progress.getByText('Все ответы департаментов',{exact:true}).click();
  await expect(progress.getByText('Первый департамент',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});
test('finished collection and denied refresh do not leave misleading active progress',async({page,businessWrites})=>{
  const state={task,status:0};delete (state as {status?:number}).status;await setup(page,state);
  state.task={...task,status:'placement',event:{...task.event!,stage:'PLACEMENT',progress:{...task.event!.progress!,collectionClosed:true}}};
  await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();
  const progress=page.getByRole('region',{name:'Готовность наряда',exact:true});
  await expect(progress).not.toContainText('Требуют внимания');await expect(progress).not.toContainText('Срок прошёл');
  state.status=403;await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();
  await expect(progress).toHaveCount(0);expect(businessWrites).toEqual([]);
});
