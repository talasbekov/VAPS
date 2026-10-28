import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const path = '/api/core/service-employees/61/qualifications/';
const profile = {
  revision: 0, can_edit: true,
  profile: {inventory: null, skills: {shooting: 5, hand_to_hand: null, physical_fitness: null},
    health: {condition: null, chronic_conditions: null, restrictions: null}, height_cm: null, weight_kg: null, updated_at: null},
};
function empty() {
  return {revision: 0, can_edit: true, today: '2026-10-27',
    current: {shooting: {state: 'unknown', assessment: null}, hand_to_hand: {state: 'unknown', assessment: null}, physical_fitness: {state: 'unknown', assessment: null}},
    history: {results: [] as Record<string, unknown>[], count: 0, page: 1, page_size: 20}};
}
async function setup(page: Page, editable = true) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({json: {permissions: editable ? ['*'] : ['personnel.view'], global_permissions: editable ? ['*'] : ['personnel.view'], roles: []}}));
  await page.route(url => url.pathname === '/api/core/service-employees/61/', route => route.fulfill({json: {
    id: 61, full_name: 'Проверка Квалификации', personnel_number: 'TEST-61', photo_url: null, callsign: '',
    rank: null, position: 'Сотрудник', division: {id: 7, name: 'Учебное подразделение'}, current_status: {code:'IN_SERVICE', name:'В строю', date_end:null},
    rating: null, evaluations_count: 0, rated_events_count: 0, rating_state:'INSUFFICIENT_DATA', active_assignments_count: 0, next_assignment:null,
    hire_date:'2020-01-01', work_phone:null, work_email:null, assignments:[], history:[], evaluations:[],
  }}));
  await page.route(url => url.pathname === '/api/core/service-employees/61/service-profile/', route => route.fulfill({json: {...profile, can_edit: editable}}));
  await signIn(page);
}
async function fill(page: Page) {
  const section = page.getByRole('region', {name: 'Квалификация сотрудника'});
  await section.getByRole('button', {name:'Записать проверку'}).click();
  await section.getByRole('combobox', {name:'Оценка',exact:true}).selectOption('4');
  await section.getByLabel('Дата проверки', {exact:true}).fill('2026-10-20');
  await section.getByLabel('Действует по (необязательно)', {exact:true}).fill('2027-10-20');
  await section.getByRole('textbox', {name:'Основание (документ, проверяющий)',exact:true}).fill('Учебная ведомость 1');
  return section;
}

test('legacy score is explicitly unverified and read-only viewers cannot record an assessment', async ({page, businessWrites}) => {
  await setup(page, false);
  await page.route(url => url.pathname === path, route => route.fulfill({json: {...empty(), can_edit:false}}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/security-ops/profile/61/?directory=1');
  const section = page.getByRole('region', {name:'Квалификация сотрудника'});
  await expect(section.getByText('5 / 5 · без записи о проверке', {exact:true})).toBeVisible();
  await expect(section.getByRole('button', {name:'Записать проверку'})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('saving unrelated profile fields refreshes the shared revision before recording a check', async ({page, businessWrites}) => {
  await setup(page);
  let revision = 0;
  let profileValue = profile.profile;
  let qualificationReads = 0;
  const requests: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === '/api/core/service-employees/61/service-profile/', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(0);
      profileValue = body.profile; revision = 1;
    }
    return route.fulfill({json:{profile:profileValue,revision,can_edit:true,verified_skills:[]}});
  });
  await page.route(url => url.pathname === path, route => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      return route.fulfill({status:201,json:{...empty(),revision:2}});
    }
    qualificationReads++;
    return route.fulfill({json:{...empty(),revision}});
  });
  await page.goto('/security-ops/profile/61/?directory=1');
  const section = page.getByRole('region', {name:'Квалификация сотрудника'});
  await expect(section.getByRole('button', {name:'Записать проверку'})).toBeVisible();
  await page.getByRole('button', {name:'Редактировать личный профиль',exact:true}).click();
  await page.getByLabel('Рост, см', {exact:true}).fill('181');
  await expect(section.getByRole('button', {name:'Записать проверку'})).toBeDisabled();
  await page.getByRole('button', {name:'Сохранить профиль',exact:true}).click();
  await expect(page.getByText('Профиль сохранён.', {exact:true})).toBeVisible();
  await expect.poll(() => qualificationReads).toBeGreaterThan(1);
  await fill(page);
  await section.getByRole('button', {name:'Сохранить проверку',exact:true}).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].revision).toBe(1);
  expect(businessWrites).toEqual([]);
});

