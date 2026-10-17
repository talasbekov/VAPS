import { test, expect, signIn } from './ux-fixture';

const cases = [
  { route: '/statuses/', permissions: ['event.view'], denied: /Недостаточно прав для просмотра статусов сотрудников/ },
  { route: '/employees/?view=forces', permissions: ['event.view'], denied: /Недостаточно прав для просмотра сбора сил на ОМ/ },
  { route: '/security-ops/events/', permissions: ['status.view'], denied: /Недостаточно прав для просмотра реестра ОМ/ },
];

for (const permission of ['forces.allocate', 'forces.command']) {
  test(`${permission} alone keeps forces actions available without private status datasets`, async ({ page, businessWrites }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: [permission], global_permissions: [permission], roles: [] } }));
    await page.route(url => url.pathname.startsWith('/api/ops/security-events/forces/'), route => route.fulfill({ json: { results: [] } }));
    const privateReads: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/staff_unit/staff-units/directorate/') ||
        path === '/api/operations/strength-report/' || path === '/api/operations/status-types/' ||
        path === '/api/operations/statuses/') privateReads.push(path);
    });
    await signIn(page);
    await page.goto('/employees/?view=forces');
    await page.waitForTimeout(500);
    expect(privateReads, 'Forces rights must not imply status.view').toEqual([]);
    await expect(page.getByRole('tab', { name: permission === 'forces.allocate' ? 'Заявки' : 'Сборы', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await page.waitForTimeout(400);
    expect(privateReads, 'Manual refresh must respect the same dataset permission').toEqual([]);
    await page.goto('/employees/?view=forces&tab=assigned');
    await expect(page.getByText('Списки сотрудников и показатели расхода доступны с правом «Статусы: просмотр».', { exact: true })).toBeVisible();
    expect(privateReads).toEqual([]);
    expect(businessWrites).toEqual([]);
  });
}

for (const target of cases) {
  test(`${target.route}: private datasets wait for permission resolution and remain closed after denial`, async ({ page, businessWrites }) => {
    let release!: () => void;
    let permissionsStarted = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/operations/my-permissions/**', async route => {
      permissionsStarted = true;
      await pending;
      return route.fulfill({ json: { permissions: target.permissions, global_permissions: target.permissions, roles: [] } });
    });
    const privateReads: string[] = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/staff_unit/staff-units/directorate/') ||
        pathname === '/api/operations/strength-report/' || pathname === '/api/operations/status-types/' ||
        pathname === '/api/ops/security-events/forces/campaign-reserves/' ||
        (target.route.includes('/security-ops/events/') && pathname === '/api/ops/security-events/')) privateReads.push(pathname);
    });
    await signIn(page);
    await page.goto(target.route);
    try {
      await expect.poll(() => permissionsStarted).toBe(true);
      await page.waitForTimeout(700);
      expect(privateReads, 'The loading gate must prevent protected prefetches').toEqual([]);
    } finally { release(); }
    await expect(page.getByText(target.denied)).toBeVisible();
    await page.waitForTimeout(400);
    expect(privateReads, 'Denied pages must not mount their private data consumers').toEqual([]);
    expect(businessWrites).toEqual([]);
  });
}

test('a linked own profile without status rights explains the missing status and sends no status queries', async ({ page, businessWrites }) => {
  // This real seeded account has a linked personnel record and no status.view.
  // Business writes are blocked by the fixture; no account or role is created.
  await signIn(page, 'role_event_approver');
  const statusReads: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/operations/status-types/' || pathname === '/api/operations/statuses/') statusReads.push(pathname);
  });
  await page.goto('/security-ops/profile/');
  await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible();
  await expect(page.getByText('Статусы недоступны по вашим правам', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Календарь', exact: true }).click();
  await expect(page.getByText(/В календаре показаны назначения и дежурства/)).toBeVisible();
  expect(statusReads).toEqual([]);
  expect(businessWrites).toEqual([]);
});
