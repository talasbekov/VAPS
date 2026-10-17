import { test, expect, signIn } from './ux-fixture';

test('dictionary values retain the list and let the user switch without returning to the registry', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.goto('/security-ops/dictionaries/POST_REQUIREMENTS/');
  await expect(page.getByRole('heading', { name: 'Требования к постам', level: 1 })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Выбор справочника', exact: true });
  await expect(navigation.getByRole('link', { name: 'Требования к постам', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('link', { name: 'Причины возврата', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Причины возврата', level: 1 })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Причины возврата', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('link', { name: 'Города', exact: true }).click();
  await expect(page).toHaveURL(/\/dictionaries\/geo\/cities\/$/);
  await expect(page.getByRole('heading', { name: 'Города', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Причины возврата', level: 1 })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('dictionary search has an explicit empty result and a working reset', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.goto('/security-ops/dictionaries/POST_REQUIREMENTS/');
  const navigation = page.getByRole('navigation', { name: 'Выбор справочника', exact: true });
  const search = navigation.getByRole('textbox', { name: 'Поиск справочников', exact: true });
  await search.fill('несуществующий справочник 12345');
  await expect(navigation.getByText('Справочники не найдены.', { exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Сбросить поиск справочников', exact: true }).click();
  await expect(navigation.getByRole('link', { name: 'Города', exact: true })).toBeVisible();
  await search.fill('должности');
  await expect(navigation.getByRole('link', { name: 'Должности', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Города', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('mobile dictionary selection uses the actual specialized route and keeps the page within the viewport', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/security-ops/dictionaries/POST_REQUIREMENTS/');
  const picker = page.getByRole('combobox', { name: 'Выбрать справочник', exact: true });
  await expect(picker).toHaveValue('/security-ops/dictionaries/POST_REQUIREMENTS');
  await picker.selectOption('/security-ops/dictionaries/personnel/positions');
  await expect(page.getByRole('heading', { name: 'Должности', level: 1 })).toBeVisible();
  await expect(picker).toHaveValue('/security-ops/dictionaries/personnel/positions');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('dictionary-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

test('status-only reader does not request the dictionary registry or see cached navigation', async ({ page, businessWrites }) => {
  let registryReads = 0;
  await page.route('**/api/ops/dictionaries/', route => { registryReads++; return route.fulfill({ status: 403, json: { detail: 'Not permitted' } }); });
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['status.view'], global_permissions: [], roles: [] } }));
  await signIn(page);
  await page.goto('/security-ops/dictionaries/status-types/');
  await expect(page.getByRole('heading', { name: 'Типы статусов сотрудников', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Выбрать справочник', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Выбор справочника', exact: true })).toHaveCount(0);
  expect(registryReads).toBe(0);
  expect(businessWrites).toEqual([]);
});

test('dictionary list failure remains distinct from empty and can be retried next to the values', async ({ page, businessWrites }) => {
  let failed = true;
  await page.route('**/api/ops/dictionaries/', route => failed
    ? route.fulfill({ status: 503, json: { detail: 'Temporary registry failure' } }) : route.fallback());
  await signIn(page);
  await page.goto('/security-ops/dictionaries/POST_REQUIREMENTS/');
  const navigation = page.getByRole('navigation', { name: 'Выбор справочника', exact: true });
  await expect(navigation.getByRole('alert')).toContainText('Не удалось загрузить перечень справочников.');
  await expect(navigation.getByText('Справочников пока нет.', { exact: true })).toHaveCount(0);
  failed = false;
  await navigation.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(navigation.getByRole('link', { name: 'Требования к постам', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Требования к постам', level: 1 })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('revoking dictionary read removes the cached list while keeping the permitted status catalog', async ({ page, businessWrites }) => {
  let revoked = false;
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: {
    permissions: revoked ? ['status.view'] : ['status.view', 'dictionary.view'], global_permissions: [], roles: [],
  } }));
  await signIn(page);
  await page.goto('/security-ops/dictionaries/status-types/');
  const navigation = page.getByRole('navigation', { name: 'Выбор справочника', exact: true });
  await expect(navigation.getByRole('link', { name: 'Требования к постам', exact: true })).toBeVisible();
  revoked = true;
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/my-permissions/');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refresh;
  await expect(navigation).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Типы статусов сотрудников', level: 1 })).toBeVisible();
  expect(businessWrites).toEqual([]);
});
