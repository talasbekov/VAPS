import { test, expect, signIn } from './ux-fixture';
import type { ForceCollectionRow } from '@/entities/security-event/model/types';

const row: ForceCollectionRow = {
  eventId: '901', code: 'ОМ-901', title: 'Подготовка наряда для встречи делегации на нескольких объектах посещения',
  businessDate: '2026-10-23', eventTime: '10:00', location: 'Учебный объект', stage: 'FORCES',
  need: 217, requested: 201, allocating: 190, sent: 111, shortage: 73, allocated: 190, gathered: 111,
  boardStatus: { code: 'ANSWERED', label: 'Ответы получены 9 из 19 департаментов', answered: 9, total: 19 },
  urgent: true, isNew: false, departments: 19, collectionStatus: 'IN_PROGRESS', overdueCount: 3,
  visitObjects: [{ visitObjectId: '7', objectId: '1', objectName: 'Объект с длинным названием для проверки переноса текста', stage: 'FORCES' }],
};

for (const width of [320, 390, 1024, 1280, 1440]) {
  test(`collection indicators, status and opening action fit the workspace at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['forces.command', 'event.view', 'status.view'], global_permissions: ['forces.command', 'event.view', 'status.view'], roles: [],
    } }));
    await page.route('**/api/ops/security-events/forces/campaigns/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { results: [] } });
    });
    await page.route('**/api/ops/security-events/forces/collections/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { results: [row] } });
    });
    await page.route('**/api/ops/security-events/901/force-collection/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...row, canCollect: true, needByObject: [], allocations: [], demandRows: [],
        totals: { need: row.need, requested: row.requested, allocating: row.allocating, sent: row.sent, shortage: row.shortage },
        remaining: 73, roster: [], objects: [], handover: {} } });
    });
    await signIn(page); await page.goto('/employees/?view=forces&tab=collections&date=2026-10-23');
    const section = page.locator('section[aria-labelledby="force-collections-heading"]');
    const item = section.locator('[data-slot="force-collection-row"]');
    await expect(item).toHaveCount(1);
    await expect(item.locator('[data-slot="collection-requested"]')).toHaveText('201');
    await expect(item.locator('[data-slot="collection-allocating"]')).toHaveText('190');
    await expect(item.locator('[data-slot="collection-sent"]')).toContainText('111 из 217');
    await expect(item.locator('[data-slot="collection-shortage"]')).toHaveText('73');
    await expect(item.locator('[data-slot="collection-status"]')).toHaveText(row.boardStatus.label);
    const action = item.getByRole('button', { name: 'Открыть сбор ОМ-901', exact: true });
    await expect(action).toHaveCount(1);
    const geometry = await item.evaluate(element => {
      const clip = element.closest('[data-slot="table-container"]')!;
      const bounds = clip.getBoundingClientRect();
      const inside = (node: Element) => { const r = node.getBoundingClientRect(); return r.left >= bounds.left - 1 && r.right <= bounds.right + 1; };
      return { overflow: clip.scrollWidth > clip.clientWidth + 1,
        actionInside: inside(element.querySelector('button[aria-label^="Открыть сбор "]')!),
        statusInside: inside(element.querySelector('[data-slot="collection-status"]')!),
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(geometry).toEqual({ overflow: false, actionInside: true, statusInside: true, pageOverflow: false });
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width < 1400) for (const label of ['Дата ОМ', 'Потребность', 'Запрошено', 'Выделяют', 'Прислано', 'Недобор', 'Статус']) {
      await expect(item.locator('span[aria-hidden="true"]').filter({ hasText: new RegExp('^' + label + '$') })).toBeVisible();
    }
    await action.click(); await expect(page).toHaveURL(/collection=901/);
    await expect(page).toHaveURL(/date=2026-10-23/);
    await expect(page.getByRole('button', { name: 'Назад к списку сборов', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Назад к списку сборов', exact: true }).click();
    await expect(page).not.toHaveURL(/collection=/); await expect(page).toHaveURL(/date=2026-10-23/);
    await expect(section.locator('[data-slot="force-collection-row"]')).toHaveCount(1);
    expect(businessWrites).toEqual([]);
  });
}

for (const width of [320,1440]) for (const state of ['empty','error']) {
  test(`collection ${state} feedback fits at ${width}px`, async ({page,businessWrites})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/api/operations/my-permissions/**',r=>r.fulfill({json:{permissions:['forces.command','event.view','status.view'],global_permissions:['forces.command','event.view','status.view'],roles:[]}}));
    await page.route('**/api/ops/security-events/forces/campaigns/**',r=>r.request().method()==='GET'?r.fulfill({json:{results:[]}}):r.fallback());
    await page.route('**/api/ops/security-events/forces/collections/**',r=>r.request().method()!=='GET'?r.fallback():state==='empty'?r.fulfill({json:{results:[]}}):r.fulfill({status:500,json:{detail:'Сборы временно недоступны. Попробуйте обновить страницу через некоторое время.'}}));
    await signIn(page);await page.goto('/employees/?view=forces&tab=collections');
    const section=page.locator('section[aria-labelledby="force-collections-heading"]');
    if(state==='error')await expect(section.getByRole('alert')).toBeVisible();else await expect(section).toContainText('Сборов нет');
    const geometry=await section.locator('[data-slot="table-container"]').evaluate(el=>({container:el.clientWidth,content:el.scrollWidth,overflow:el.scrollWidth>el.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1}));
    expect(geometry.overflow,JSON.stringify(geometry)).toBe(false);expect(geometry.pageOverflow).toBe(false);expect(businessWrites).toEqual([]);
  });
}
