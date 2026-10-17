import { test, expect, signIn } from './ux-fixture';

test('legacy daily and forces views identify the open work and preserve it after navigation', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/employees/?view=daily&businessDate=2026-10-13');
  const crumbs = page.getByRole('navigation', { name: 'Хлебные крошки' });
  const sections = page.getByRole('navigation', { name: 'Разделы модуля' });
  await expect(page.getByRole('heading', { name: 'Ежедневный расход организации', exact: true })).toBeVisible();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Ежедневный расход организации');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await sections.getByRole('button', { name: 'Сбор сил на ОМ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Сбор сил на ОМ');
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-13');
  await sections.getByRole('button', { name: 'Ежедневный расход организации', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ежедневный расход организации', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ежедневный расход организации', exact: true })).toBeVisible();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Ежедневный расход организации');
  expect(businessWrites).toEqual([]);
});

test('unknown legacy view falls back to the daily view in both heading and breadcrumb', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.goto('/employees/?view=unknown');
  await expect(page.getByRole('heading', { name: 'Ежедневный расход организации', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Хлебные крошки' }).locator('[aria-current="page"]')).toHaveText('Ежедневный расход организации');
  expect(businessWrites).toEqual([]);
});

test('the employee list offers a working destination for bulk status changes', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.goto('/employees/?view=forces');
  await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Массовое изменение статусов', exact: true }).click();
  await expect(page).toHaveURL(/\/statuses\/?$/);
  await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await expect(page.getByText('Массовое обновление статусов', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});
