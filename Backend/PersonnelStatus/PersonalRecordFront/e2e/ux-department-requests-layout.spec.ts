import { test, expect, signIn } from './ux-fixture';
import type { DepartmentRequestRow } from '@/entities/security-event/model/types';
const rows: DepartmentRequestRow[] = [null,0,5].map((allocating,index)=>({eventId:String(901+index),allocationId:String(31+index),code:'ОМ-'+(901+index),title:'Подготовка наряда на встречу делегации с длинным названием мероприятия',businessDate:'2026-10-23',eventTime:'10:00',location:'Учебный объект с длинным названием',stage:'FORCES',departmentId:'2',departmentName:'Первый департамент',need:7,allocating,assigned:3,status:'RETURNED',dueAt:'2026-10-22T10:00:00+05:00',overdue:true,submittedLate:false}));
for(const width of [320,390,1024,1280,1440]) test(`department request values and opening controls fit at ${width}px`,async({page,businessWrites})=>{
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/operations/my-permissions/**',r=>r.fulfill({json:{permissions:['forces.allocate','status.view'],global_permissions:['forces.allocate','status.view'],roles:[]}}));
  await page.route('**/api/ops/security-events/forces/requests/**',r=>r.request().method()==='GET'?r.fulfill({json:{results:rows}}):r.fallback());
  await signIn(page);await page.goto('/employees/?view=forces&tab=requests&businessDate=2026-10-23');
  const section=page.locator('section[aria-labelledby="department-requests-heading"]'),items=section.locator('tbody tr');await expect(items).toHaveCount(3);
  for(let index=0;index<3;index++){
    const item=items.nth(index),action=item.getByRole('button',{name:new RegExp('^Открыть заявку '+rows[index].code)});
    await expect(item.locator('[data-slot="allocating"]')).toHaveText(index===0?'—':index===1?'0 · отказ':'5');
    await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow','3');await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuemax','7');
    await expect(item).toContainText('Просрочено');await expect(item).toContainText('Возвращено департаменту');await expect(action).toHaveCount(1);
    const geometry=await item.evaluate(el=>{const box=el.closest('[data-slot="table-container"]')!,clip=box.getBoundingClientRect(),r=el.querySelector('button')!.getBoundingClientRect();return{overflow:box.scrollWidth>box.clientWidth+1,actionInside:r.left>=clip.left-1&&r.right<=clip.right+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1};});
    expect(geometry).toEqual({overflow:false,actionInside:true,pageOverflow:false});expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if(width<1400)for(const name of ['Запрошено','Выделяем','Собрано','Срок','Статус'])await expect(item.locator('span[aria-hidden="true"]').filter({hasText:new RegExp('^'+name+'$')})).toBeVisible();
  }
  expect(businessWrites).toEqual([]);
});
