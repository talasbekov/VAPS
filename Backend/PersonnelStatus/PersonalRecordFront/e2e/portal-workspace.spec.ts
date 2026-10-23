import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

// Real sign-in, browser permission fixtures, and a read-only navigation flow.
// These scenarios verify presentation; they do not establish backend role rights.
interface AccessFixture {
  permissions: string[];
  global_permissions: string[];
  roles: { code: string; name: string; scope_division_id: number | null; scope_division_name: string | null }[];
  status_manage_division_ids?: number[];
}
const role = (code: string, name: string, scope: number | null = null) => ({
  code, name, scope_division_id: scope, scope_division_name: scope === null ? null : 'Тестовое подразделение',
});
const administrator: AccessFixture = {
  permissions: ['*'], global_permissions: ['*'], roles: [role('ADMIN', 'Администратор')],
};
const cases: { name: string; access: AccessFixture; tasks: string[]; forbidden: string[] }[] = [
  { name: 'employee', access: { permissions: ['object.view', 'catalog.view', 'status.view', 'status.workspace', 'feedback.view'],
    global_permissions: [], roles: [role('EMPLOYEE', 'Сотрудник')] },
    tasks: ['Мои задания и дежурства'], forbidden: ['Пользователи', 'Распределения Штаба', 'Подготовить наряд'] },
  { name: 'status manager', access: { permissions: ['status.view', 'status.workspace', 'status.manage', 'forces.select', 'duty.view'],
    global_permissions: [], roles: [role('DIRECTORATE_HEAD', 'Начальник управления', 3)], status_manage_division_ids: [3] },
    tasks: ['Отметить статусы сотрудников', 'Посмотреть дежурства', 'Мои задания и дежурства'],
    forbidden: ['Пользователи', 'Распределения Штаба', 'Подготовить наряд', 'Ответить на запрос людей'] },
  { name: 'headquarters', access: { permissions: ['forces.command', 'event.view', 'event.create'],
    global_permissions: ['forces.command', 'event.view', 'event.create'], roles: [role('OPS_STAFF', 'Штаб')] },
    tasks: ['Распределения Штаба', 'Подготовить наряд', 'Продолжить работу по ОМ'], forbidden: ['Пользователи', 'Отметить статусы сотрудников'] },
  { name: 'administrator', access: administrator, tasks: ['Пользователи', 'Роли и права', 'Настройки системы'], forbidden: [] },
];

async function useAccess(page: Page, access: AccessFixture) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: access }));
}

