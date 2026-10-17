import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106';
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100';
test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated profiles with isolated read failures');
test.use({ serviceWorkers: 'block' });

for (const directory of [false, true]) for (const status of [403, 404, 503]) {
  test(`${directory ? 'directory' : 'legacy'} profile hides cached identity after HTTP ${status}`, async ({ page }) => {
    const tokenResponse = await page.request.post(API + '/api/token/', {
      data: { username: STAND_USERNAME, password: STAND_PASSWORD },
    });
    expect(tokenResponse.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await tokenResponse.json()).access}` };
    const collection = `/api/core/${directory ? 'service-employees' : 'employees'}/`;
    const listResponse = await page.request.get(API + collection + '?page_size=1', { headers });
    expect(listResponse.ok()).toBeTruthy();
    const first = (await listResponse.json()).results[0];
    expect(first).toBeDefined();
    const endpoint = `${collection}${first.id}/`;
    const detailResponse = await page.request.get(API + endpoint, { headers });
    expect(detailResponse.ok()).toBeTruthy();
    const employee = await detailResponse.json();
    await page.clock.install();
    const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
    await page.request.post(APP + '/api/auth/callback/credentials/', { form: {
      csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
    } });
    await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      ? route.continue() : route.abort());
    let failure = false;
    let reads = 0;
    await page.route(url => url.pathname === endpoint, route => {
      reads++;
      return route.fulfill(failure ? { status, json: { detail: 'Unavailable' } } : { json: employee });
    });
    await page.goto(`${APP}/security-ops/profile/${employee.id}/${directory ? '?directory=1' : ''}`);
    const name = page.getByRole('heading', { name: employee.full_name, exact: true });
    await expect(name).toBeVisible();
    const previous = reads;
    failure = true;
    await page.clock.fastForward(61000);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => reads).toBeGreaterThan(previous);
    await expect(page.getByText(directory && status !== 503
      ? /Сотрудник не найден в вашей области доступа/
      : directory ? /Не удалось загрузить карточку сотрудника/ : /Не удалось загрузить кадровую запись/)).toBeVisible();
    await expect(name).toBeHidden();
    failure = false;
    if (directory && status !== 503) {
      await page.clock.fastForward(61000);
      await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    } else {
      await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    }
    await expect(name).toBeVisible();
  });
}
