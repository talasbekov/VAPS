import { test, expect, signIn } from './ux-fixture';
import { staffedRow, clickRowMenuItem } from './row-menu';

for (const width of [320, 390, 430, 1440]) {
  test(`employee profile fits its dialog at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 667 });
    const session = await (await page.request.get('/api/auth/session/')).json();
    if (!session?.user || session.error) await signIn(page);
    await page.goto('/statuses/');
    await page.waitForLoadState('networkidle');
    await clickRowMenuItem(page, staffedRow(page), 'Просмотр профиля');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Табельный №/)).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(businessWrites).toEqual([]);
  });
  for (const step of [2, 3, 4]) {
    test(`event stage ${step} keeps fields and actions inside ${width}px`, async ({ page, businessWrites }) => {
      await page.setViewportSize({ width, height: 844 });
      const session = await (await page.request.get('/api/auth/session/')).json();
      if (!session?.user || session.error) await signIn(page);
      await page.goto('/security-ops/events/');
      const eventId = await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session/')).json();
        const response = await fetch('/api/ops/security-events/?page_size=100', {
          headers: { Authorization: `Bearer ${session.user.accessToken}` },
        });
        if (!response.ok) throw new Error('The real event registry is required');
        const registry = await response.json();
        return registry.results.find((event: { id: string; stage: string; placementAssignments?: unknown[] }) =>
          event.stage === 'APPROVAL' && (event.placementAssignments?.length ?? 0) > 0)?.id;
      });
      expect(eventId, 'A populated approval-stage event is required').toBeTruthy();
      await page.goto(`/security-ops/events/${eventId}/?step=${step}`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const scope = step === 2 ? page.locator('[data-slot="placement-workspace"]')
        : step === 3 ? page.getByRole('button', { name: 'Назначить первым согласующим', exact: true })
          : page.locator('button').filter({ hasText: 'Напомнить всем, кто не подтвердил' });
      await expect(scope).toBeVisible();
      const box = await scope.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(businessWrites).toEqual([]);
    });
  }

  test(`participation kind owner field fits ${width}px without changing available options`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 844 });
    const session = await (await page.request.get('/api/auth/session/')).json();
    if (!session?.user || session.error) await signIn(page);
    await page.goto('/security-ops/dictionaries/EVENT_PARTICIPATION_KINDS/');
    const owner = page.getByLabel('Подразделение-владелец *', { exact: true });
    await expect(owner).toBeVisible();
    await expect.poll(() => owner.locator('option').count()).toBeGreaterThan(1);
    const box = await owner.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(businessWrites).toEqual([]);
  });
}
