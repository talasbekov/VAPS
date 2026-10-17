import { test, expect } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106';
test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated profile with isolated identity responses');
test.use({ serviceWorkers: 'block' });

for (const initiallyFails of [false, true]) {
  test(`profile identity: ${initiallyFails ? 'initial failure can be retried' : 'failed refresh hides cached profile and can recover'}`, async ({ page }) => {
    await page.clock.install();
    let failure = initiallyFails;
    let reads = 0;
    await page.route('**/api/**', route => {
      const request = route.request();
      return ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || new URL(request.url()).pathname.startsWith('/api/auth/')
        ? route.continue() : route.abort();
    });
    await page.route(url => url.pathname === '/api/operations/my-employee/', route => {
      reads++;
      return route.fulfill(failure ? { status: 503, json: { detail: 'Identity unavailable' } } : {
        json: { employee: { id: 5164, first_name: 'сотрудник', last_name: 'Проверочный', middle_name: 'профиля', full_name: 'Проверочный сотрудник профиля', is_active: true, rank_code: null, position_code: null, division: null, personnel_number: null, hire_date: null }, unlinked_reason: null },
      });
    });
    const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
    await page.request.post(APP + '/api/auth/callback/credentials/', { form: {
      csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
    } });
    await page.goto(APP + '/security-ops/profile/');
    const name = page.getByRole('heading', { name: 'Проверочный сотрудник профиля', exact: true });
    if (!initiallyFails) {
      await expect(name).toBeVisible();
      const before = reads;
      failure = true;
      await page.clock.fastForward(61000);
      await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
      await expect.poll(() => reads).toBeGreaterThan(before);
    }
    await expect(page.getByText(/Не удалось прочитать кадровую запись/)).toBeVisible();
    await expect(name).toBeHidden();
    failure = false;
    await page.getByRole('button', { name: 'Повторить загрузку профиля', exact: true }).click();
    await expect(name).toBeVisible();
    await expect(page.getByText(/Не удалось прочитать кадровую запись/)).toBeHidden();
  });
}
