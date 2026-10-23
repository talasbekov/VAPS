import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
const object = {
  id: 'duty-fixture', name: 'Объект проверки наряда', code: 'DUTY', type: 'BUILDING', region: '', address: '',
  objectState: 'ACTIVE', passportState: 'RED', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
  sectors: [{ id: 'sector-1', name: 'Сектор проверки', posts: [{ id: 'post-1', name: 'Пост сервера', task: '', requirements: '' }, { id: 'post-2', name: 'Пост черновика', task: '', requirements: '' }] }],
  passportVersions: [], createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
};
const assignment = {
  status_id: 501, employee_id: 1, employee_name: 'Сотрудник сервера', rank_name: 'Капитан', position_name: 'Инспектор', department_name: 'Управление проверки',
  placement: { kind: 'POST', object_id: object.id, object_name: object.name, post_id: 'post-1', post_name: 'Пост сервера', sector_name: 'Сектор проверки', group_id: null, group_name: null },
  start_date: '2020-01-01', end_date: '2099-12-31', assigned_at: '2026-10-09T00:00:00Z',
};

async function setup(page: Page, permissions = ['object.view', 'status.view', 'status.workspace', 'status.manage']) {
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions, roles: [], status_manage_division_ids: null } }));
  await page.route('**/api/ops/objects/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/ops/objects/' ? {
    results: [object], freshness: [], unavailableKpi: [], kpi: { total: 1, passportGreen: 0, passportYellow: 0, passportRed: 1, verificationOverdue: 0, neverPublished: 1 }, freshnessPolicy: { version: '1', verificationIntervalDays: 90, dueSoonPercent: 80 },
  } : object }));
  await page.addInitScript(({ objectId }) => localStorage.setItem('vaps.duty-assignments.v1', JSON.stringify([{
    employeeKey: 'old-account-99', employeeName: 'Чужой сотрудник из старого браузера', rankName: '', positionName: '', departmentName: 'Чужое управление',
    dutyKind: 'POST', objectId, objectName: 'Старый объект', postId: 'old-post', postName: 'Старый пост', groupId: null, groupName: null,
    startDate: '2020-01-01', endDate: '2099-12-31', assignedAt: '2020-01-01T00:00:00Z',
  }])), { objectId: object.id });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
}

async function openStatus(page: Page) {
  const current = { id: 501, status_type: 'on_duty', status_type_label: 'На дежурстве', state: 'active', start_date: '2026-10-09', end_date: '2026-10-10', comment: '' };
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-10', blocked: false, laggards: [] } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'on_duty', label: 'На дежурстве', color: '', report_column_code: 'ON_DUTY' }] }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, staff_units: [{ id: 10, index: 1, parent_id: null, vacancy: null, division: { id: 3, name: 'Отдел' }, directorate_id: 3, directorate_name: 'Управление', employee: { id: 1, last_name: 'Тестовый', first_name: 'Сотрудник', current_status: current }, position: { id: 1, name: 'Инспектор', level: 1 } }], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false,
  } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
  await page.goto(`${APP}/statuses/`);
  await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog.getByRole('combobox', { name: /Новый статус/ })).toContainText('На дежурстве');
  return dialog;
}

