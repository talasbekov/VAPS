import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';
import type { ProtectedPerson } from '@/entities/protected-person';

type Source = 'detail' | 'registry' | 'objectHistory' | 'personHistory';
const object: SecurityObject = { id: '1', name: 'Объект проверки доступа', code: 'UX-PRIVATE', type: 'Здание', region: 'Регион закрытых данных', address: 'Адрес', objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: true, photoUrl: null,
  sectors: [{ id: 's1', name: 'Сектор закрытых данных', posts: [{ id: 'p1', name: 'Пост закрытых данных', task: 'Задача', requirements: 'Требования' }] }],
  passportVersions: [{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-09-12', note: 'Закрытое примечание', publishedAt: '2026-09-12T10:00:00Z', publishedBy: 'UX', sectors: [{ id: 'as1', name: 'Архив закрытых данных', posts: [] }] }], createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z' };
const person: ProtectedPerson = { id: '1', name: 'Лицо проверки доступа', code: 'OL-UX', category: 'OURS', callsign: '', bio: '', country: '', position: '', facts: [], photoUrl: null };
const paths: Record<Source,string> = { detail: '/api/ops/objects/1/', registry: '/api/ops/objects/', objectHistory: '/api/ops/objects/1/history/', personHistory: '/api/ops/protected-persons/1/history/' };

async function prepare(page: Page) {
  const state = { fail: { detail: 0, registry: 0, objectHistory: 0, personHistory: 0 }, responses: { detail: 0, registry: 0, objectHistory: 0, personHistory: 0 } };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['object.view','object.manage','catalog.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const source = (Object.keys(paths) as Source[]).find(key => paths[key] === url.pathname);
    if (source) {
      state.responses[source]++;
      if (state.fail[source]) return route.fulfill({ status: state.fail[source], json: { detail: 'Отказ чтения проверки' } });
      if (source === 'detail') return route.fulfill({ json: object });
      if (source === 'registry') return route.fulfill({ json: { results: [object], freshness: [], unavailableKpi: [], kpi: { total: 1, passportGreen: 1, passportYellow: 0, passportRed: 0, verificationOverdue: 0, neverPublished: 0 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
      const common = { eventId: 'ux-history', code: 'UX-HISTORY', title: 'Закрытая история проверки', kind: null, businessDate: '2026-09-12', businessDateEnd: null, closedAt: '2026-09-12T12:00:00Z', chiefName: 'Старший закрытой истории' };
      return route.fulfill({ json: { results: [{ ...common, ...(source === 'objectHistory' ? { persons: [{ personId: '1', name: 'Лицо закрытой истории', visitDay: null }] } : { objects: [{ visitObjectId: '1', objectId: '1', objectName: 'Объект закрытой истории', visitDay: null, note: '' }] }) }] } });
    }
    if (url.pathname === '/api/ops/protected-persons/') return route.fulfill({ json: { results: [person] } });
    if (url.pathname === '/api/ops/security-events/') return route.fulfill({ json: { results: [], count: 0 } });
    return route.fallback();
  });
  await page.clock.install(); await signIn(page); return state;
}
async function refresh(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

for (const status of [403,404]) for (const kind of ['passport','version'] as const) test(`${kind}: denied${status} cache stays hidden through retry503`, async ({ page,businessWrites }) => {
  const state = await prepare(page);
  await page.goto(kind === 'passport' ? '/security-ops/objects/1?tab=posts' : '/security-ops/objects/1/passports/v1');
  const secret = kind === 'passport' ? page.getByLabel('Название сектора',{ exact:true }) : page.getByRole('heading',{ name:'Архив закрытых данных',exact:true });
  await expect(secret).toBeVisible(); state.fail.detail=status; await refresh(page); await expect(secret).toHaveCount(0);
  state.fail.detail=503;const count=state.responses.detail;
  const response=page.waitForResponse(row=>new URL(row.url()).pathname===paths.detail&&row.status()===503);
  await page.getByRole('button',{ name:'Повторить',exact:true }).click();await(await response).finished();await expect.poll(()=>state.responses.detail).toBe(count+2);
  await expect(page.getByRole('button',{ name:'Повторить',exact:true })).toBeEnabled(); await expect(secret).toHaveCount(0);
  state.fail.detail=0; await page.getByRole('button',{ name:'Повторить',exact:true }).click(); await expect(secret).toBeVisible(); expect(businessWrites).toEqual([]);
});

for (const status of [403,404]) test(`registry: denied${status} hides cached regions and aggregates until200`,async ({ page,businessWrites })=>{
  const state=await prepare(page);await page.goto('/security-ops/objects/');
  const summary=page.locator('main summary').filter({hasText:'Сводка по объектам'});
  await summary.click();
  const kpi=page.getByRole('region',{name:'Показатели реестра',exact:true});await expect(kpi).toBeVisible();
  state.fail.registry=status;await refresh(page);
  if(status===403){
    await expect(page.getByRole('heading',{name:'Доступ закрыт',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Повторить',exact:true})).toHaveCount(0);
  }else{
    await expect(page.getByText('Не удалось загрузить реестр объектов.',{exact:true})).toBeVisible();
  }
  await expect(kpi).toHaveCount(0);await expect(page.getByRole('group',{name:'Раздел реестра',exact:true})).toHaveCount(0);
  await expect(page.getByText('Регион закрытых данных',{exact:true})).toHaveCount(0);
  state.fail.registry=503;
  const count=state.responses.registry,response=page.waitForResponse(row=>new URL(row.url()).pathname===paths.registry&&row.status()===503);
  if(status===403)await refresh(page);else await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await(await response).finished();await expect.poll(()=>state.responses.registry).toBe(count+2);
  await expect(page.getByRole('button',{name:'Повторить',exact:true})).toBeEnabled();await expect(kpi).toHaveCount(0);
  state.fail.registry=0;await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await summary.click();await expect(kpi).toBeVisible();expect(businessWrites).toEqual([]);
});

for(const source of ['objectHistory','personHistory'] as const) for(const status of [403,404]) test(`${source}: denial${status} removes saved rows and inline retry waits for200`,async({page,businessWrites})=>{
  const state=await prepare(page);await page.goto(source==='objectHistory'?'/security-ops/objects/?view=table':'/security-ops/persons/');
  const button=source==='objectHistory'?page.getByRole('button',{name:'История мероприятий: '+object.name,exact:true}):page.getByRole('button',{name:'История',exact:true});
  await button.click();const dialog=page.getByRole('dialog',{name:'История мероприятий',exact:true});
  const row=dialog.getByText('UX-HISTORY · Закрытая история проверки',{exact:true});await expect(row).toBeVisible();
  state.fail[source]=status;await refresh(page);await expect(dialog.getByText(/История сейчас недоступна|Не удалось загрузить историю мероприятий/)).toBeVisible();await expect(row).toHaveCount(0);
  state.fail[source]=503;const count=state.responses[source],response=page.waitForResponse(row=>new URL(row.url()).pathname===paths[source]&&row.status()===503);await dialog.getByRole('button',{name:'Повторить',exact:true}).click();await(await response).finished();await expect.poll(()=>state.responses[source]).toBe(count+2);await expect(dialog.getByRole('button',{name:'Повторить',exact:true})).toBeEnabled();await expect(row).toHaveCount(0);await expect(dialog).toBeVisible();
  state.fail[source]=0;await dialog.getByRole('button',{name:'Повторить',exact:true}).click();await expect(row).toBeVisible();expect(businessWrites).toEqual([]);
});

for(const source of ['objectHistory','personHistory'] as const) test(`${source}: transient503 keeps readonly rows and retries inside the dialog`,async({page,businessWrites})=>{
  const state=await prepare(page);await page.goto(source==='objectHistory'?'/security-ops/objects/?view=table':'/security-ops/persons/');
  await (source==='objectHistory'?page.getByRole('button',{name:'История мероприятий: '+object.name,exact:true}):page.getByRole('button',{name:'История',exact:true})).click();
  const dialog=page.getByRole('dialog',{name:'История мероприятий',exact:true}),row=dialog.getByText('UX-HISTORY · Закрытая история проверки',{exact:true});await expect(row).toBeVisible();
  state.fail[source]=503;await refresh(page);await expect(dialog.getByText(/История сейчас недоступна|Не удалось загрузить историю мероприятий/)).toBeVisible();await expect(row).toBeVisible();await expect(dialog.getByText('Закрытых мероприятий пока нет.',{exact:true})).toHaveCount(0);
  state.fail[source]=0;await dialog.getByRole('button',{name:'Повторить',exact:true}).click();await expect(dialog.getByText(/Не удалось загрузить историю мероприятий/)).toHaveCount(0);await expect(row).toBeVisible();expect(businessWrites).toEqual([]);
});
