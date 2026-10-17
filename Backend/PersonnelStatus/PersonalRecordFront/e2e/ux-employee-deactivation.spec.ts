import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page) {
  const state = { active: true, fail: true, hold: false, writes: [] as object[], release: () => {} };
  const waiting = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['orgstructure.manage', 'admin.roles', 'personnel.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/core/service-employees/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/options/')
    ? { divisions: [{ id: 3, name: 'Отдел проверки', level: 0 }], statuses: [] }
    : new URL(route.request().url()).pathname.endsWith('/1/') ? { id: 1, full_name: 'Исходный Сотрудник', division: { id: 3, name: 'Отдел проверки' } } : { count: 0, results: [] } }));
  for (const kind of ['ranks', 'positions']) await page.route(`**/api/dictionaries/${kind}/**`, route => route.fulfill({ json: { results: [{ id: 7, name: 'Назначенное значение', is_active: true }] } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', async route => {
    if (route.request().method() !== 'GET') {
      state.writes.push(route.request().postDataJSON());
      if (state.hold) await waiting;
      if (state.fail) return route.fulfill({ json: { staff_units: [], errors: [{ employee: 'Проверка отказа деактивации' }] } });
      state.active = false;
    }
    return route.fulfill({ json: { staff_units: [{ id: 1, employee: { id: 1, first_name: 'Сотрудник', last_name: 'Исходный' }, division: { id: 3, name: 'Отдел проверки' }, position: { id: 7, name: 'Назначенное значение' },
      management: { staff_unit_id: 1, middle_name: '', callsign: '', rank_id: 7, user: null, is_active: state.active } }] } });
  });
  await signIn(page); await page.goto('/service-employees/?edit=1');
  await expect(page.getByRole('button', { name: 'Деактивировать', exact: true })).toBeEnabled();
  return state;
}

const confirmation = (page: Page) => page.getByRole('region', { name: 'Подтверждение деактивации', exact: true });

test('deactivation identifies the employee and can be cancelled without losing the form draft', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await prepare(page);
  await page.getByLabel('Фамилия', { exact: true }).fill('Черновик');
  await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
  await expect(confirmation(page)).toContainText('Исходный Сотрудник');
  await expect(confirmation(page)).toContainText('Несохранённые изменения полей этим действием не сохраняются.');
  await expect(confirmation(page).getByRole('button', { name: 'Вернуться к форме', exact: true })).toBeFocused();
  await expect(page.getByLabel('Фамилия', { exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]);
  await confirmation(page).getByRole('button', { name: 'Вернуться к форме', exact: true }).click();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Черновик');
  await expect(page.getByRole('button', { name: 'Деактивировать', exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('confirmed deactivation blocks dismissal and duplicates while pending and retains a rejected draft', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.getByLabel('Фамилия', { exact: true }).fill('Черновик');
  state.hold = true;
  try {
    await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
    await confirmation(page).getByRole('button', { name: 'Подтвердить деактивацию', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(confirmation(page).getByRole('button', { name: 'Деактивируем…', exact: true })).toBeDisabled();
    await expect(confirmation(page).getByRole('button', { name: 'Вернуться к форме', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await page.mouse.click(2, 2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await confirmation(page).getByRole('button', { name: 'Деактивируем…', exact: true }).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  } finally { state.hold = false; state.release(); }
  await expect(page.getByText('Проверка отказа деактивации', { exact: true })).toBeVisible();
  await confirmation(page).getByRole('button', { name: 'Вернуться к форме', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Черновик');
  expect(state.writes).toEqual([{ employee_admin: true, atomic: true, employees: [{ id: 1, is_active: false }] }]);
  expect(businessWrites).toEqual([]);
});

test('only confirmation sends the existing deactivation payload and successful completion closes the editor', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.fail = false;
  await page.getByLabel('Фамилия', { exact: true }).fill('Несохранённая фамилия');
  await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
  await expect(confirmation(page)).toBeVisible(); expect(state.writes).toEqual([]);
  await confirmation(page).getByRole('button', { name: 'Подтвердить деактивацию', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('edit')).toBeNull();
  expect(state.writes).toEqual([{ employee_admin: true, atomic: true, employees: [{ id: 1, is_active: false }] }]);
  expect(businessWrites).toEqual([]);
});
