import { expect, test, type Page } from '@playwright/test';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3347';
const LINK_LABEL = 'Сотрудники подразделения →';
type NodeLink = { index: number; href: string; divisionId: number; nodeName: string | null };

async function nodeLinks(page: Page): Promise<NodeLink[]> {
  return page.getByRole('link', { name: LINK_LABEL, exact: true }).evaluateAll(anchors =>
    anchors.map((anchor, index) => {
      const url = new URL((anchor as HTMLAnchorElement).href);
      if (!/^\/service-employees\/?$/.test(url.pathname) ||
          [...url.searchParams.keys()].join(',') !== 'division_id') throw new Error('Unexpected personnel link endpoint');
      return {
        index, href: anchor.getAttribute('href')!, divisionId: Number(url.searchParams.get('division_id')),
        nodeName: anchor.closest('[data-slot="card"]')?.querySelector('h3')?.textContent?.trim() ?? null,
      };
    }));
}

// Actual FGO and read-only UI links; no provisioning or changes to any records.
test('OrgChart: FGO открывает крайние ссылки сотрудников подразделений', async ({ page }) => {
  test.setTimeout(120_000);
  expect(process.env.SMOKE_LIVE).toBe('1');
  expect(new URL(APP).port).toBe('3347');
  expect(new URL(APP).hostname).toBe('127.0.0.1');
  const password = process.env.ROLE_ACCOUNTS_PASSWORD;
  expect(typeof password === 'string' && password.length > 0, 'role password comes from external configuration').toBe(true);
  const csrf = await page.request.get(APP + '/api/auth/csrf/');
  expect(csrf.status()).toBe(200);
  const csrfBody = await csrf.json() as { csrfToken: string };
  expect(csrfBody.csrfToken).toBeTruthy();
  const signedIn = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrfBody.csrfToken, username: 'role_forces_gathering_officer', password: password!, json: 'true' },
  });
  expect(signedIn.status()).toBe(200);

  const pageErrors: string[] = [], nonReadRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Record unexpected writes, without interception or alteration of requests.
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      nonReadRequests.push(request.method() + ' ' + new URL(request.url()).pathname);
    }
  });
  const actualPermission = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/operations/my-permissions/' &&
    response.request().method() === 'GET' && response.status() === 200,
  );
  await page.goto(APP + '/organization/');
  const access = await (await actualPermission).json() as {
    permissions: string[]; global_permissions: string[];
    roles: { code: string; scope_division_id: number | null }[];
  };
  expect(access.roles).toHaveLength(1);
  expect(access.roles[0]).toMatchObject({ code: 'FORCES_GATHERING_OFFICER', scope_division_id: 2 });
  expect(access.permissions).toEqual(expect.arrayContaining(['orgstructure.view', 'personnel.view', 'forces.allocate']));
  expect(access.global_permissions).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Структура организации', exact: true, level: 1 })).toBeVisible();
  const links = page.getByRole('link', { name: LINK_LABEL, exact: true });
  await expect.poll(() => links.count()).toBeGreaterThan(8);
  const inventory = await nodeLinks(page);
  expect(new Set(inventory.map(item => item.divisionId)).size).toBe(inventory.length);
  for (const item of inventory) expect(Number.isSafeInteger(item.divisionId) && item.divisionId > 0).toBe(true);
  const selected = [...inventory.slice(0, 8), inventory[inventory.length - 1]];
  expect(new Set(selected.map(item => item.divisionId)).size).toBe(9);
  const records: unknown[] = [];

  try {
    for (const identity of selected) {
      await page.goto(APP + '/organization/');
      await expect(links).toHaveCount(inventory.length);
      const current = await nodeLinks(page);
      expect(current.map(item => ({ divisionId: item.divisionId, href: item.href })))
        .toEqual(inventory.map(item => ({ divisionId: item.divisionId, href: item.href })));
      const matches = current.filter(item => item.divisionId === identity.divisionId);
      expect(matches).toHaveLength(1);
      const link = links.nth(matches[0].index);
      await expect(link).toHaveAttribute('href', identity.href);
      await link.scrollIntoViewIfNeeded();
      // Trial performs native scroll/actionability without sending a click.
      // The real click below remains mandatory and is never forced.
      await link.click({ trial: true });
      const geometry = await link.evaluate(anchor => {
        const box = anchor.getBoundingClientRect();
        let canvas: HTMLElement | null = anchor.parentElement;
        while (canvas && getComputedStyle(canvas).overflowX !== 'auto') canvas = canvas.parentElement;
        if (!canvas) throw new Error('Actual OrgChart scroll container missing');
        const scrollBox = canvas.getBoundingClientRect();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const hit = document.elementFromPoint(center.x, center.y);
        return {
          left: box.left, right: box.right, width: box.width,
          clipLeft: Math.max(0, scrollBox.left + canvas.clientLeft),
          clipRight: Math.min(innerWidth, scrollBox.left + canvas.clientLeft + canvas.clientWidth),
          scrollLeft: canvas.scrollLeft, scrollWidth: canvas.scrollWidth, clientWidth: canvas.clientWidth,
          targetReceivesPointer: anchor.contains(hit),
          pointerHit: hit ? { tag: hit.tagName, id: hit.id, href: hit.closest('a')?.getAttribute('href') ?? null } : null,
        };
      });
      records.push({ identity, geometry });
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.scrollWidth, 'actual expanded chart must be wider than its container').toBeGreaterThan(geometry.clientWidth);
      expect(geometry.clipRight).toBeGreaterThan(geometry.clipLeft);
      expect(geometry.left, 'division ' + identity.divisionId + ': unreachable left overflow').toBeGreaterThanOrEqual(geometry.clipLeft - 1);
      expect(geometry.right, 'division ' + identity.divisionId + ': unreachable right overflow').toBeLessThanOrEqual(geometry.clipRight + 1);
      expect(geometry.targetReceivesPointer, 'division ' + identity.divisionId + ': pointer intercepted').toBe(true);
      await link.click();
      await expect.poll(() => {
        const url = new URL(page.url());
        return { path: url.pathname.replace(/\/$/, ''), divisionId: url.searchParams.get('division_id') };
      }).toEqual({ path: '/service-employees', divisionId: String(identity.divisionId) });
      await expect(page.getByRole('heading', { name: 'Сотрудники подразделения', exact: true, level: 1 })).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
    expect(nonReadRequests).toEqual([]);
  } finally {
    await test.info().attach('org-chart-actual-link-geometry', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ inventory, selected, records, pageErrors, nonReadRequests }, null, 2)),
    });
  }
});

