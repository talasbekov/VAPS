import type { Page } from '@playwright/test';
import type { DepartmentRequestDetail, ForceAllocationRow } from '@/entities/security-event';
import { test, expect, signIn } from './ux-fixture';

// HTTP responses are controlled at the browser boundary. Mutations in the
// preservation scenarios are fulfilled here and never reach the local API.
function requestDetail(allocation: Partial<ForceAllocationRow> = {}, detail: Partial<DepartmentRequestDetail> = {}): DepartmentRequestDetail {
  return {
    eventId: '901', code: 'ОМ-901', title: 'Подготовка наряда на встречу делегации',
    businessDate: '2026-10-23', eventTime: '10:00', location: 'Учебный объект', stage: 'FORCES',
    inServiceByDirectorate: { '3': 8 }, memberDirectorateById: { '71': '3', '72': '3' },
    ...detail,
    allocation: {
      id: '31', departmentId: '2', departmentName: 'Первый департамент', need: 7,
      allocating: null, answerComment: '', comment: '', status: 'DRAFT',
      notifiedAt: null, submittedAt: null, decidedAt: null, decisionComment: '',
      dueAt: '2026-10-22T10:00:00+05:00', overdue: true, submittedLate: false,
      directorates: [{ id: '301', divisionId: '3', name: 'Первое управление', need: 0, assigned: 0, notifiedAt: null, groupDemandIds: [] }],
      members: [], groupDemands: [], groupOffers: [], ...allocation,
    },
  };
}

const members = [71, 72].map(id => ({
  employeeId: String(id), name: `Сотрудник ${id}`, divisionId: '4',
  divisionName: 'Первый отдел', addedAt: '2026-10-22T05:00:00Z', source: 'STATUS' as const,
}));
const notified = {
  status: 'NOTIFIED' as const, allocating: 7, notifiedAt: '2026-10-22T05:00:00Z',
  directorates: [{ id: '301', divisionId: '3', name: 'Первое управление', need: 7, assigned: 0, notifiedAt: '2026-10-22T05:00:00Z', groupDemandIds: [] }],
};
const groupDemand = {
  id: 'group-1', sector: 'Вход', task: 'Досмотр', place: 'Вход', shift: 'Первая смена', need: 1,
  kindCode: 'SCREENING_GROUP', specification: 'Группа досмотра', requirements: '', comment: '',
};
const savedGroupOffer = {
  demandRowId: 'group-1', kindCode: 'SCREENING_GROUP', count: 2,
  place: 'Вход', specification: 'Группа досмотра', comment: 'Два состава',
};

async function openRequest(page: Page, detail: DepartmentRequestDetail, options: { missing?: boolean; divisions?: boolean } = {}) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['forces.allocate', 'status.view'], global_permissions: ['forces.allocate', 'status.view'], roles: [],
  } }));
  await page.route('**/api/ops/security-events/forces/requests/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (new URL(route.request().url()).pathname.endsWith('/31/')) {
      return route.fulfill(options.missing
        ? { status: 404, json: { detail: 'Заявка недоступна' } }
        : { json: detail });
    }
    return route.fulfill({ json: { results: [] } });
  });
  await page.route('**/api/core/divisions/**', route => route.fulfill({ json: { count: options.divisions === false ? 0 : 1, next: null, previous: null, results: options.divisions === false ? [] : [
    { id: 3, name: 'Первое управление', code: null, parent: 2, type_code: 'directorate', is_active: true },
  ] } }));
  await page.route('**/api/ops/dictionaries/EVENT_PARTICIPATION_KINDS/entries/**', route => route.fulfill({ json: { results: [{
    id: 'kind-1', dictionaryCode: 'EVENT_PARTICIPATION_KINDS', code: 'SCREENING_GROUP', label: 'Группа досмотра',
    labelKk: '', description: '', isActive: true, groupCode: null, updatedAt: '2026-10-22T00:00:00Z',
    inactiveSince: null, supersedes: null, supersededBy: null,
  }] } }));
  await page.route('**/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/**', route => route.fulfill({ json: { results: [] } }));
  await signIn(page);
  await page.goto('/employees/?view=forces&tab=requests&businessDate=2026-10-23&request=31');
  if (!options.missing) await expect(page.getByRole('heading', { name: detail.title, exact: true })).toBeVisible();
}

