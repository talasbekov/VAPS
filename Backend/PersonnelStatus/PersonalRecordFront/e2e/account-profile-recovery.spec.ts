import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
async function setup(page: Page, permissions = ['*']) {
  const state = { failed: false, holdRead: false, holdWrite: false, rejectWrite: false, reads: 0,
    writes: [] as { method: string; body: any }[],
    profile: { id: 1, first_name: 'Настоящее', last_name: 'Имя', email: 'saved@example.test', name: 'Настоящее Имя' },
    releaseRead: () => {}, releaseWrite: () => {} };
  const read = new Promise<void>(resolve => { state.releaseRead = resolve; });
  const write = new Promise<void>(resolve => { state.releaseWrite = resolve; });
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions, roles: [] } }));
  await page.route('**/api/user/profile/**', async route => {
    if (route.request().method() === 'GET') {
      state.reads++;
      const snapshot = { ...state.profile };
      if (state.holdRead) await read;
      return route.fulfill(state.failed ? { status: 503, json: { detail: 'Fixture unavailable' } } : { json: snapshot });
    }
    const body = route.request().postDataJSON();
    state.writes.push({ method: route.request().method(), body });
    if (state.holdWrite) await write;
    if (state.rejectWrite) return route.fulfill({ status: 400, json: { first_name: ['Проверьте имя.'] } });
    state.profile = { ...state.profile, ...body };
    return route.fulfill({ json: state.profile });
  });
  await page.route('**/api/user/change-password/**', async route => {
    state.writes.push({ method: 'PASSWORD', body: route.request().postDataJSON() });
    if (state.holdWrite) await write;
    return route.fulfill({ json: { message: 'Пароль изменён.' } });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/security-ops/profile/`);
  return state;
}
async function open(page: Page) {
  await page.getByRole('button', { name: /меню пользователя|user menu/i }).click();
  await page.getByRole('menuitem', { name: 'Редактировать профиль' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('authoritative account profile', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated browser; all account writes intercepted');
  test('waits for server names, keeps draft on reconnect, and refreshes on reopening', async ({ page }) => {
    const state = await setup(page); state.holdRead = true;
    await open(page);
    await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled();
    state.releaseRead();
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Настоящее');
    await page.getByLabel('Имя', { exact: true }).fill('Черновик');
    state.profile.first_name = 'Обновлено';
    await page.context().setOffline(true); await page.context().setOffline(false);
    await expect.poll(() => state.reads).toBeGreaterThan(1);
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Черновик');
    await page.locator('[data-slot=dialog-footer]').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await open(page);
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Обновлено');
    expect(state.writes).toHaveLength(0);
  });
  test('failed profile read blocks save and offers retry', async ({ page }) => {
    const state = await setup(page); state.failed = true;
    await open(page);
    await expect(page.getByText('Не удалось загрузить данные профиля.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled();
    state.failed = false;
    await page.getByRole('button', { name: 'Повторить загрузку профиля', exact: true }).click();
    await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Имя');
    await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled();
    expect(state.writes).toHaveLength(0);
  });
  test('pending save locks draft and dismissal; rejected save retains draft; success stays visible', async ({ page }) => {
    const state = await setup(page); await open(page);
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Настоящее');
    await page.getByLabel('Имя', { exact: true }).fill('Черновик');
    state.holdWrite = true; state.rejectWrite = true;
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.getByLabel('Имя', { exact: true })).toBeDisabled();
    await expect(page.locator('[data-slot=dialog-footer]').getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    state.releaseWrite();
    await expect(page.getByText('Проверьте имя.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Черновик');
    state.rejectWrite = false;
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Профиль успешно обновлен' })).toBeVisible();
    await page.waitForTimeout(2300); // Regression: the previous delayed reload discarded this confirmation.
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(state.writes).toHaveLength(2);
    await page.locator('[data-slot=dialog-footer]').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: /меню пользователя|user menu/i }).click();
    await expect(page.getByRole('menu').getByText('saved@example.test', { exact: true })).toBeVisible();
  });
  test('password mutation locks dialog and clears password fields after success and close', async ({ page }) => {
    const state = await setup(page); await open(page);
    await page.getByLabel('Текущий пароль').fill('fixture-current');
    await page.getByLabel('Новый пароль', { exact: true }).fill('fixture-next-long');
    await page.getByLabel('Подтвердите новый пароль').fill('fixture-next-long');
    state.holdWrite = true;
    await page.getByRole('button', { name: 'Изменить пароль', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.getByLabel('Текущий пароль')).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible();
    state.releaseWrite();
    await expect(page.getByLabel('Текущий пароль')).toHaveValue('');
    await page.getByLabel('Текущий пароль').fill('discard-this-draft');
    await page.locator('[data-slot=dialog-footer]').getByRole('button', { name: 'Закрыть', exact: true }).click(); await open(page);
    await expect(page.getByLabel('Текущий пароль')).toHaveValue('');
  });
  test('a stale reconnect read cannot overwrite the acknowledged profile save', async ({ page }) => {
    const state = await setup(page); await open(page);
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('saved@example.test');
    await page.getByLabel('Email', { exact: true }).fill('new@example.test');
    state.holdWrite = true;
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    state.holdRead = true;
    await page.context().setOffline(true); await page.context().setOffline(false);
    await expect.poll(() => state.reads).toBe(2);
    state.releaseWrite();
    await expect(page.getByRole('status').filter({ hasText: 'Профиль успешно обновлен' })).toBeVisible();
    state.releaseRead();
    await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled();
    await page.locator('[data-slot=dialog-footer]').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: /меню пользователя|user menu/i }).click();
    await expect(page.getByRole('menu').getByText('new@example.test', { exact: true })).toBeVisible();
    await expect(page.getByRole('menu').getByText('saved@example.test', { exact: true })).toHaveCount(0);
  });
  for (const allowed of [true, false]) test(`Settings menu follows settings.view=${allowed}`, async ({ page }) => {
    await setup(page, allowed ? ['settings.view'] : ['admin.roles']);
    await page.getByRole('button', { name: /меню пользователя|user menu/i }).click();
    const item = page.getByRole('menuitem', { name: 'Настройки', exact: true });
    if (!allowed) return expect(item).toHaveCount(0);
    await expect(item).toBeVisible(); await item.click();
    await expect(page).toHaveURL(/\/settings\/?$/);
  });
});
