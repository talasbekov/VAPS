import { test, expect, signIn } from './ux-fixture';

for (const width of [320, 390, 640, 1024, 1440]) {
  test(`Navbar keeps every action inside ${width}px with legacy dark preference`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    const session = await (await page.request.get('/api/auth/session/')).json();
    if (!session?.user || session.error) await signIn(page);
    await page.goto('/workspace/');
    const header = page.locator('.sj-header');
    await expect(header).toBeVisible();
    await expect(page.locator('.sj-shell')).toHaveAttribute('style', /--sj-header-height:/);
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(header.getByRole('button', { name: /Переключ.*тем/ })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Меню пользователя', exact: true })).toBeVisible();
    const tabs = header.getByRole('navigation', { name: 'Разделы системы' }).getByRole('link');
    await expect(tabs.first()).toBeVisible();
    await expect(header.locator('[aria-current="true"]')).toHaveCSS('background-color', 'rgb(247, 206, 70)');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const targets = header.locator('button:visible, .sj-top-navigation a');
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await header.getByRole('button', { name: 'Меню пользователя', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Редактировать профиль' })).toBeVisible();
    await page.keyboard.press('Escape');
    await header.getByRole('button', { name: 'Уведомления', exact: true }).click();
    await expect(page.getByRole('tablist', { name: 'Разделы уведомлений' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(businessWrites).toEqual([]);
  });
}
