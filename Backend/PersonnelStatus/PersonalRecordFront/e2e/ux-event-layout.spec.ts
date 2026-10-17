import { test, expect, readEvent, signIn } from './ux-fixture';

for (const step of [1, 3]) {
  test(`OM step ${step}: wide data scrolls within its table without widening the page`, async ({ page, request, businessWrites }) => {
    const event = await readEvent(request);
    await signIn(page);
    await page.goto(`/security-ops/events/${event.id}/?step=${step}`);
    const region = page.locator(`[role="region"][aria-label="${step === 1 ? 'Рекогносцировка объекта' : 'Согласование расстановки'}"]`);
    const table = region.locator('table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr').first()).toBeVisible();
    for (const width of [390, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `Page must fit ${width}px`).toBeLessThanOrEqual(width);
      if (width === 390) {
        const sizes = await table.evaluate(element => ({ table: element.getBoundingClientRect().width, container: element.parentElement!.clientWidth }));
        expect(sizes.table).toBeGreaterThan(sizes.container);
        await page.screenshot({ path: test.info().outputPath(`step-${step}-mobile.png`), fullPage: true, animations: 'disabled' });
      }
    }
    expect(businessWrites).toEqual([]);
  });
}