test('recording assessment preserves exact evidence and retry key; long author fits mobile history', async ({page, businessWrites}) => {
  await setup(page);
  await page.setViewportSize({width:390,height:1000});
  const longAuthor = 'QualificationAssessor_' + 'x'.repeat(128);
  const requests: Record<string, unknown>[] = [];
  let saved = empty() as any;
  await page.route(url => url.pathname === path, route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); requests.push(body);
      const record = {...body, id:'test-assessment', recorded_by:'fixture-author', recorded_by_name:longAuthor, created_at:'2026-10-27T08:00:00Z'};
      saved = {...empty(), revision:1, current:{...empty().current, shooting:{state:'valid', assessment:record}}, history:{results:[record],count:1,page:1,page_size:20}};
      return route.fulfill({status:201,json:saved});
    }
    return route.fulfill({json:saved});
  });
  await page.goto('/security-ops/profile/61/?directory=1');
  const section = await fill(page);
  await section.getByRole('button', {name:'Сохранить проверку',exact:true}).click();
  await expect(section.getByText('4 / 5 · Срок не истёк', {exact:true})).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({revision:0,skill:'shooting',score:4,assessed_on:'2026-10-20',valid_until:'2027-10-20',basis:'Учебная ведомость 1'});
  expect(requests[0].request_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[0]).not.toHaveProperty('recorded_by');
  await expect(section.getByText('Учебная ведомость 1', {exact:true})).not.toBeVisible();
  await section.locator('summary').filter({hasText:'История проверок'}).click();
  await expect(section.getByText('Учебная ведомость 1', {exact:true})).toBeVisible();
  await expect(section.getByText(longAuthor, {exact:false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(businessWrites).toEqual([]);
});

test('uncertain result retries identical submission without allowing a changed payload', async ({page, businessWrites}) => {
  await setup(page);
  const requests: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === path, route => {
    if (route.request().method() === 'POST') { requests.push(route.request().postDataJSON()); return route.abort('failed'); }
    return route.fulfill({json:empty()});
  });
  await page.goto('/security-ops/profile/61/?directory=1');
  const section = await fill(page);
  await section.getByRole('button', {name:'Сохранить проверку',exact:true}).click();
  await expect(section.getByRole('button', {name:'Повторить сохранение',exact:true})).toBeVisible();
  await expect(section.getByRole('textbox', {name:'Основание (документ, проверяющий)',exact:true})).toBeDisabled();
  await section.getByRole('button', {name:'Повторить сохранение',exact:true}).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(businessWrites).toEqual([]);
});

test('revision conflict retains draft and requires a fresh version; permission denial hides the editor', async ({page, businessWrites}) => {
  await setup(page);
  const requests: Record<string, unknown>[] = [];
  let revision = 0;
  await page.route(url => url.pathname === path, route => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) { revision = 3; return route.fulfill({status:409,json:{detail:'changed'}}); }
      return route.fulfill({status:403,json:{detail:'denied'}});
    }
    return route.fulfill({json:{...empty(),revision}});
  });
  await page.goto('/security-ops/profile/61/?directory=1');
  const section = await fill(page);
  await section.getByRole('button', {name:'Сохранить проверку',exact:true}).click();
  await expect(section.getByRole('textbox', {name:'Основание (документ, проверяющий)',exact:true})).toHaveValue('Учебная ведомость 1');
  await expect(section.getByRole('button', {name:'Сохранить проверку',exact:true})).toBeDisabled();
  await section.getByRole('button', {name:'Обновить версию',exact:true}).click();
  await expect(section.getByRole('button', {name:'Сохранить проверку',exact:true})).toBeEnabled();
  await section.getByRole('button', {name:'Сохранить проверку',exact:true}).click();
  await expect(section.getByRole('button', {name:'Сохранить проверку',exact:true})).toHaveCount(0);
  expect(requests[1].revision).toBe(3);
  expect(businessWrites).toEqual([]);
});

