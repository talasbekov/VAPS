import { expect, test, type Page } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';

async function setup(page: Page) {
  const state = { writes: [] as any[], blocked: [] as string[], release: () => {}, reject: false };
  const row = { id: 'draft-1', departmentId: '3', departmentName: 'Департамент проверки', need: 1, comment: '', dueAt: null, sentAt: null, groupDemands: [] };
  const data = { eventId: '95041', code: 'ОМ-ПРОБА', title: 'Проверка черновика', businessDate: '2026-10-09', location: '', eventTime: null,
    stage: 'FORCES', canCollect: true, boardStatus: { label: 'Сбор сил' }, need: 5, allocated: 1, gathered: 0, remaining: 5,
    totals: { allocating: 0 }, needByObject: [], allocations: [row], roster: [], objects: [], handover: {},
    demandRows: [{ id: 'g1', kindCode: 'SCREENING_GROUP', need: 1, place: 'КПП', specification: 'Досмотр' }] };
  await page.route('**/api/**', route => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || new URL(request.url()).pathname.startsWith('/api/auth/')) return route.fallback();
    state.blocked.push(request.url()); return route.fulfill({ status: 403, json: { detail: 'Unmocked write forbidden' } });
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route('**/api/core/divisions/**', route => route.fulfill({ json: { results: [{ id: 3, name: 'Департамент проверки', type_code: 'department', parent: null, is_active: true }] } }));
  await page.route('**/forces/collections/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/95041/force-collection/**', route => route.fulfill({ json: data }));
  await page.route('**/95041/forces/allocation/**', async route => {
    const body = route.request().postDataJSON(); state.writes.push(body);
    await new Promise<void>(resolve => { state.release = resolve; });
    if (state.reject) return route.fulfill({ status: 422, json: { error_code: 'VALIDATION_ERROR', message: 'Проверка отклонила запись', details: {} } });
    Object.assign(row, body.rows[0]); if (!body.draft) Object.assign(row, { sentAt: '2026-10-09T10:00:00Z' });
    return route.fulfill({ json: {} });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(APP + '/employees?view=forces&tab=collections&collection=95041');
  await expect(page.getByLabel('Сколько человек, строка 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  return state;
}

test.describe('force split pending draft', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated UI; all non-auth writes intercepted');
  test.setTimeout(45_000);
  for (const reject of [false, true]) test(`draft controls lock until ${reject ? 'rejection' : 'accepted refresh'}`, async ({ page }) => {
    const state = await setup(page); state.reject = reject;
    const count = page.getByLabel('Сколько человек, строка 1', { exact: true });
    const comment = page.getByLabel('Комментарий Штаба, строка 1', { exact: true });
    await count.fill('2'); await comment.fill('Сохранить этот черновик');
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    try {
      for (const label of ['Департамент, строка 1', 'Срок сдачи списка, строка 1', 'Сколько человек, строка 1', 'Комментарий Штаба, строка 1']) await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
      await expect(page.locator('[data-slot="draft-row"] button[role="checkbox"]')).toBeDisabled();
      for (const name of ['Департамент', 'Убрать департамент, строка 1', 'Сохранить черновик', 'Отправить запросы', 'Назад к списку сборов']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      await count.fill('3', { timeout: 250 }).catch(() => {});
      await page.getByRole('button', { name: 'Департамент', exact: true }).click({ timeout: 250 }).catch(() => {});
      await expect(count).toHaveValue('2');
      expect(state.writes).toHaveLength(1);
    } finally { state.release(); }
    await expect(count).toBeEnabled();
    await expect(count).toHaveValue('2'); await expect(comment).toHaveValue('Сохранить этот черновик');
    if (!reject) await expect(page.getByText('Черновик сохранён', { exact: true })).toBeVisible();
    else {
      await expect(page.getByText('Черновик сохранён', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Проверка отклонила запись', { exact: true })).toBeVisible();
    }
    expect(state.writes[0].rows[0]).toMatchObject({ need: 2, comment: 'Сохранить этот черновик' });
    expect(state.blocked).toEqual([]);
  });
  test('send confirmation cannot close or replay while request is pending', async ({ page }) => {
    const state = await setup(page); state.reject = true;
    await page.getByRole('button', { name: 'Отправить запросы', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    try {
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      await dialog.locator('[data-slot="dialog-close"]').click(); await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Отправляю…', exact: true })).toBeDisabled();
      expect(state.writes).toHaveLength(1);
    } finally { state.release(); }
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Сколько человек, строка 1', { exact: true })).toHaveValue('1');
    expect(state.blocked).toEqual([]);
  });
});