const section = (page: Page, name: 'answer' | 'split' | 'members' | 'send' | 'totals') => page.locator(`details[data-slot="department-${name}-section"]`);
async function expand(page: Page, name: 'answer' | 'split' | 'members' | 'send' | 'totals') {
  const details = section(page, name);
  if (!(await details.evaluate(node => (node as HTMLDetailsElement).open))) await details.locator(':scope > summary').click();
  return details;
}

for (const width of [390, 1440]) test(`department draft presents one task and keeps future sections collapsed at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openRequest(page, requestDetail());
  const next = page.locator('[data-slot="department-next-action"]');
  await expect(next).toContainText('Ответственный департамента');
  await expect(next).toContainText('Подготовьте ответ');
  await expect(section(page, 'answer')).toHaveAttribute('open', '');
  for (const name of ['split', 'members', 'send', 'totals'] as const) await expect(section(page, name)).not.toHaveAttribute('open');
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Сохранить ответ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить в управления', exact: true })).toBeHidden();
  await expect(page.getByRole('list', { name: 'Этапы запроса сил' })).toHaveCount(0);
  const empty = await expand(page, 'members');
  await expect(empty.getByRole('table')).toHaveCount(0);
  await expect(empty).toContainText('Список пока пуст');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  expect(businessWrites).toEqual([]);
});

test('department waits for directorates without presenting an empty member table or an empty send action', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail(notified));
  await expect(page.locator('[data-slot="department-next-action"]')).toContainText('Начальники управлений');
  await expect(section(page, 'members')).toHaveAttribute('open', '');
  await expect(section(page, 'members').getByRole('table')).toHaveCount(0);
  await expand(page, 'send');
  await expect(page.getByRole('button', { name: 'Отправить список в штаб', exact: true })).toHaveCount(0);
  await expect(section(page, 'send')).toContainText('Пустой список отправить нельзя');
  expect(businessWrites).toEqual([]);
});

test('a partial department list remains submittable and keeps its business date on return', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({ ...notified, members }));
  await expect(page.locator('[data-slot="department-next-action"]')).toContainText('Проверьте и отправьте список');
  const send = page.getByRole('button', { name: 'Отправить список в штаб', exact: true });
  await expect(send).toBeVisible(); await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('dialog')).toContainText('Отправить 2 из 7?');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Назад к заявкам', exact: true }).click();
  await expect(page).toHaveURL(/businessDate=2026-10-23/);
  await expect.poll(() => new URL(page.url()).searchParams.get('request')).toBeNull();
  expect(businessWrites).toEqual([]);
});

for (const status of ['SUBMITTED', 'ACCEPTED', 'RETURNED', 'DECLINED'] as const) test(`department ${status.toLowerCase()} identifies the next actor and retains allowed controls`, async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({ ...notified, status, members,
    allocating: status === 'DECLINED' ? 0 : 7,
    decisionComment: status === 'RETURNED' ? 'Уточните состав первой смены' : '',
  }));
  const next = page.locator('[data-slot="department-next-action"]');
  await expect(next).toContainText(status === 'SUBMITTED' || status === 'ACCEPTED' ? 'Штаб' : 'Ответственный департамента');
  if (status === 'RETURNED') await expect(next).toContainText('Уточните состав первой смены');
  await expand(page, 'answer');
  const answer = page.getByLabel('Выделяем', { exact: true });
  await expect(answer).toHaveValue(status === 'DECLINED' ? '0' : '7');
  if (status === 'SUBMITTED' || status === 'ACCEPTED') await expect(answer).toBeDisabled();
  else await expect(answer).toBeEnabled();
  await expand(page, 'send');
  await expect(page.getByRole('button', { name: 'Отозвать список', exact: true })).toHaveCount(status === 'SUBMITTED' ? 1 : 0);
  await expect(page.getByRole('button', { name: 'Отправить список в штаб', exact: true })).toHaveCount(status === 'RETURNED' ? 1 : 0);
  expect(businessWrites).toEqual([]);
});

test('a closed collection keeps saved data available without presenting editable future tasks', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({ ...notified, members }, { stage: 'CLOSED' }));
  await expect(page.locator('[data-slot="department-next-action"]')).toContainText('Сбор сил на этом этапе завершён');
  for (const name of ['answer', 'split', 'members', 'send', 'totals'] as const) await expect(section(page, name)).not.toHaveAttribute('open');
  await expand(page, 'answer'); await expect(page.getByLabel('Выделяем', { exact: true })).toBeDisabled();
  await expand(page, 'split'); await expect(page.getByLabel('Квота управления «Первое управление»')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отправить в управления', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('special-only demand does not turn zero physical demand into a completed list', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({ ...notified, need: 0, allocating: null, groupDemands: [groupDemand],
    directorates: [{ ...notified.directorates[0], need: 0, groupDemandIds: ['group-1'] }],
  }));
  await expect(page.locator('[data-slot="department-next-action"]')).toContainText('Начальники управлений');
  await expect(page.getByRole('button', { name: 'Отправить список в штаб', exact: true })).toHaveCount(0);
  await expand(page, 'answer');
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Специальные группы', exact: true })).toContainText('Группа досмотра');
  await expect(page.getByLabel('Количество групп, строка 1')).toHaveValue('0');
  expect(businessWrites).toEqual([]);
});

test('declined physical count with saved groups continues to group distribution and notification', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({
    need: 0, allocating: 0, status: 'DECLINED', groupDemands: [groupDemand], groupOffers: [savedGroupOffer],
  }));
  const next = page.locator('[data-slot="department-next-action"]');
  await expect(next).toContainText('Специальные группы сохранены');
  await expect(next).toContainText('Ответственный департамента');
  await expect(page.getByText('Отказ по физическому наряду', { exact: true })).toBeVisible();
  await expect(next).not.toContainText('исправьте количество');
  await expect(section(page, 'split')).toHaveAttribute('open', '');
  await section(page, 'split').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Отправить в управления', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Сохранить и отправить', exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText('Сначала разложите запрос');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expand(page, 'answer');
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Количество групп, строка 1')).toHaveValue('2');
  expect(businessWrites).toEqual([]);
});

for (const hasMembers of [false, true]) test(`declined physical count with saved groups retains the notified group workflow ${hasMembers ? 'with members' : 'while waiting'}`, async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({
    ...notified, need: 0, allocating: 0, status: 'DECLINED',
    groupDemands: [groupDemand], groupOffers: [savedGroupOffer],
    directorates: [{ ...notified.directorates[0], need: 0, groupDemandIds: ['group-1'] }],
    members: hasMembers ? members.map(member => ({ ...member, kindCode: 'SCREENING_GROUP' })) : [],
  }));
  const next = page.locator('[data-slot="department-next-action"]');
  await expect(next).toContainText(hasMembers ? 'Ответственный департамента' : 'Начальники управлений');
  await expect(next).toContainText('специальных групп');
  await expect(next).not.toContainText('исправьте количество');
  await expect(section(page, 'members')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Отправить список в штаб', exact: true })).toHaveCount(0);
  await expand(page, 'split');
  await expect(page.getByRole('button', { name: 'Отправить в управления', exact: true })).toHaveCount(0);
  await expect(section(page, 'split').getByRole('checkbox')).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('declined physical-only response does not describe an unsaved group draft as saved', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail({
    allocating: 0, status: 'DECLINED', groupDemands: [groupDemand],
    groupOffers: [{ ...savedGroupOffer, count: 0 }],
  }));
  const next = page.locator('[data-slot="department-next-action"]');
  await expect(next).toContainText('Сохранён отказ департамента');
  await expect(section(page, 'answer')).toHaveAttribute('open', '');
  await page.getByLabel('Количество групп, строка 1').fill('2');
  await expect(next).toContainText('Сохранён отказ департамента');
  await expect(next).not.toContainText('Специальные группы сохранены');
  await expect(section(page, 'split')).not.toHaveAttribute('open');
  expect(businessWrites).toEqual([]);
});

test('failed answer preserves physical and special-group drafts through collapse and retry', async ({ page, businessWrites }) => {
  const attempts: unknown[] = [];
  await page.route('**/api/ops/security-events/901/forces/allocation/31/respond/**', async route => {
    attempts.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { detail: 'Ответ временно не сохраняется' } });
  });
  await openRequest(page, requestDetail({ groupDemands: [groupDemand] }));
  await page.getByLabel('Выделяем', { exact: true }).fill('3');
  await page.getByLabel('Комментарий', { exact: true }).fill('Подготовлена первая смена');
  await page.getByLabel('Количество групп, строка 1').fill('2');
  await page.getByLabel('Комментарий группы, строка 1').fill('Два состава');
  await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click();
  await expect(section(page, 'answer').getByRole('alert').last()).toBeVisible();
  await section(page, 'answer').locator(':scope > summary').click();
  await expand(page, 'split');
  await expand(page, 'answer');
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Подготовлена первая смена');
  await expect(page.getByLabel('Количество групп, строка 1')).toHaveValue('2');
  await expect(page.getByLabel('Комментарий группы, строка 1')).toHaveValue('Два состава');
  await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  const expected = { allocating: 3, comment: 'Подготовлена первая смена', groupOffers: [{
    demandRowId: 'group-1', kindCode: 'SCREENING_GROUP', count: 2, place: 'Вход', specification: 'Группа досмотра', comment: 'Два состава',
  }] };
  expect(attempts).toEqual([expected, expected]);
  expect(businessWrites).toEqual([]);
});

test('failed quota save retains the quota and group choice when sections are collapsed', async ({ page, businessWrites }) => {
  const attempts: unknown[] = [];
  await page.route('**/api/ops/security-events/901/forces/allocation/31/split/**', async route => {
    attempts.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, json: { detail: 'Раскладка временно не сохраняется' } });
  });
  await openRequest(page, requestDetail({ allocating: 4, groupDemands: [groupDemand] }));
  await page.getByLabel('Квота управления «Первое управление»').fill('3');
  await section(page, 'split').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Сохранить раскладку', exact: true }).click();
  await expect(section(page, 'split').getByRole('alert').last()).toBeVisible();
  await section(page, 'split').locator(':scope > summary').click(); await expand(page, 'split');
  await expect(page.getByLabel('Квота управления «Первое управление»')).toHaveValue('3');
  await expect(section(page, 'split').getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Сохранить раскладку', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts).toEqual([
    { rows: [{ divisionId: '3', need: 3, groupDemandIds: ['group-1'] }] },
    { rows: [{ divisionId: '3', need: 3, groupDemandIds: ['group-1'] }] },
  ]);
  expect(businessWrites).toEqual([]);
});

test('a missing department request offers a read retry and retains navigation context', async ({ page, businessWrites }) => {
  await openRequest(page, requestDetail(), { missing: true });
  await expect(page.getByRole('button', { name: /Повторить/ })).toBeVisible();
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад к заявкам', exact: true }).click();
  await expect(page).toHaveURL(/businessDate=2026-10-23/);
  expect(businessWrites).toEqual([]);
});
