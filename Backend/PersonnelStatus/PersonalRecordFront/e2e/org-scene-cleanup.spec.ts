import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3346';

test('SPA departure releases the tree canvas and document keyboard listeners', async ({ page, context }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires the real authenticated hierarchy');
  const blockedWrites: string[] = [];
  await context.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !pathname.startsWith('/api/auth/')) {
      blockedWrites.push(`${request.method()} ${pathname}`);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  const csrf = await (await context.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await context.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
  expect((await login.json()).url).not.toContain('error=');

  const sample = async () => {
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      const doc = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'tree-cleanup' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: doc.result.objectId! });
      const documentKeydowns = listeners.filter(listener => listener.type === 'keydown').length;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'tree-cleanup' });
      await cdp.send('DOM.enable');
      const detached = await cdp.send('DOM.getDetachedDomNodes');
      const detachedCanvases = detached.detachedNodes.filter(item => item.treeNode.nodeName === 'CANVAS').length;
      return { documentKeydowns, detachedCanvases };
    } finally {
      await cdp.send('DOM.disable').catch(() => {});
      await cdp.detach();
    }
  };
  await page.goto(`${APP}/statuses/`);
  await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
  // A heading can appear before staffing rows. Their menus install their own
  // keydown listeners: comparing that empty skeleton with a loaded return
  // page measures table hydration rather than a retained 3D listener.
  const employeeActions = page.getByRole('button', { name: /^Действия:/ });
  await expect.poll(() => employeeActions.count()).toBeGreaterThan(0);
  const employeeActionCount = await employeeActions.count();
  await page.waitForTimeout(500);
  const baseline = await sample();
  const samples = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('link', { name: 'Обзор', exact: true }).click();
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled({ timeout: 45000 });
    await expect(scene.locator('canvas')).toHaveCount(1);
    await page.getByRole('link', { name: 'Статусы сотрудников', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
    await expect(employeeActions).toHaveCount(employeeActionCount);
    await expect(page.locator('[data-testid="org-scene-canvas"] canvas')).toHaveCount(0);
    // Deliver context-loss and passive cleanup before collecting retained nodes.
    await page.waitForTimeout(500);
    const current = await sample();
    samples.push(current);
    expect.soft(current.detachedCanvases, `cycle ${cycle + 1}: tree canvas retained after SPA departure`).toBe(baseline.detachedCanvases);
    expect.soft(current.documentKeydowns, `cycle ${cycle + 1}: document keydown listener retained`).toBe(baseline.documentKeydowns);
  }
  await test.info().attach('tree-cleanup-counts', { contentType: 'application/json', body: JSON.stringify({ baseline, samples }) });
  expect(blockedWrites).toEqual([]);
});
