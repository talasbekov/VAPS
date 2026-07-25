// Skip-to-content ссылка (WCAG 2.4.1 Bypass Blocks) в `AppLayout` — общий
// каркас портала, задет ВЕСЬ app (не только Smart Josparlau), поэтому спека
// живёт в прод-сборке e2e/ (как футер каркаса — changelog.spec.ts), а не в
// e2e-mock/. Сайдбар — ~13 пунктов навигации; без этой ссылки клавиатурный
// пользователь проходит их все на КАЖДОЙ странице, прежде чем добраться до
// контента.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

async function seedCredential(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'e2e-app-layout' }),
    )
  })
}

async function stubBackend(context: BrowserContext): Promise<void> {
  await context.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ permissions: ['status.view'] }),
    }),
  )
  await context.route('**/api/notifications/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  )
}

test.describe('AppLayout: skip-to-content ссылка (прод-сборка)', () => {
  test('первый Tab фокусирует скрытую ссылку, активация переводит фокус на контент', async ({
    page,
    context,
  }) => {
    await stubBackend(context)
    await seedCredential(page)
    await page.goto('/')

    // Первый Tab со старта страницы — ДОЛЖЕН попасть на skip-ссылку, а не в
    // сайдбар (иначе она не первая в DOM-порядке — ARCH-регресс).
    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Перейти к содержимому' })
    await expect(skipLink).toBeFocused()

    // sr-only до фокуса, видима при фокусе (класс focus:not-sr-only).
    await expect(skipLink).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  })
})