for (const scenario of cases) test(`${scenario.name} sees up to three relevant tasks and can reach the remaining allowed sections`, async ({ page, businessWrites }) => {
  await useAccess(page, scenario.access);
  await signIn(page);
  await page.goto('/workspace/');
  const tasks = page.getByRole('region', { name: 'Основные рабочие задачи', exact: true });
  const titles: Record<string, string> = { employee: 'Мои задания и дежурства', 'status manager': 'Люди и ежедневная работа', headquarters: 'Поручения и подготовка наряда', administrator: 'Доступ и пользователи' };
  await expect(page.getByRole('heading', { name: titles[scenario.name], exact: true, level: 1 })).toBeVisible();
  const quickTasks = scenario.tasks.filter((_, index) => !(['administrator', 'status manager'].includes(scenario.name) && index === 0)).filter(title => scenario.name !== 'headquarters' || title !== 'Подготовить наряд');
  for (const title of quickTasks) await expect(tasks.getByRole('link', { name: new RegExp('^' + title) })).toBeVisible();
  expect(await tasks.getByRole('link').count()).toBeLessThanOrEqual(3);
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await expect(nav.getByRole('link', { name: 'Моя работа', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await nav.getByRole('link').count()).toBeLessThanOrEqual(4);
  for (const title of scenario.tasks) await expect(nav.getByRole('link', { name: title, exact: true })).toBeVisible();
  const sections = nav.locator('details');
  if (await sections.count()) {
    await expect(sections).not.toHaveAttribute('open', '');
    await nav.getByText('Все разделы', { exact: true }).click();
    await expect(nav.getByLabel('Найти раздел', { exact: true })).toBeVisible();
    for (const title of scenario.forbidden) await expect(nav.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  }
  expect(businessWrites).toEqual([]);
});

test('an employee opens personal assignments from the task card', async ({ page, businessWrites }) => {
  await useAccess(page, cases[0].access);
  await signIn(page);
  await page.goto('/workspace/');
  await page.getByRole('region', { name: 'Основные рабочие задачи', exact: true })
    .getByRole('link', { name: /^Мои задания и дежурства/ }).click();
  await expect(page).toHaveURL(/\/security-ops\/profile\/?$/);
  await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('all sections supports keyboard expansion and search without losing the main work entry', async ({ page, businessWrites }) => {
  await useAccess(page, administrator);
  await signIn(page);
  await page.goto('/workspace/');
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  const toggle = nav.locator('summary').filter({ hasText: /^Все разделы$/ });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const search = nav.getByLabel('Найти раздел', { exact: true });
  await expect(search).toBeVisible();
  await search.fill('транспорт');
  const filtered = nav.locator('details').getByRole('link');
  await expect(filtered).toHaveCount(1);
  await expect(filtered).toHaveText('Транспорт ГОН');
  await expect(filtered).toHaveAttribute('href', /\/security-ops\/vehicles\/?$/);
  await expect(nav.getByRole('link', { name: 'Моя работа', exact: true })).toBeVisible();
  await search.fill('несуществующий-раздел-проверка');
  await expect(filtered).toHaveCount(0);
  await expect(nav.getByText('Такого раздела не найдено. Попробуйте другое название.', { exact: true })).toBeVisible();
  await search.clear();
  await expect(nav.getByRole('link', { name: 'Аудит', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a rare deep link pins its current section and keeps the full menu closed after reload', async ({ page, businessWrites }) => {
  await useAccess(page, administrator);
  await signIn(page);
  await page.goto('/security-ops/analytics/operations/');
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await expect(nav.locator('details')).not.toHaveAttribute('open', '');
  await expect(nav.getByRole('link')).toHaveCount(5);
  const current = nav.locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Аналитика ОМ');
  await expect(current).toBeVisible();
  await nav.getByText('Все разделы', { exact: true }).click();
  await expect(current).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Аналитика службы', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Аналитика ОМ');
  await expect(nav.locator('details')).not.toHaveAttribute('open', '');
  await expect(current).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('mobile query-only work switches close the menu and keep headquarters accessible with combined roles', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useAccess(page, {
    permissions: ['status.view', 'forces.allocate', 'forces.command', 'event.view', 'event.create'],
    global_permissions: ['forces.command'],
    roles: [role('FORCES_GATHERING_OFFICER', 'Ответственный за сбор сил', 2), role('OPS_STAFF', 'Штаб')],
  });
  await signIn(page);
  await page.goto('/employees/?view=daily&businessDate=2026-10-20');
  await expect(page.getByRole('heading', { name: 'Ежедневный расход', exact: true, level: 1 })).toBeVisible();
  const open = page.getByRole('button', { name: 'Открыть меню', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Меню навигации', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Smart Жоспарлау', { exact: true })).toHaveCount(1);
  await expect(dialog.locator('[data-slot="sidebar-brand"]')).toHaveCount(0);
  await dialog.getByRole('navigation', { name: 'Основная навигация', exact: true })
    .getByRole('link', { name: 'Распределения Штаба', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('forces');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('collections');
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-20');
  await expect(page.getByRole('heading', { name: 'Распределения', exact: true, level: 1 })).toBeVisible();
  await open.click();
  const current = dialog.getByRole('navigation', { name: 'Основная навигация', exact: true }).locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Распределения Штаба');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(businessWrites).toEqual([]);
});