test.describe('server duty placement', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend with fixture-only writes');

  test('legacy placement editor still requires object access', async ({ page }) => {
    await setup(page, ['status.view', 'status.workspace', 'status.manage']);
    let reads = 0;
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => {
      reads++;
      return route.fulfill({ json: { results: [assignment] } });
    });
    const dialog = await openStatus(page);
    await expect(dialog.getByText('Для назначения на объект нужен доступ к объектам.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: /^Объект/ })).toHaveCount(0);
    expect(reads).toBe(0);
  });

  for (const includeLegacy of [true, false]) {
    test(`legacy editor excludes dispatcher placement: ${includeLegacy ? 'mixed response' : 'dispatch only'}`, async ({ page }) => {
      await setup(page);
      const dispatch = { ...assignment, status_id: null, dispatch_assignment_id: 902,
        placement: { ...assignment.placement, post_id: 'post-2', post_name: 'Пост черновика' } };
      await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({
        json: { results: includeLegacy ? [dispatch, assignment] : [dispatch] },
      }));
      const received = page.waitForResponse(response => response.url().includes('/api/statuses/statuses/duty-assignments/'));
      const dialog = await openStatus(page);
      await (await received).finished();
      await dialog.getByLabel('Комментарий', { exact: true }).fill('Проверка отдельного кадрового назначения');
      if (includeLegacy) {
        await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост сервера');
      } else {
        await expect(dialog.getByRole('combobox', { name: /Тип дежурства/ })).toContainText('Выберите тип дежурства');
        await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toHaveCount(0);
      }
    });
  }

  test('object roster ignores prior-account browser storage and recovers a failed server read', async ({ page }) => {
    await setup(page);
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reads: URL[] = [];
    await page.route('**/api/statuses/statuses/duty-assignments/**', async route => {
      reads.push(new URL(route.request().url()));
      await gate;
      await route.fulfill(fail ? { status: 500, json: { detail: 'Fixture read failed' } } : { json: { results: [assignment] } });
    });
    try {
      await page.goto(`${APP}/security-ops/objects/${object.id}/?dutyDate=2026-10-11`);
      await expect(page.getByRole('heading', { name: 'Дежурные силы', exact: true })).toBeVisible();
      await expect(page.getByText('Чужой сотрудник из старого браузера', { exact: true })).toHaveCount(0);
      await expect.poll(() => reads.length).toBeGreaterThan(0);
      expect(reads[0].searchParams.get('object_id')).toBe(object.id);
      expect(reads[0].searchParams.get('date')).toBe('2026-10-11');
      await expect(page.getByText('На объекте нет заступивших сотрудников', { exact: true })).toHaveCount(0);
      release();
      const retry = page.getByRole('button', { name: /Повторить/ }).last();
      await expect(retry).toBeVisible({ timeout: 30000 });
      fail = false;
      await retry.click();
      await expect(page.getByText('Сотрудник сервера', { exact: true })).toBeVisible();
      await expect(page.getByText('Пост сервера', { exact: true })).toBeVisible();
    } finally { release(); }
  });

  test('object reader without status permission neither requests nor reveals assignments', async ({ page }) => {
    await setup(page, ['object.view']);
    let reads = 0;
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => { reads++; return route.fulfill({ json: { results: [assignment] } }); });
    await page.goto(`${APP}/security-ops/objects/${object.id}/`);
    await expect(page.getByRole('heading', { name: 'Дежурные силы', exact: true })).toBeVisible();
    await expect(page.getByText('Чужой сотрудник из старого браузера', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Сотрудник сервера', { exact: true })).toHaveCount(0);
    expect(reads).toBe(0);
  });

  test('delayed employee placement seeds once and background refresh preserves the draft', async ({ page }) => {
    await setup(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reads: URL[] = [];
    await page.route('**/api/statuses/statuses/duty-assignments/**', async route => {
      reads.push(new URL(route.request().url()));
      await gate;
      await route.fulfill({ json: { results: [assignment] } });
    });
    try {
      const dialog = await openStatus(page);
      await expect.poll(() => reads.length).toBeGreaterThan(0);
      expect(reads[0].searchParams.get('employee_id')).toBe('1');
      expect(reads[0].searchParams.get('date')).toBe('2026-10-09');
      release();
      await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост сервера');
      await dialog.getByRole('combobox', { name: /^Пост/ }).click();
      await page.getByRole('option', { name: 'Пост черновика (Сектор проверки)', exact: true }).click();
      await dialog.getByLabel('Комментарий', { exact: true }).fill('Не терять черновик');
      const count = reads.length;
      const refreshed = page.waitForResponse(response => response.url().includes('/api/statuses/statuses/duty-assignments/'));
      // Window-focus refresh is disabled globally; reconnect is the supported
      // background refresh path and does not remount the open editor.
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => reads.length).toBeGreaterThan(count);
      await (await refreshed).finished();
      await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост черновика');
      await expect(dialog.getByLabel('Комментарий', { exact: true })).toHaveValue('Не терять черновик');
    } finally { release(); }
  });

  test('a current replacement copies remaining exits and clips an overnight exit with an explicit history notice', async ({ page }) => {
    await setup(page);
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({ json: { results: [{ ...assignment,
      placement: { ...assignment.placement, time_zone: 'Asia/Almaty', intervals: [
        { start_at: '2026-10-08T08:00:00+05:00', end_at: '2026-10-08T12:00:00+05:00' },
        { start_at: '2026-10-08T22:00:00+05:00', end_at: '2026-10-09T04:00:00+05:00' },
        { start_at: '2026-10-09T08:00:00+05:00', end_at: '2026-10-09T12:00:00+05:00' },
      ] },
    }] } }));
    const writes: Record<string, unknown>[] = [];
    await page.route(url => url.pathname === '/api/statuses/statuses/', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id: 502 } });
    });
    const dialog = await openStatus(page);
    await expect(dialog.getByLabel(/^Начало выхода/)).toHaveCount(2);
    await expect(dialog.getByLabel(/^Начало выхода/).nth(0)).toHaveValue(/^2026-10-09T00:00(?::00)?$/);
    await expect(dialog).toContainText('Для нового назначения оставлены выходы с 2026-10-09; прежний график сохранён в истории.');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ start_date: '2026-10-09', duty_assignment: { intervals: [
      { start_at: '2026-10-09T00:00:00+05:00', end_at: '2026-10-09T04:00:00+05:00' },
      { start_at: '2026-10-09T08:00:00+05:00', end_at: '2026-10-09T12:00:00+05:00' },
    ] } });
  });

  test('a delayed old placement never supplies hours for a newly selected post', async ({ page }) => {
    await setup(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/statuses/statuses/duty-assignments/**', async route => {
      await gate;
      await route.fulfill({ json: { results: [{ ...assignment, placement: { ...assignment.placement,
        time_zone: 'Asia/Almaty', intervals: [{ start_at: '2026-10-09T08:00:00+05:00', end_at: '2026-10-09T12:00:00+05:00' }],
      } }] } });
    });
    const writes: Record<string, unknown>[] = [];
    await page.route(url => url.pathname === '/api/statuses/statuses/', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id: 502 } });
    });
    try {
      const dialog = await openStatus(page);
      await dialog.getByRole('combobox', { name: /Тип дежурства/ }).click();
      await page.getByRole('option', { name: 'Постовое', exact: true }).click();
      await dialog.getByRole('combobox', { name: /^Объект/ }).click();
      await page.getByRole('option', { name: `${object.name} (${object.code})`, exact: true }).click();
      await dialog.getByRole('combobox', { name: /^Пост/ }).click();
      await page.getByRole('option', { name: 'Пост черновика (Сектор проверки)', exact: true }).click();
      release();
      await expect(dialog.getByText('Загружаем текущее назначение и выходы…', { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel(/^Начало выхода/)).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0].duty_assignment).toEqual({ kind: 'POST', object_id: object.id, post_id: 'post-2' });
    } finally { release(); }
  });

  test('placement and status are one atomic request and pending save cannot be edited or dismissed', async ({ page }) => {
    await setup(page);
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({ json: { results: [] } }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writes: Record<string, unknown>[] = [];
    await page.route(url => url.pathname === '/api/statuses/statuses/', async route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { results: [] } });
      writes.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({ status: 400, json: { detail: 'Fixture rejected save' } });
    });
    try {
      const dialog = await openStatus(page);
      await dialog.getByRole('combobox', { name: /Тип дежурства/ }).click();
      await page.getByRole('option', { name: 'Постовое', exact: true }).click();
      await dialog.getByRole('combobox', { name: /^Объект/ }).click();
      await page.getByRole('option', { name: `${object.name} (${object.code})`, exact: true }).click();
      await dialog.getByRole('combobox', { name: /^Пост/ }).click();
      await page.getByRole('option', { name: 'Пост сервера (Сектор проверки)', exact: true }).click();
      await dialog.getByLabel('Комментарий', { exact: true }).fill('Черновик наряда');
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ employee: 1, status_type: 'on_duty', duty_assignment: { kind: 'POST', object_id: object.id, post_id: 'post-1' } });
      await expect(dialog.getByLabel('Комментарий', { exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      release();
      await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
      await expect(dialog.getByLabel('Комментарий', { exact: true })).toHaveValue('Черновик наряда');
      expect(writes).toHaveLength(1);
    } finally { release(); }
  });

  test('reopening waits for refreshed placement rather than seeding the previous cached post', async ({ page }) => {
    await setup(page);
    let refresh = false;
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/statuses/statuses/duty-assignments/**', async route => {
      reads++;
      if (refresh) await gate;
      await route.fulfill({ json: { results: [{ ...assignment, placement: refresh
        ? { ...assignment.placement, post_id: 'post-2', post_name: 'Пост черновика' }
        : assignment.placement }] } });
    });
    try {
      const dialog = await openStatus(page);
      await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост сервера');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      refresh = true;
      const previousReads = reads;
      await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
      await expect.poll(() => reads).toBeGreaterThan(previousReads);
      const response = page.waitForResponse(value => value.url().includes('/api/statuses/statuses/duty-assignments/'));
      release();
      await (await response).finished();
      await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост черновика');
    } finally { release(); }
  });

  test('object picker retries a failed catalog without losing the status draft', async ({ page }) => {
    await setup(page);
    let fail = true;
    await page.route('**/api/ops/objects/**', route => route.fulfill(fail
      ? { status: 500, json: { detail: 'Fixture object catalog unavailable' } }
      : { json: { results: [object], freshness: [], unavailableKpi: [] } }));
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({ json: { results: [] } }));
    const dialog = await openStatus(page);
    await dialog.getByLabel('Комментарий', { exact: true }).fill('Черновик при отказе справочника');
    const objectPicker = dialog.getByRole('combobox', { name: /^Объект/ });
    await expect(objectPicker).toContainText('Объекты недоступны', { timeout: 30000 });
    await expect(objectPicker).toBeDisabled();
    const retry = dialog.getByRole('button', { name: /Повторить.*объект/ });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(objectPicker).toBeEnabled();
    await objectPicker.click();
    await page.getByRole('option', { name: `${object.name} (${object.code})`, exact: true }).click();
    await expect(objectPicker).toContainText(object.name);
    await expect(dialog.getByLabel('Комментарий', { exact: true })).toHaveValue('Черновик при отказе справочника');
  });

  test('retired post requires an explicit current replacement before saving', async ({ page }) => {
    await setup(page);
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({ json: { results: [{ ...assignment,
      placement: { ...assignment.placement, post_id: 'retired-post', post_name: 'Прежний пост паспорта' },
    }] } }));
    const writes: Record<string, unknown>[] = [];
    await page.route(url => url.pathname === '/api/statuses/statuses/', route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { results: [] } });
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { detail: 'Fixture rejected save' } });
    });
    const dialog = await openStatus(page);
    await expect(dialog.getByText('Пост изменён в паспорте. Выберите актуальный пост.', { exact: true })).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(save).toBeDisabled();
    await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(writes).toHaveLength(0);
    await dialog.getByRole('combobox', { name: /^Пост/ }).click();
    await page.getByRole('option', { name: 'Пост черновика (Сектор проверки)', exact: true }).click();
    await expect(save).toBeEnabled();
    await expect(dialog.getByText('Пост изменён в паспорте. Выберите актуальный пост.', { exact: true })).toHaveCount(0);
    await save.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ duty_assignment: { kind: 'POST', object_id: object.id, post_id: 'post-2' } });
    await expect(save).toBeEnabled();
    await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост черновика');
  });

  test('reopening refreshes the cached object catalog before accepting an assigned post', async ({ page }) => {
    await setup(page);
    let changed = false;
    let catalogReads = 0;
    await page.route('**/api/ops/objects/**', route => {
      catalogReads++;
      const currentObject = changed ? { ...object, sectors: [{ ...object.sectors[0], posts: [object.sectors[0].posts[1]] }] } : object;
      return route.fulfill({ json: { results: [currentObject], freshness: [], unavailableKpi: [] } });
    });
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => route.fulfill({ json: { results: [assignment] } }));
    const dialog = await openStatus(page);
    await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост сервера');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const previousReads = catalogReads;
    changed = true;
    await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
    await expect.poll(() => catalogReads).toBeGreaterThan(previousReads);
    await expect(dialog.getByText('Пост изменён в паспорте. Выберите актуальный пост.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: /^Пост/ }).click();
    await expect(page.getByRole('option', { name: 'Пост сервера (Сектор проверки)', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Пост черновика (Сектор проверки)', exact: true })).toBeVisible();
  });
});
