import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

type GrantBody = { user_id: string; role_code: string; scope_division_id: number | null };
const account = { id: 42, username: 'scope-fixture', full_name: 'Учебный пользователь', first_name: '', last_name: '', email: '', employee_id: null, employee_name: null, is_active: true, last_login: null };
const roles = [
  { code: 'READER', name: 'Просмотр статусов', description: 'Чтение статусов подразделения', permissions: ['status.view'], is_active: true },
  { code: 'OTHER', name: 'Другой рабочий профиль', description: '', permissions: ['status.view'], is_active: true },
  { code: 'ADMIN', name: 'Все права', description: '', permissions: ['*'], is_active: true },
];

async function openAccount(page: Page) {
  const submitted: GrantBody[] = [];
  const grants: Array<GrantBody & { id: number; is_active: boolean; role_name: string; scope_division_name: string | null }> = [];
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['admin.roles'], global_permissions: ['admin.roles'], roles: [],
  } }));
  await page.route('**/api/operations/accounts/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/employee-options/')) return route.fulfill({ json: { count: 0, results: [] } });
    if (path.endsWith('/42/')) return route.fulfill({ json: account });
    return route.fulfill({ json: { count: 1, next: null, previous: null, results: [account] } });
  });
  await page.route('**/api/operations/roles/**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { count: roles.length, next: null, previous: null, results: roles } })
    : route.fallback());
  await page.route('**/api/operations/user-roles/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { count: grants.length, next: null, previous: null, results: grants } });
    if (route.request().method() !== 'POST' || !new URL(route.request().url()).pathname.endsWith('/user-roles/')) return route.fallback();
    // This response is browser-only. Every other business write stays blocked
    // by ux-fixture; no request reaches the real role/account endpoints.
    const body = route.request().postDataJSON() as GrantBody;
    submitted.push(body);
    const grant = { ...body, id: submitted.length, is_active: true, role_name: roles.find(role => role.code === body.role_code)!.name,
      scope_division_name: body.scope_division_id === null ? null : 'Учебное управление' };
    grants.push(grant);
    return route.fulfill({ status: 201, json: grant });
  });
  await page.route('**/api/divisions/divisions_tree/**', route => route.fulfill({ json: {
    id: 0, name: 'Служба', children: [{ id: 7, name: 'Учебное управление', children: [{ id: 8, name: 'Учебный отдел', children: [] }] }],
  } }));
  await signIn(page);
  await page.goto('/settings/users/?user=42');
  await expect(page.locator('#assign-role')).toBeEnabled();
  return { submitted, role: page.getByLabel('Роль', { exact: true }), scope: page.getByLabel('Область', { exact: true }), grant: page.getByRole('button', { name: 'Выдать', exact: true }) };
}

for (const width of [390, 1440]) test(`at ${width}px an administrator deliberately selects scope before assigning an ordinary role`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 900 });
  const form = await openAccount(page);
  await form.role.selectOption('READER');
  await expect(form.scope).toHaveValue('');
  await expect(form.grant).toBeDisabled();
  await expect(form.scope).toHaveAccessibleDescription(/Подразделение включает подчинённые/);
  await expect(page.getByText(/Узкая область не отменяет доступ на всю службу/)).toBeVisible();
  expect(form.submitted).toEqual([]);

  await form.scope.selectOption('7');
  await form.grant.click();
  await expect.poll(() => form.submitted.length).toBe(1);
  expect(form.submitted[0]).toEqual({ user_id: '42', role_code: 'READER', scope_division_id: 7 });
  await expect(page.getByRole('list', { name: 'Роли человека' })).toContainText('Учебное управление');

  await form.role.selectOption('OTHER');
  await expect(form.scope).toHaveValue('');
  await expect(form.grant).toBeDisabled();
  await form.scope.selectOption('WHOLE_SERVICE');
  await form.grant.click();
  await expect.poll(() => form.submitted.length).toBe(2);
  expect(form.submitted[1]).toEqual({ user_id: '42', role_code: 'OTHER', scope_division_id: null });
  await expect(page.getByRole('list', { name: 'Роли человека' })).toContainText('Вся служба');

  await form.role.selectOption('READER');
  await expect(form.scope).toHaveValue('');
  await expect(form.grant).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('a wildcard role forces whole service and switching back requires an explicit scope', async ({ page, businessWrites }) => {
  const form = await openAccount(page);
  await form.role.selectOption('ADMIN');
  await expect(form.scope).toHaveValue('WHOLE_SERVICE');
  await expect(form.scope).toBeDisabled();
  await expect(form.grant).toBeEnabled();
  await form.grant.click();
  await expect.poll(() => form.submitted.length).toBe(1);
  expect(form.submitted[0]).toEqual({ user_id: '42', role_code: 'ADMIN', scope_division_id: null });
  await form.role.selectOption('READER');
  await expect(form.scope).toHaveValue('');
  await expect(form.scope).toBeEnabled();
  await expect(form.grant).toBeDisabled();
  expect(businessWrites).toEqual([]);
});
